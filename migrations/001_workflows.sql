CREATE TABLE IF NOT EXISTS workflow_executions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  definition JSONB NOT NULL,
  status TEXT NOT NULL,
  step_states JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS workflow_executions_tenant_created_idx ON workflow_executions (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS workflow_executions_status_idx ON workflow_executions (status);
CREATE TABLE IF NOT EXISTS workflow_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  execution_id TEXT NOT NULL REFERENCES workflow_executions(id),
  step_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS workflow_events_execution_idx ON workflow_events (execution_id, occurred_at ASC);
