import { buildApp } from './http/app.js';
import { StepExecutor } from './service/executor.js';
import { WorkflowOrchestrator } from './service/orchestrator.js';
import { MemoryWorkflowStore } from './store/workflow-store.js';

const executor = new StepExecutor()
  .register('reserve-inventory', async () => ({ reserved: true }))
  .register('charge-payment', async () => ({ charged: true }))
  .register('send-confirmation', async () => ({ sent: true }));
const orchestrator = new WorkflowOrchestrator(new MemoryWorkflowStore(), executor);
const app = buildApp(orchestrator);
const port = Number(process.env.PORT ?? 8080);
await app.listen({ host: '0.0.0.0', port });
