import { jetstream, jetstreamManager } from '@nats-io/jetstream';
import type { JetStreamClient } from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/nats-core';
import type { TaskDispatcher } from '../service/task-dispatcher.js';

export type WorkflowTask = { executionId: string; tenantId: string };

export class NatsTaskQueue implements TaskDispatcher {
  private readonly client: JetStreamClient;
  constructor(private readonly connection: NatsConnection, private readonly stream = 'WORKFLOW_TASKS', private readonly subject = 'workflows.tasks') {
    this.client = jetstream(connection);
  }

  async ensure(): Promise<void> {
    const manager = await jetstreamManager(this.connection);
    try { await manager.streams.info(this.stream); }
    catch { await manager.streams.add({ name: this.stream, subjects: [this.subject], retention: 'limits' }); }
  }

  async publish(task: WorkflowTask): Promise<void> { await this.client.publish(this.subject, new TextEncoder().encode(JSON.stringify(task))); }
  async dispatch(task: WorkflowTask): Promise<void> { await this.publish(task); }

  async consume(consumerName: string, handler: (task: WorkflowTask) => Promise<void>): Promise<void> {
    const manager = await jetstreamManager(this.connection);
    try { await manager.consumers.info(this.stream, consumerName); }
    catch { await manager.consumers.add(this.stream, { durable_name: consumerName, ack_policy: 'explicit', ack_wait: 30_000 }); }
    const consumer = await this.client.consumers.get(this.stream, consumerName);
    const messages = await consumer.consume({ max_messages: 1 });
    for await (const message of messages) {
      try { await handler(JSON.parse(new TextDecoder().decode(message.data)) as WorkflowTask); message.ack(); }
      catch { message.nak(1_000); }
    }
  }
}
