/**
 * Typed live-update layer.
 *
 * - `SocketLike` is the contract pages code against (join/leave rooms, subscribe).
 * - `MockSocket` — dev adapter: replays plausible `router:status` /
 *   `router:metrics` / `fleet:overview` events on timers so live UI can be
 *   built and demoed without a backend. Clearly marked.
 * - `RealSocket` — production adapter over socket.io-client, JWT in auth payload,
 *   auto-reconnect; joins `router:<id>` / `site:<id>` rooms like the NestJS gateway.
 *
 * `useSocketRoom(room, event, handler)` subscribes inside React.
 */
'use client';

import { useEffect, useRef } from 'react';
import type { AuditEvent, RouterStatus } from '@mtk/types';
import type { FleetHealth, MetricPoint } from './types';
import { currentAccessToken } from './api-client';

export interface SocketEventMap {
  'router:status': { routerId: string; status: RouterStatus; lastSeen: string };
  'router:metrics': { routerId: string; point: MetricPoint };
  'fleet:overview': FleetHealth;
  'audit:new': AuditEvent;
}

export type SocketEvent = keyof SocketEventMap;

export interface SocketLike {
  readonly connected: boolean;
  join(room: string): void;
  leave(room: string): void;
  on<E extends SocketEvent>(event: E, handler: (payload: SocketEventMap[E]) => void): () => void;
  disconnect(): void;
}

type Handler = (payload: never) => void;

/** Dev-only simulator. Emits synthetic live events on a timer. */
class MockSocket implements SocketLike {
  connected = true;
  private handlers = new Map<SocketEvent, Set<Handler>>();
  private rooms = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private routerIds = ['r-001', 'r-002', 'r-003', 'r-004', 'r-hub'];

  constructor() {
    if (typeof window === 'undefined') return;
    this.timer = setInterval(() => this.tick(), 4000);
  }

  join(room: string): void {
    this.rooms.add(room);
  }
  leave(room: string): void {
    this.rooms.delete(room);
  }

  on<E extends SocketEvent>(event: E, handler: (payload: SocketEventMap[E]) => void): () => void {
    const set = this.handlers.get(event) ?? new Set<Handler>();
    set.add(handler as Handler);
    this.handlers.set(event, set);
    return () => {
      set.delete(handler as Handler);
    };
  }

  disconnect(): void {
    if (this.timer) clearInterval(this.timer);
    this.handlers.clear();
  }

  private emit<E extends SocketEvent>(event: E, payload: SocketEventMap[E]): void {
    this.handlers.get(event)?.forEach((h) => {
      try {
        (h as (p: SocketEventMap[E]) => void)(payload);
      } catch {
        /* listener errors must not kill the pump */
      }
    });
  }

  private tick(): void {
    // Simulate a metrics heartbeat for whichever router rooms are joined.
    for (const room of this.rooms) {
      const m = room.match(/^router:(.+)$/);
      if (!m) continue;
      const routerId = m[1];
      this.emit('router:metrics', {
        routerId,
        point: {
          ts: new Date().toISOString(),
          cpuPct: Math.max(2, Math.round(28 + Math.sin(Date.now() / 20000) * 10 + Math.random() * 8)),
          memPct: Math.round(58 + Math.random() * 4),
          rxBps: Math.round(4_000_000 + Math.random() * 3_000_000),
          txBps: Math.round(1_200_000 + Math.random() * 800_000),
          hotspotActive: Math.max(0, Math.round(18 + Math.random() * 10)),
        },
      });
    }
    // Occasionally flap the offline demo router back to life / back down.
    if (Math.random() < 0.12) {
      const id = this.routerIds[Math.floor(Math.random() * this.routerIds.length)];
      const status: RouterStatus = Math.random() < 0.5 ? 'online' : 'offline';
      this.emit('router:status', { routerId: id, status, lastSeen: new Date().toISOString() });
    }
  }
}

/** Production adapter over socket.io-client. Lazy-imported so the mock build stays lean.
 *
 * Connects to the fleet gateway at <NEXT_PUBLIC_API_URL>/fleet. Canonical
 * production host: https://admin.onetsbyblarch.online (see apps/web/.env.example).
 */
class RealSocket implements SocketLike {
  connected = false;
  private socket: import('socket.io-client').Socket | null = null;
  private subs = new Map<SocketEvent, Set<Handler>>();
  private rooms = new Set<string>();
  private ready: Promise<void>;

  constructor(baseUrl: string) {
    this.ready = (async () => {
      const { io } = await import('socket.io-client');
      const token = currentAccessToken();
      this.socket = io(`${baseUrl}/fleet`, {
        auth: { token },
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: 2000,
      });
      this.socket.on('connect', () => {
        this.connected = true;
        for (const room of this.rooms) this.socket?.emit('join', room);
      });
      this.socket.on('disconnect', () => {
        this.connected = false;
      });
      for (const event of ['router:status', 'router:metrics', 'fleet:overview', 'audit:new'] as SocketEvent[]) {
        this.socket.on(event, (payload: SocketEventMap[typeof event]) => {
          this.subs.get(event)?.forEach((h) => {
            try {
              (h as (p: unknown) => void)(payload);
            } catch {
              /* ignore listener errors */
            }
          });
        });
      }
    })();
  }

  join(room: string): void {
    this.rooms.add(room);
    void this.ready.then(() => this.socket?.emit('join', room));
  }
  leave(room: string): void {
    this.rooms.delete(room);
    void this.ready.then(() => this.socket?.emit('leave', room));
  }
  on<E extends SocketEvent>(event: E, handler: (payload: SocketEventMap[E]) => void): () => void {
    const set = this.subs.get(event) ?? new Set<Handler>();
    set.add(handler as Handler);
    this.subs.set(event, set);
    return () => {
      set.delete(handler as Handler);
    };
  }
  disconnect(): void {
    this.socket?.disconnect();
    this.subs.clear();
  }
}

const useMock = (() => {
  const override = process.env.NEXT_PUBLIC_MOCK_API;
  if (override !== undefined) return override === 'true';
  return !process.env.NEXT_PUBLIC_API_URL;
})();

let singleton: SocketLike | null = null;

/** Client-side singleton. Safe to call during SSR (returns a no-op until mounted). */
export function getSocket(): SocketLike {
  if (typeof window === 'undefined') {
    return {
      connected: false,
      join() {},
      leave() {},
      on() {
        return () => {};
      },
      disconnect() {},
    };
  }
  if (!singleton) {
    singleton = useMock
      ? new MockSocket()
      : new RealSocket((process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, ''));
  }
  return singleton;
}

export function isMockSocket(): boolean {
  return useMock;
}

/**
 * Join a Socket.IO room while mounted and handle one event type.
 * Re-subscribes when the room changes.
 */
export function useSocketRoom<E extends SocketEvent>(
  room: string | null,
  event: E,
  handler: (payload: SocketEventMap[E]) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!room) return;
    const socket = getSocket();
    socket.join(room);
    const off = socket.on(event, (p) => handlerRef.current(p));
    return () => {
      off();
      socket.leave(room);
    };
  }, [room, event]);
}
