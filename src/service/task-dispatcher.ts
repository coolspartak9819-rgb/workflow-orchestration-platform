export type WorkflowTask = { executionId: string; tenantId: string };

export interface TaskDispatcher {
  dispatch(task: WorkflowTask): Promise<void>;
}

export class NoopTaskDispatcher implements TaskDispatcher {
  async dispatch(_task: WorkflowTask): Promise<void> {}
}
