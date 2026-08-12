import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/http/app.js';
import { StepExecutor } from '../src/service/executor.js';
import { WorkflowOrchestrator } from '../src/service/orchestrator.js';
import { MemoryWorkflowStore, IdempotencyConflict } from '../src/store/workflow-store.js';
import { WorkflowWorker } from '../src/service/worker.js';
import { TenantAuthenticator } from '../src/http/auth.js';
import { WorkflowRecovery } from '../src/service/recovery.js';

const definition = {
  name: 'checkout', version: 1, steps: [
    { id: 'reserve', name: 'reserve-inventory', dependsOn: [], retry: { maxAttempts: 2, backoffMs: 1 } },
    { id: 'charge', name: 'charge-payment', dependsOn: ['reserve'], retry: { maxAttempts: 2, backoffMs: 1 } },
  ],
} as const;

test('workflow runs DAG steps in dependency order', async () => {
  const order: string[] = [];
  const executor = new StepExecutor().register('reserve-inventory', async () => { order.push('reserve'); return 1; }).register('charge-payment', async () => { order.push('charge'); return 2; });
  const service = new WorkflowOrchestrator(new MemoryWorkflowStore(), executor);
  const execution = (await service.start({ tenantId: 'tenant-a', idempotencyKey: 'checkout-1', definition })).execution;
  const result = await service.run(execution.id);
  assert.equal(result.status, 'completed');
  assert.deepEqual(order, ['reserve', 'charge']);
  assert.equal((await service.events(execution.id)).length, 5);
});

test('same idempotency key does not create a second execution', async () => {
  const service = new WorkflowOrchestrator(new MemoryWorkflowStore(), new StepExecutor().register('reserve-inventory', async () => true));
  const first = await service.start({ tenantId: 'tenant-a', idempotencyKey: 'same', definition: { ...definition, steps: [definition.steps[0]] } });
  const second = await service.start({ tenantId: 'tenant-a', idempotencyKey: 'same', definition: { ...definition, steps: [definition.steps[0]] } });
  assert.equal(first.execution.id, second.execution.id);
  assert.equal(second.duplicate, true);
});

test('cyclic workflows are rejected', async () => {
  const service = new WorkflowOrchestrator(new MemoryWorkflowStore(), new StepExecutor());
  await assert.rejects(() => service.start({ tenantId: 'tenant-a', idempotencyKey: 'cycle', definition: { name: 'bad', version: 1, steps: [
    { id: 'a', name: 'a', dependsOn: ['b'], retry: { maxAttempts: 1, backoffMs: 0 } },
    { id: 'b', name: 'b', dependsOn: ['a'], retry: { maxAttempts: 1, backoffMs: 0 } },
  ] } }), /acyclic/);
});

test('failed steps stop the workflow and expose an event trail', async () => {
  const executor = new StepExecutor().register('reserve-inventory', async () => { throw new Error('sold out'); });
  const service = new WorkflowOrchestrator(new MemoryWorkflowStore(), executor);
  const execution = (await service.start({ tenantId: 'tenant-a', idempotencyKey: 'failed', definition: { ...definition, steps: [definition.steps[0]] } })).execution;
  const result = await service.run(execution.id);
  assert.equal(result.status, 'failed');
  assert.equal((await service.events(execution.id)).some((event) => event.type === 'step.failed'), true);
});

test('failed workflow compensates completed steps in reverse order', async () => {
  const order: string[] = [];
  const executor = new StepExecutor()
    .register('reserve-inventory', async () => { order.push('reserve'); return true; })
    .register('release-inventory', async () => { order.push('release'); return true; })
    .register('charge-payment', async () => { order.push('charge'); throw new Error('card declined'); });
  const service = new WorkflowOrchestrator(new MemoryWorkflowStore(), executor);
  const definitionWithCompensation = {
    name: 'checkout', version: 1, steps: [
      { id: 'reserve', name: 'reserve-inventory', dependsOn: [], retry: { maxAttempts: 1, backoffMs: 0 }, compensation: 'release-inventory' },
      { id: 'charge', name: 'charge-payment', dependsOn: ['reserve'], retry: { maxAttempts: 1, backoffMs: 0 } },
    ],
  };
  const execution = (await service.start({ tenantId: 'tenant-a', idempotencyKey: 'compensate', definition: definitionWithCompensation })).execution;
  const result = await service.run(execution.id);
  assert.equal(result.status, 'compensated');
  assert.deepEqual(order, ['reserve', 'charge', 'release']);
  assert.equal((await service.events(execution.id)).some((event) => event.type === 'workflow.compensated'), true);
});

test('HTTP API keeps workflow details tenant-scoped', async () => {
  const service = new WorkflowOrchestrator(new MemoryWorkflowStore(), new StepExecutor().register('reserve-inventory', async () => true));
  const app = buildApp(service);
  const response = await app.inject({ method: 'POST', url: '/v1/workflows', headers: { 'x-tenant-id': 'a', 'idempotency-key': 'x' }, payload: { definition: { ...definition, steps: [definition.steps[0]] } } });
  const id = response.json().id;
  const forbidden = await app.inject({ method: 'GET', url: `/v1/workflows/${id}`, headers: { 'x-tenant-id': 'b' } });
  assert.equal(forbidden.statusCode, 404);
  await app.close();
});

test('conflicting idempotency payload is rejected', async () => {
  const service = new WorkflowOrchestrator(new MemoryWorkflowStore(), new StepExecutor());
  await service.start({ tenantId: 'tenant-a', idempotencyKey: 'conflict', definition });
  await assert.rejects(() => service.start({ tenantId: 'tenant-a', idempotencyKey: 'conflict', definition: { ...definition, name: 'different' } }), IdempotencyConflict);
});

test('worker lease allows only one worker to process an execution', async () => {
  const owners = new Set<string>();
  const lease = {
    async acquire(key: string, owner: string) { if (owners.has(key)) return false; owners.add(key); return true; },
    async renew() { return true; },
    async release(key: string) { owners.delete(key); },
  };
  const worker = new WorkflowWorker(lease, 1_000);
  let runs = 0;
  const first = worker.process('wf-1', 'worker-a', async () => { runs += 1; await new Promise((resolve) => setTimeout(resolve, 5)); });
  const second = worker.process('wf-1', 'worker-b', async () => { runs += 1; });
  assert.equal(await second, false);
  assert.equal(await first, true);
  assert.equal(runs, 1);
});

test('HTTP API rejects malformed workflow definitions with field errors', async () => {
  const service = new WorkflowOrchestrator(new MemoryWorkflowStore(), new StepExecutor());
  const app = buildApp(service);
  const response = await app.inject({ method: 'POST', url: '/v1/workflows', headers: { 'x-tenant-id': 'tenant-a', 'idempotency-key': 'bad' }, payload: { definition: { name: 'broken', version: 1, steps: [{ id: 'a', name: 'task', dependsOn: [], retry: { maxAttempts: 0, backoffMs: -1 } }] } } });
  assert.equal(response.statusCode, 422);
  assert.match(response.json().error, /retry/);
  await app.close();
});

test('HTTP API rejects cyclic JSON definitions before orchestration', async () => {
  const service = new WorkflowOrchestrator(new MemoryWorkflowStore(), new StepExecutor());
  const app = buildApp(service);
  const response = await app.inject({ method: 'POST', url: '/v1/workflows', headers: { 'x-tenant-id': 'tenant-a', 'idempotency-key': 'cycle-api' }, payload: { definition: { name: 'cycle', version: 1, steps: [
    { id: 'a', name: 'task', dependsOn: ['b'], retry: { maxAttempts: 1, backoffMs: 0 } },
    { id: 'b', name: 'task', dependsOn: ['a'], retry: { maxAttempts: 1, backoffMs: 0 } },
  ] } } });
  assert.equal(response.statusCode, 422);
  assert.match(response.json().error, /acyclic/);
  await app.close();
});

test('configured API keys enforce tenant ownership', async () => {
  const service = new WorkflowOrchestrator(new MemoryWorkflowStore(), new StepExecutor());
  const app = buildApp(service, new TenantAuthenticator('key-a:tenant-a'));
  const missing = await app.inject({ method: 'GET', url: '/v1/workflows', headers: { 'x-tenant-id': 'tenant-a' } });
  assert.equal(missing.statusCode, 401);
  const wrongTenant = await app.inject({ method: 'GET', url: '/v1/workflows', headers: { 'x-tenant-id': 'tenant-b', 'x-api-key': 'key-a' } });
  assert.equal(wrongTenant.statusCode, 401);
  const accepted = await app.inject({ method: 'GET', url: '/v1/workflows', headers: { 'x-tenant-id': 'tenant-a', 'x-api-key': 'key-a' } });
  assert.equal(accepted.statusCode, 200);
  await app.close();
});

test('recovery redispatches stale queued and running workflows', async () => {
  const store = new MemoryWorkflowStore();
  const service = new WorkflowOrchestrator(store, new StepExecutor());
  const execution = (await service.start({ tenantId: 'tenant-a', idempotencyKey: 'stale', definition: { ...definition, steps: [definition.steps[0]] } })).execution;
  await store.update(execution.id, (item) => { item.status = 'running'; });
  const dispatched: string[] = [];
  const recovery = new WorkflowRecovery(store, { async dispatch(task) { dispatched.push(task.executionId); } }, 100, () => Date.now() + 10_000);
  assert.equal(await recovery.recover(), 1);
  assert.deepEqual(dispatched, [execution.id]);
});
