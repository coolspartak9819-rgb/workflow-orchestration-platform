import type { WorkflowExecution } from './workflow.js';

export type WorkflowEvent = {
  id: string;
  type: 'workflow.queued' | 'workflow.started' | 'step.completed' | 'step.failed' | 'workflow.completed' | 'workflow.failed';
  executionId: string;
  stepId?: string;
  occurredAt: string;
  payload: Record<string, unknown>;
};

export type EventSink = (event: WorkflowEvent, execution: WorkflowExecution) => Promise<void>;
