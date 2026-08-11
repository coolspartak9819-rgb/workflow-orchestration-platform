import type { LeaseProvider } from '../infra/redis-lease.js';

export class WorkflowWorker {
  constructor(private readonly lease: LeaseProvider, private readonly heartbeatMs = 10_000) {}

  async process(executionId: string, workerId: string, handler: () => Promise<void>): Promise<boolean> {
    if (!await this.lease.acquire(executionId, workerId)) return false;
    const heartbeat = setInterval(() => { void this.lease.renew(executionId, workerId); }, this.heartbeatMs);
    try {
      await handler();
      return true;
    } finally {
      clearInterval(heartbeat);
      await this.lease.release(executionId, workerId);
    }
  }
}
