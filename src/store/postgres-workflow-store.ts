import type { Pool, QueryResultRow } from 'pg';
import type { WorkflowEvent } from '../domain/events.js';
import type { StartWorkflow, WorkflowExecution } from '../domain/workflow.js';
import { IdempotencyConflict } from './workflow-store.js';
import type { WorkflowStore } from './workflow-store-port.js';

type ExecutionRow = QueryResultRow & { id: string; tenant_id: string; idempotency_key: string; definition: WorkflowExecution['definition']; status: WorkflowExecution['status']; step_states: WorkflowExecution['stepStates']; created_at: Date; updated_at: Date };
type EventRow = QueryResultRow & { id: string; type: WorkflowEvent['type']; execution_id: string; step_id: string | null; occurred_at: Date; payload: Record<string, unknown> };
const mapExecution = (row: ExecutionRow): WorkflowExecution => ({ id: row.id, tenantId: row.tenant_id, idempotencyKey: row.idempotency_key, definition: row.definition, status: row.status, stepStates: row.step_states, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() });
const mapEvent = (row: EventRow): WorkflowEvent => ({ id: row.id, type: row.type, executionId: row.execution_id, stepId: row.step_id ?? undefined, occurredAt: row.occurred_at.toISOString(), payload: row.payload });

export class PostgresWorkflowStore implements WorkflowStore {
  constructor(private readonly pool: Pool) {}

  async create(input: StartWorkflow): Promise<{ execution: WorkflowExecution; duplicate: boolean }> {
    const existing = await this.pool.query<ExecutionRow>('SELECT * FROM workflow_executions WHERE tenant_id = $1 AND idempotency_key = $2', [input.tenantId, input.idempotencyKey]);
    if (existing.rows[0]) {
      const execution = mapExecution(existing.rows[0]);
      if (JSON.stringify(execution.definition) !== JSON.stringify(input.definition)) throw new IdempotencyConflict();
      return { execution, duplicate: true };
    }
    const now = new Date().toISOString();
    const execution: WorkflowExecution = { ...input, id: `wf_${crypto.randomUUID()}`, status: 'queued', stepStates: Object.fromEntries(input.definition.steps.map((step) => [step.id, { status: 'pending', attempts: 0 }])), createdAt: now, updatedAt: now };
    const result = await this.pool.query<ExecutionRow>(`INSERT INTO workflow_executions (id, tenant_id, idempotency_key, definition, status, step_states, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *`, [execution.id, execution.tenantId, execution.idempotencyKey, execution.definition, execution.status, execution.stepStates, now]);
    return { execution: mapExecution(result.rows[0]!), duplicate: false };
  }

  async get(id: string): Promise<WorkflowExecution | undefined> { const result = await this.pool.query<ExecutionRow>('SELECT * FROM workflow_executions WHERE id = $1', [id]); return result.rows[0] ? mapExecution(result.rows[0]) : undefined; }

  async update(id: string, change: (execution: WorkflowExecution) => void): Promise<WorkflowExecution> {
    const current = await this.get(id); if (!current) throw new Error('workflow execution not found');
    change(current);
    const result = await this.pool.query<ExecutionRow>('UPDATE workflow_executions SET status=$2, step_states=$3, updated_at=now() WHERE id=$1 RETURNING *', [id, current.status, current.stepStates]);
    return mapExecution(result.rows[0]!);
  }

  async appendEvent(event: WorkflowEvent): Promise<void> { await this.pool.query('INSERT INTO workflow_events (id,type,execution_id,step_id,occurred_at,payload) VALUES ($1,$2,$3,$4,$5,$6)', [event.id, event.type, event.executionId, event.stepId ?? null, event.occurredAt, event.payload]); }
  async listEvents(executionId: string): Promise<WorkflowEvent[]> { const result = await this.pool.query<EventRow>('SELECT * FROM workflow_events WHERE execution_id=$1 ORDER BY occurred_at ASC', [executionId]); return result.rows.map(mapEvent); }
  async list(query: { tenantId: string; status?: WorkflowExecution['status']; limit?: number }): Promise<WorkflowExecution[]> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const result = query.status ? await this.pool.query<ExecutionRow>('SELECT * FROM workflow_executions WHERE tenant_id=$1 AND status=$2 ORDER BY created_at DESC LIMIT $3', [query.tenantId, query.status, limit]) : await this.pool.query<ExecutionRow>('SELECT * FROM workflow_executions WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2', [query.tenantId, limit]);
    return result.rows.map(mapExecution);
  }
}
