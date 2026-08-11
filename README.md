# Workflow Orchestration Platform

Node.js 22 and TypeScript platform for executing durable, multi-step workflows as an acyclic dependency graph.

The project models a real distributed-systems problem: execute independent steps in parallel, wait for dependencies, retry transient failures, expose an event trail and guarantee that a client retry does not create a second execution.

## Current slice

- Fastify API with tenant-scoped workflow reads;
- DAG validation with cycle and missing dependency detection;
- dependency-aware execution with parallel ready steps;
- per-step retry policy with exponential backoff;
- workflow and step event trail;
- tenant-scoped idempotency;
- load scenario with configurable concurrency;
- Docker Compose with NATS JetStream base;
- PostgreSQL adapter with durable execution state and append-only event log;
- Redis-backed distributed leases for worker ownership;
- NATS JetStream event sink;
- OpenTelemetry auto-instrumentation;
- Kubernetes Deployment, Service and HPA templates;
- strict TypeScript and automated tests.

## Run

```bash
npm install
npm test
npm run check
npm run build
npm run start
```

Start a workflow:

```bash
curl -X POST http://localhost:8080/v1/workflows \
  -H 'content-type: application/json' \
  -H 'x-tenant-id: shop-1' \
  -H 'idempotency-key: order-123' \
  -d '{"definition":{"name":"checkout","version":1,"steps":[{"id":"reserve","name":"reserve-inventory","dependsOn":[],"retry":{"maxAttempts":3,"backoffMs":100}},{"id":"charge","name":"charge-payment","dependsOn":["reserve"],"retry":{"maxAttempts":3,"backoffMs":100}}]}}'
```

Run a local request load:

```bash
TOTAL=2000 CONCURRENCY=100 npm run load
```

## Roadmap

The demo uses memory storage when `DATABASE_URL` is absent; Compose switches to PostgreSQL and publishes workflow events to NATS. Kubernetes templates are in `k8s/` and expect PostgreSQL and NATS to be provided as platform services.
