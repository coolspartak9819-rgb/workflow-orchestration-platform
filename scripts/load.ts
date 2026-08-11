const baseUrl = process.env.BASE_URL ?? 'http://localhost:8080';
const total = Number(process.env.TOTAL ?? 500);
const concurrency = Number(process.env.CONCURRENCY ?? 25);
const definition = {
  name: 'checkout', version: 1, steps: [
    { id: 'reserve', name: 'reserve-inventory', dependsOn: [], retry: { maxAttempts: 1, backoffMs: 0 } },
    { id: 'charge', name: 'charge-payment', dependsOn: ['reserve'], retry: { maxAttempts: 1, backoffMs: 0 } },
  ],
};
let next = 0;
let completed = 0;
let failed = 0;
const startedAt = performance.now();
const worker = async () => {
  while (true) {
    const index = next++;
    if (index >= total) return;
    const response = await fetch(`${baseUrl}/v1/workflows`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': `load-${index % 20}`, 'idempotency-key': `load-${index}` },
      body: JSON.stringify({ definition }),
    });
    if (response.ok) completed += 1; else failed += 1;
  }
};
await Promise.all(Array.from({ length: Math.min(total, concurrency) }, worker));
const seconds = (performance.now() - startedAt) / 1000;
console.log(JSON.stringify({ total, completed, failed, seconds: Number(seconds.toFixed(3)), rps: Number((total / seconds).toFixed(2)) }, null, 2));
