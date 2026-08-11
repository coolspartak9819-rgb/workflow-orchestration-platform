import Fastify from 'fastify';
import type { WorkflowStatus } from '../domain/workflow.js';
import { IdempotencyConflict } from '../store/workflow-store.js';
import { WorkflowOrchestrator } from '../service/orchestrator.js';

export function buildApp(orchestrator: WorkflowOrchestrator) {
  const app = Fastify({ logger: true });
  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/metrics', async (_request, reply) => {
    const metrics = orchestrator.getMetrics();
    return reply.type('text/plain').send(`${Object.entries(metrics).map(([name, value]) => `workflow_${name}_total ${value}`).join('\n')}\n`);
  });
  app.post<{ Headers: { 'x-tenant-id'?: string; 'idempotency-key'?: string }; Body: { definition?: unknown } }>('/v1/workflows', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'];
    const idempotencyKey = request.headers['idempotency-key'];
    if (!tenantId || !idempotencyKey || !request.body?.definition) return reply.code(400).send({ error: 'x-tenant-id, idempotency-key and definition are required' });
    try {
      const result = await orchestrator.start({ tenantId, idempotencyKey, definition: request.body.definition as never });
      if (!result.duplicate) void orchestrator.run(result.execution.id);
      return reply.code(result.duplicate ? 200 : 202).send(result.execution);
    } catch (error) {
      if (error instanceof IdempotencyConflict) return reply.code(409).send({ error: error.message });
      if (error instanceof Error && error.message.includes('workflow definition')) return reply.code(422).send({ error: error.message });
      throw error;
    }
  });
  app.get<{ Params: { id: string }; Headers: { 'x-tenant-id'?: string } }>('/v1/workflows/:id', async (request, reply) => {
    const execution = await orchestrator.get(request.params.id);
    if (!execution || execution.tenantId !== request.headers['x-tenant-id']) return reply.code(404).send({ error: 'workflow not found' });
    return execution;
  });
  app.get<{ Params: { id: string }; Headers: { 'x-tenant-id'?: string } }>('/v1/workflows/:id/events', async (request, reply) => {
    const execution = await orchestrator.get(request.params.id);
    if (!execution || execution.tenantId !== request.headers['x-tenant-id']) return reply.code(404).send({ error: 'workflow not found' });
    return { events: await orchestrator.events(request.params.id) };
  });
  app.get<{ Querystring: { status?: WorkflowStatus; limit?: string }; Headers: { 'x-tenant-id'?: string } }>('/v1/workflows', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'];
    if (!tenantId) return reply.code(400).send({ error: 'x-tenant-id is required' });
    return { items: await orchestrator.list({ tenantId, status: request.query.status, limit: Number(request.query.limit ?? 50) }) };
  });
  return app;
}
