import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { Public } from '../auth/decorators/public.decorator.js';
import { getCorsOptions } from '../common/cors.js';
import { REALTIME_PORT, type RealtimePort } from './realtime.port.js';

interface JoinPayload {
  routerId?: string;
  siteId?: string;
}

/**
 * Socket.IO gateway — live pushes to dashboards.
 *
 * CORS: `getCorsOptions()` is passed explicitly. Without it, production
 * browsers block the Socket.IO handshake (the failure mode that bit us:
 * REST worked, sockets were silently refused).
 *
 * Auth: the global JwtAuthGuard is skipped via class-level @Public() (HTTP
 * semantics don't map to sockets); instead the handshake bearer <redacted> (or
 * `auth.token`) is verified here and the socket is dropped when invalid.
 *
 * Rooms: `router:<id>` and `site:<id>`. Clients join via the `join` message
 * after connecting. Emits use the LiveEventName vocabulary from @mtk/types
 * (`router.status`, `command.result`, `metrics.tick`, `alert`,
 * `downstream.discovered`).
 */
@Public()
@WebSocketGateway({
  cors: getCorsOptions(),
  transports: ['websocket', 'polling'],
})
export class RealtimeGateway
  implements RealtimePort, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(private readonly jwt: JwtService) {}

  async handleConnection(client: Socket): Promise<void> {
    const raw =
      client.handshake.auth?.token ??
      (Array.isArray(client.handshake.query?.token)
        ? client.handshake.query.token[0]
        : client.handshake.query?.token) ??
      client.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');
    try {
      const payload = this.jwt.verify(String(raw ?? ''));
      client.data.user = payload;
      this.logger.debug(`socket ${client.id} connected as ${payload?.sub ?? 'unknown'}`);
    } catch {
      this.logger.warn(`socket ${client.id} presented an invalid token — disconnecting`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`socket ${client.id} disconnected`);
  }

  @SubscribeMessage('join')
  handleJoin(client: Socket, data: JoinPayload): { ok: boolean; rooms: string[] } {
    const rooms: string[] = [];
    if (typeof data?.routerId === 'string' && data.routerId.length > 0) {
      rooms.push(`router:${data.routerId}`);
    }
    if (typeof data?.siteId === 'string' && data.siteId.length > 0) {
      rooms.push(`site:${data.siteId}`);
    }
    for (const room of rooms) void client.join(room);
    return { ok: true, rooms };
  }

  @SubscribeMessage('leave')
  handleLeave(client: Socket, data: JoinPayload): { ok: boolean } {
    if (typeof data?.routerId === 'string') void client.leave(`router:${data.routerId}`);
    if (typeof data?.siteId === 'string') void client.leave(`site:${data.siteId}`);
    return { ok: true };
  }

  emitToRouter(routerId: string, event: string, payload: unknown): void {
    this.server?.to(`router:${routerId}`).emit(event, payload);
  }

  emitToSite(siteId: string, event: string, payload: unknown): void {
    this.server?.to(`site:${siteId}`).emit(event, payload);
  }

  broadcast(event: string, payload: unknown): void {
    this.server?.emit(event, payload);
  }
}
