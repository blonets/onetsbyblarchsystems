import { EventEmitter } from 'node:events';
import { Global, Injectable, Module } from '@nestjs/common';
import type { BusEventName, BusEventPayload } from '@mtk/types';

/**
 * Typed platform event bus.
 *
 * STABLE CONTRACT (ARCHITECTURE.md / ROADMAP.md): `emitEvent(name, payload)`
 * with `name` in the documented set. Phase-2 modules subscribe via
 * `onEvent(...)` — they never patch existing modules.
 *
 * Events emitted here:
 * - router.online | router.offline — connection-manager heartbeats / callbacks
 * - hotspot.user.login | hotspot.user.logout — worker accounting (Phase 1: via API ingest)
 * - quota.exceeded — quota-enforcer
 * - backup.completed — backup worker
 * - config.changed — every successful router config mutation
 * - alert.raised — monitoring / safety systems
 */
@Injectable()
export class EventsService extends EventEmitter {
  emitEvent<K extends BusEventName>(name: K, payload: BusEventPayload[K]): boolean {
    return this.emit(name, payload);
  }

  onEvent<K extends BusEventName>(
    name: K,
    listener: (payload: BusEventPayload[K]) => void,
  ): this {
    return this.on(name, listener);
  }

  onceEvent<K extends BusEventName>(
    name: K,
    listener: (payload: BusEventPayload[K]) => void,
  ): this {
    return this.once(name, listener);
  }
}

@Global()
@Module({
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
