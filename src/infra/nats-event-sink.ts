import { jetstream } from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/nats-core';
import type { EventSink } from '../domain/events.js';

export class NatsWorkflowEventSink {
  private readonly client: ReturnType<typeof jetstream>;
  constructor(private readonly connection: NatsConnection, private readonly subject = 'workflows.events') {
    this.client = jetstream(connection);
  }

  readonly publish: EventSink = async (event) => {
    await this.client.publish(this.subject, new TextEncoder().encode(JSON.stringify(event)));
  };
}
