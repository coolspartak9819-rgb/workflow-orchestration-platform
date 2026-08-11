import type { WorkflowEvent } from '../domain/events.js';
import type { StartWorkflow, WorkflowExecution, WorkflowStatus } from '../domain/workflow.js';

export interface WorkflowStore {
  create(input: StartWorkflow): Promise<{ execution: WorkflowExecution; duplicate: boolean }>;
  get(id: string): Promise<WorkflowExecution | undefined>;
  update(id: string, change: (execution: WorkflowExecution) => void): Promise<WorkflowExecution>;
  appendEvent(event: WorkflowEvent): Promise<void>;
  listEvents(executionId: string): Promise<WorkflowEvent[]>;
  list(query: { tenantId: string; status?: WorkflowStatus; limit?: number }): Promise<WorkflowExecution[]>;
}
