import type { Redis } from 'ioredis';

export interface LeaseProvider {
  acquire(key: string, owner: string): Promise<boolean>;
  renew(key: string, owner: string): Promise<boolean>;
  release(key: string, owner: string): Promise<void>;
}

export class RedisLease implements LeaseProvider {
  constructor(private readonly redis: Redis, private readonly ttlMs = 30_000) {}

  async acquire(key: string, owner: string): Promise<boolean> {
    return (await this.redis.set(`workflow-lease:${key}`, owner, 'PX', this.ttlMs, 'NX')) === 'OK';
  }

  async renew(key: string, owner: string): Promise<boolean> {
    const result = await this.redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end", 1, `workflow-lease:${key}`, owner, this.ttlMs);
    return result === 1;
  }

  async release(key: string, owner: string): Promise<void> {
    await this.redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, `workflow-lease:${key}`, owner);
  }
}
