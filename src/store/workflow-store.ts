import type { WorkflowEvent } from '../domain/events.js';
import type { StartWorkflow, WorkflowExecution, WorkflowStatus } from '../domain/workflow.js';
import type { WorkflowStore } from './workflow-store-port.js';

export class IdempotencyConflict extends Error {
  constructor() { super('idempotency key was already used with another workflow definition'); }
}

export class MemoryWorkflowStore implements WorkflowStore {
  private readonly executions = new Map<string, WorkflowExecution>();
  private readonly idempotency = new Map<string, string>();
  private readonly events: WorkflowEvent[] = [];

  async create(input: StartWorkflow): Promise<{ execution: WorkflowExecution; duplicate: boolean }> {
    const key = `${input.tenantId}:${input.idempotencyKey}`;
    const existingId = this.idempotency.get(key);
    const fingerprint = JSON.stringify(input.definition);
    if (existingId) {
      const existing = this.executions.get(existingId)!;
      if (JSON.stringify(existing.definition) !== fingerprint) throw new IdempotencyConflict();
      return { execution: existing, duplicate: true };
    }
    const now = new Date().toISOString();
    const execution: WorkflowExecution = {
      ...input,
      id: `wf_${crypto.randomUUID()}`,
      status: 'queued',
      stepStates: Object.fromEntries(input.definition.steps.map((step) => [step.id, { status: 'pending', attempts: 0 }])),
      createdAt: now,
      updatedAt: now,
    };
    this.executions.set(execution.id, execution);
    this.idempotency.set(key, execution.id);
    return { execution, duplicate: false };
  }

  async get(id: string): Promise<WorkflowExecution | undefined> { return this.executions.get(id); }

  async update(id: string, change: (execution: WorkflowExecution) => void): Promise<WorkflowExecution> {
    const execution = this.executions.get(id);
    if (!execution) throw new Error('workflow execution not found');
    change(execution);
    execution.updatedAt = new Date().toISOString();
    return execution;
  }

  async appendEvent(event: WorkflowEvent): Promise<void> { this.events.push(event); }

  async listEvents(executionId: string): Promise<WorkflowEvent[]> {
    return this.events.filter((event) => event.executionId === executionId);
  }

  async list(query: { tenantId: string; status?: WorkflowStatus; limit?: number }): Promise<WorkflowExecution[]> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    return [...this.executions.values()]
      .filter((execution) => execution.tenantId === query.tenantId && (!query.status || execution.status === query.status))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }
}
