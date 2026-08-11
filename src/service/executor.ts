import type { WorkflowStep } from '../domain/workflow.js';

export type StepContext = { executionId: string; tenantId: string; input: Record<string, unknown>; outputs: Record<string, unknown> };
export type StepHandler = (context: StepContext) => Promise<unknown>;

export class StepExecutor {
  private readonly handlers = new Map<string, StepHandler>();

  register(stepName: string, handler: StepHandler): this {
    this.handlers.set(stepName, handler);
    return this;
  }

  async run(step: WorkflowStep, context: StepContext): Promise<unknown> {
    const handler = this.handlers.get(step.name);
    if (!handler) throw new Error(`no handler registered for step: ${step.name}`);
    let lastError: unknown;
    for (let attempt = 1; attempt <= step.retry.maxAttempts; attempt += 1) {
      try { return await handler(context); }
      catch (error) {
        lastError = error;
        if (attempt < step.retry.maxAttempts) await new Promise((resolve) => setTimeout(resolve, step.retry.backoffMs * 2 ** (attempt - 1)));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('step failed');
  }

  async runCompensation(step: WorkflowStep, context: StepContext): Promise<unknown> {
    if (!step.compensation) return undefined;
    const handler = this.handlers.get(step.compensation);
    if (!handler) throw new Error(`no compensation handler registered for step: ${step.compensation}`);
    return handler(context);
  }
}
