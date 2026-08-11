import { buildApp } from './http/app.js';
import { StepExecutor } from './service/executor.js';
import { WorkflowOrchestrator } from './service/orchestrator.js';
import { MemoryWorkflowStore } from './store/workflow-store.js';
import { PostgresWorkflowStore } from './store/postgres-workflow-store.js';
import { Pool } from 'pg';

const executor = new StepExecutor()
  .register('reserve-inventory', async () => ({ reserved: true }))
  .register('charge-payment', async () => ({ charged: true }))
  .register('send-confirmation', async () => ({ sent: true }));
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : undefined;
const store = pool ? new PostgresWorkflowStore(pool) : new MemoryWorkflowStore();
const orchestrator = new WorkflowOrchestrator(store, executor);
const app = buildApp(orchestrator);
const port = Number(process.env.PORT ?? 8080);
await app.listen({ host: '0.0.0.0', port });
const shutdown = async () => { await app.close(); await pool?.end(); };
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
