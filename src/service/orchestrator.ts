import type { EventSink, WorkflowEvent } from '../domain/events.js';
import type { StartWorkflow, WorkflowExecution } from '../domain/workflow.js';
import { isValidDefinition } from '../domain/workflow.js';
import type { WorkflowStore } from '../store/workflow-store-port.js';
import { StepExecutor } from './executor.js';

export class WorkflowOrchestrator {
  private readonly active = new Set<string>();
  private readonly metrics = { queued: 0, started: 0, completed: 0, failed: 0, compensated: 0 };
  constructor(
    private readonly store: WorkflowStore,
    private readonly executor: StepExecutor,
    private readonly sink: EventSink = async () => {},
  ) {}

  async start(input: StartWorkflow): Promise<{ execution: WorkflowExecution; duplicate: boolean }> {
    if (!isValidDefinition(input.definition)) throw new Error('workflow definition must be a non-empty acyclic graph');
    const result = await this.store.create(input);
    if (!result.duplicate) {
      this.metrics.queued += 1;
      await this.emit({ type: 'workflow.queued', executionId: result.execution.id, occurredAt: new Date().toISOString(), payload: {} }, result.execution);
    }
    return result;
  }

  get(id: string): Promise<WorkflowExecution | undefined> { return this.store.get(id); }
  list(query: { tenantId: string; status?: WorkflowExecution['status']; limit?: number }): Promise<WorkflowExecution[]> { return this.store.list(query); }
  events(id: string) { return this.store.listEvents(id); }
  getMetrics() { return { ...this.metrics }; }

  async run(id: string): Promise<WorkflowExecution> {
    if (this.active.has(id)) return (await this.store.get(id))!;
    this.active.add(id);
    try {
      let execution = await this.store.update(id, (item) => { item.status = 'running'; });
      this.metrics.started += 1;
      await this.emit({ type: 'workflow.started', executionId: id, occurredAt: new Date().toISOString(), payload: {} }, execution);
      while (true) {
        const ready = execution.definition.steps.filter((step) => {
          const state = execution.stepStates[step.id]!;
          return state.status === 'pending' && step.dependsOn.every((dependency) => execution.stepStates[dependency]!.status === 'completed');
        });
        if (ready.length === 0) break;
        const results = await Promise.allSettled(ready.map(async (step) => {
          const state = execution.stepStates[step.id]!;
          await this.store.update(id, (item) => { item.stepStates[step.id]!.status = 'running'; item.stepStates[step.id]!.attempts += 1; });
          const outputs = Object.fromEntries(execution.definition.steps.map((candidate) => [candidate.id, execution.stepStates[candidate.id]!.output]));
          const output = await this.executor.run(step, { executionId: id, tenantId: execution.tenantId, input: {}, outputs });
          await this.store.update(id, (item) => { item.stepStates[step.id]!.status = 'completed'; item.stepStates[step.id]!.output = output; });
          return step;
        }));
        execution = (await this.store.get(id))!;
        let hasFailure = false;
        for (let index = 0; index < results.length; index += 1) {
          const result = results[index]!;
          const step = ready[index]!;
          if (result.status === 'fulfilled') await this.emit({ type: 'step.completed', executionId: id, stepId: step.id, occurredAt: new Date().toISOString(), payload: {} }, execution);
          else {
            const error = result.reason instanceof Error ? result.reason.message : 'step failed';
            execution = await this.store.update(id, (item) => { item.stepStates[step.id]!.status = 'failed'; item.stepStates[step.id]!.error = error; item.status = 'failed'; });
            await this.emit({ type: 'step.failed', executionId: id, stepId: step.id, occurredAt: new Date().toISOString(), payload: { error } }, execution);
            hasFailure = true;
          }
        }
        if (hasFailure) {
          const result = await this.compensate(execution);
          if (result.status === 'compensated') this.metrics.compensated += 1; else this.metrics.failed += 1;
          return result;
        }
      }
      execution = await this.store.update(id, (item) => { item.status = 'completed'; });
      this.metrics.completed += 1;
      await this.emit({ type: 'workflow.completed', executionId: id, occurredAt: new Date().toISOString(), payload: {} }, execution);
      return execution;
    } finally { this.active.delete(id); }
  }

  private async compensate(execution: WorkflowExecution): Promise<WorkflowExecution> {
    const completed = [...execution.definition.steps].reverse().filter((step) => execution.stepStates[step.id]!.status === 'completed' && step.compensation);
    if (completed.length === 0) return execution;
    execution = await this.store.update(execution.id, (item) => { item.status = 'compensating'; });
    for (const step of completed) {
      try {
        const output = execution.stepStates[step.id]!.output;
        await this.executor.runCompensation(step, { executionId: execution.id, tenantId: execution.tenantId, input: {}, outputs: { [step.id]: output } });
        execution = await this.store.update(execution.id, (item) => { item.stepStates[step.id]!.status = 'compensated'; });
        await this.emit({ type: 'step.compensated', executionId: execution.id, stepId: step.id, occurredAt: new Date().toISOString(), payload: {} }, execution);
      } catch (error) {
        return this.store.update(execution.id, (item) => { item.status = 'failed'; item.stepStates[step.id]!.error = error instanceof Error ? error.message : 'compensation failed'; });
      }
    }
    execution = await this.store.update(execution.id, (item) => { item.status = 'compensated'; });
    await this.emit({ type: 'workflow.compensated', executionId: execution.id, occurredAt: new Date().toISOString(), payload: {} }, execution);
    return execution;
  }

  private async emit(event: Omit<WorkflowEvent, 'id'>, execution: WorkflowExecution): Promise<void> {
    const completeEvent: WorkflowEvent = { id: `evt_${crypto.randomUUID()}`, ...event };
    await this.store.appendEvent(completeEvent);
    await this.sink(completeEvent, execution);
  }
}
