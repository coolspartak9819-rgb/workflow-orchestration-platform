import type { WorkflowStore } from '../store/workflow-store-port.js';
import type { TaskDispatcher } from './task-dispatcher.js';

export class WorkflowRecovery {
  constructor(private readonly store: WorkflowStore, private readonly dispatcher: TaskDispatcher, private readonly staleAfterMs = 60_000, private readonly now = () => Date.now()) {}

  async recover(): Promise<number> {
    let dispatched = 0;
    for (const status of ['queued', 'running'] as const) {
      const executions = await this.store.list({ tenantId: '*', status, limit: 100 });
      for (const execution of executions) {
        if (this.now() - Date.parse(execution.updatedAt) < this.staleAfterMs) continue;
        await this.dispatcher.dispatch({ executionId: execution.id, tenantId: execution.tenantId });
        dispatched += 1;
      }
    }
    return dispatched;
  }
}
