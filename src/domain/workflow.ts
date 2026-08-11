export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'compensating' | 'compensated';
export type WorkflowStatus = 'queued' | 'running' | 'completed' | 'failed' | 'compensated';

export type WorkflowStep = {
  id: string;
  name: string;
  dependsOn: readonly string[];
  retry: { maxAttempts: number; backoffMs: number };
  compensation?: string;
};

export type WorkflowDefinition = {
  name: string;
  version: number;
  steps: readonly WorkflowStep[];
};

export type WorkflowExecution = {
  id: string;
  tenantId: string;
  idempotencyKey: string;
  definition: WorkflowDefinition;
  status: WorkflowStatus;
  stepStates: Record<string, { status: StepStatus; attempts: number; output?: unknown; error?: string }>;
  createdAt: string;
  updatedAt: string;
};

export type StartWorkflow = Omit<WorkflowExecution, 'id' | 'status' | 'stepStates' | 'createdAt' | 'updatedAt'>;

export const isValidDefinition = (definition: WorkflowDefinition): boolean => {
  const ids = new Set(definition.steps.map((step) => step.id));
  if (ids.size !== definition.steps.length || definition.steps.length === 0) return false;
  for (const step of definition.steps) {
    if (step.dependsOn.includes(step.id) || step.dependsOn.some((dependency) => !ids.has(dependency))) return false;
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    const step = definition.steps.find((candidate) => candidate.id === id)!;
    if (!step.dependsOn.every(visit)) return false;
    visiting.delete(id);
    visited.add(id);
    return true;
  };
  return definition.steps.every((step) => visit(step.id));
};
