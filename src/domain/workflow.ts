export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'compensating' | 'compensated';
export type WorkflowStatus = 'queued' | 'running' | 'completed' | 'failed' | 'compensating' | 'compensated';

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

export type DefinitionValidation = { valid: true; definition: WorkflowDefinition } | { valid: false; error: string };

export const parseWorkflowDefinition = (value: unknown): DefinitionValidation => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false, error: 'definition must be an object' };
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.name !== 'string' || candidate.name.trim() === '') return { valid: false, error: 'definition.name must be a non-empty string' };
  if (!Number.isInteger(candidate.version) || Number(candidate.version) < 1) return { valid: false, error: 'definition.version must be a positive integer' };
  if (!Array.isArray(candidate.steps) || candidate.steps.length === 0) return { valid: false, error: 'definition.steps must be a non-empty array' };
  const steps: WorkflowStep[] = [];
  for (const [index, rawStep] of candidate.steps.entries()) {
    if (!rawStep || typeof rawStep !== 'object' || Array.isArray(rawStep)) return { valid: false, error: `definition.steps[${index}] must be an object` };
    const step = rawStep as Record<string, unknown>;
    if (typeof step.id !== 'string' || step.id.trim() === '') return { valid: false, error: `definition.steps[${index}].id must be a non-empty string` };
    if (typeof step.name !== 'string' || step.name.trim() === '') return { valid: false, error: `definition.steps[${index}].name must be a non-empty string` };
    if (!Array.isArray(step.dependsOn) || !step.dependsOn.every((dependency) => typeof dependency === 'string')) return { valid: false, error: `definition.steps[${index}].dependsOn must be an array of strings` };
    if (!step.retry || typeof step.retry !== 'object' || Array.isArray(step.retry)) return { valid: false, error: `definition.steps[${index}].retry is required` };
    const retry = step.retry as Record<string, unknown>;
    if (!Number.isInteger(retry.maxAttempts) || Number(retry.maxAttempts) < 1 || !Number.isInteger(retry.backoffMs) || Number(retry.backoffMs) < 0) return { valid: false, error: `definition.steps[${index}].retry has invalid limits` };
    if (step.compensation !== undefined && (typeof step.compensation !== 'string' || step.compensation.trim() === '')) return { valid: false, error: `definition.steps[${index}].compensation must be a non-empty string` };
    steps.push({ id: step.id, name: step.name, dependsOn: step.dependsOn, retry: { maxAttempts: Number(retry.maxAttempts), backoffMs: Number(retry.backoffMs) }, compensation: step.compensation as string | undefined });
  }
  const definition: WorkflowDefinition = { name: candidate.name, version: Number(candidate.version), steps };
  if (!isValidDefinition(definition)) return { valid: false, error: 'definition must be an acyclic graph with unique steps and valid dependencies' };
  return { valid: true, definition };
};

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
