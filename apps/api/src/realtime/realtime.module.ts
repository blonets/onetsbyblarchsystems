import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { REALTIME_PORT } from './realtime.port.js';

/**
 * Realtime module. Binds REALTIME_PORT to the Socket.IO gateway so every
 * service can push live updates without importing the gateway class.
 * (AuthModule is imported for JwtService — handshake token verification.)
 */
@Module({
  imports: [AuthModule],
  providers: [RealtimeGateway, { provide: REALTIME_PORT, useExisting: RealtimeGateway }],
  exports: [REALTIME_PORT],
})
export class RealtimeModule {}
