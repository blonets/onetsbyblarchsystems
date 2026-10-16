import type { CommandResultPayload } from '@mtk/types';

/**
 * Port for pushing live updates to connected dashboards.
 * Implemented by the Socket.IO gateway; optional everywhere else.
 */
export interface RealtimePort {
  emitToRouter(routerId: string, event: string, payload: unknown): void;
  emitToSite(siteId: string, event: string, payload: unknown): void;
  broadcast(event: string, payload: unknown): void;
}

export const REALTIME_PORT = Symbol('REALTIME_PORT');

/** No-op implementation used when the gateway is not loaded (tests). */
export class NullRealtime implements RealtimePort {
  emitToRouter(): void {}
  emitToSite(): void {}
  broadcast(): void {}
}

/** Result of a worker-executed command, posted to /internal/commands/results. */
export type { CommandResultPayload };
