// Axonal Bus — NATS JetStream client.
// Every cross-service signal in ECCA flows through this bus.

import { connect, type NatsConnection, type JetStreamClient, type Subscription, JSONCodec } from 'nats';
import pino from 'pino';
import { STREAM_CONFIG, type EccaEvent } from '@ecca/proto';

const log = pino({ name: 'axonal-bus', level: process.env.LOG_LEVEL ?? 'info' });
const codec = JSONCodec<EccaEvent>();

export class AxonalBus {
  private nc!: NatsConnection;
  private js!: JetStreamClient;
  constructor(private readonly url: string = process.env.NATS_URL ?? 'nats://axonal-bus:4222') {}

  async connect(): Promise<void> {
    this.nc = await connect({ servers: this.url, name: 'ecca-svc', reconnect: true, maxReconnectAttempts: -1 });
    this.js = this.nc.jetstream();

    // Ensure stream exists
    try {
      const jsm = await this.nc.jetstreamManager();
      await jsm.streams.add({
        name: STREAM_CONFIG.name,
        subjects: [...STREAM_CONFIG.subjects],
        retention: 'limits' as any,
        max_msgs: STREAM_CONFIG.max_msgs,
        max_age: STREAM_CONFIG.max_age_ns,
      } as any);
    } catch (err: any) {
      if (!String(err.message ?? '').includes('stream name already in use')) throw err;
    }
    log.info({ url: this.url }, 'axonal-bus connected');
  }

  /** Publish a typed event. Subject is derived from event.type. */
  async publish(event: EccaEvent): Promise<void> {
    const subject = `ecca.${event.type.replace(/\./g, '.')}`;
    await this.js.publish(subject, codec.encode(event));
  }

  /** Lightweight pub/sub (no persistence) — used for high-frequency drift ticks. */
  publishLight(subject: string, payload: unknown): void {
    this.nc.publish(subject, JSONCodec().encode(payload));
  }

  /** Durable consumer — survives service restarts. */
  async subscribe<T extends EccaEvent>(
    subject: string,
    durableName: string,
    handler: (event: T) => Promise<void> | void,
  ): Promise<Subscription> {
    const opts = { durable_name: durableName, ack_explicit: true } as any;
    const sub = await this.js.subscribe(subject, opts as any);
    (async () => {
      for await (const m of sub) {
        try {
          const parsed = codec.decode(m.data) as T;
          await handler(parsed);
          m.ack();
        } catch (e) {
          log.error({ err: e, subject }, 'bus handler failed');
          m.nak();
        }
      }
    })().catch((e) => log.error({ err: e }, 'subscribe loop crashed'));
    return sub as unknown as Subscription;
  }

  async close(): Promise<void> { await this.nc?.drain(); }
}

let _bus: AxonalBus | undefined;
export async function getBus(): Promise<AxonalBus> {
  if (!_bus) { _bus = new AxonalBus(); await _bus.connect(); }
  return _bus;
}
