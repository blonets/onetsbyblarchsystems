import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RosConnection, TcpTransport, pppSecretAdd } from '@mtk/ros-api';
import type { Transport } from '@mtk/ros-api';
import {
  allocateTunnelIp,
  generateRouterCredentials,
  issueOnboardingToken,
} from './credentials.js';

export interface ProvisioningConfig {
  hubHost: string;
  hubPort: number;
  hubUsername: string;
  hubPassword: string;
}

export const PROVISIONING_CONFIG = Symbol('PROVISIONING_CONFIG');
export const ROS_TRANSPORT_FACTORY = Symbol('ROS_TRANSPORT_FACTORY');

/** Creates the transport ros-api talks to. Injected so tests can pass a fake. */
export type RosTransportFactory = (host: string, port: number) => Transport;

export const defaultTransportFactory: RosTransportFactory = (host, port) =>
  new TcpTransport({ host, port });

/**
 * Provisioning: mints per-router SSTP credentials, allocates the static tunnel
 * IP, and creates the hub-side `/ppp secret` via ros-api.
 *
 * The SSTP *password* is never returned to callers and never logged — it goes
 * straight to the vault (TODO: `sstpPasswordRef`) and is delivered to the site
 * router exactly once through the onboarding-token exchange endpoint (TODO).
 */
@Injectable()
export class ProvisioningService {
  constructor(
    @Inject(PROVISIONING_CONFIG) private readonly config: ProvisioningConfig,
    @Optional() @Inject(ROS_TRANSPORT_FACTORY) private readonly transportFactory?: RosTransportFactory,
  ) {}

  private factory(): RosTransportFactory {
    return this.transportFactory ?? defaultTransportFactory;
  }

  generateCredentials(): { username: string; password: string } {
    return generateRouterCredentials();
  }

  allocateTunnelIp(used: Set<string>): string {
    return allocateTunnelIp(used);
  }

  issueOnboardingToken(routerId: string): { token: string; expiresAt: string } {
    const t = issueOnboardingToken(routerId);
    // TODO: persist ProvisioningToken row so redemption can be verified + burned.
    return { token: t.token, expiresAt: t.expiresAt };
  }

  /**
   * Create the hub-side `/ppp secret` for a site router.
   * REAL ros-api logic; the transport is injectable so this is unit-tested
   * with a fake (no network).
   */
  async provisionRouterOnHub(input: {
    routerUuid: string;
    sstpUsername: string;
    sstpPassword: string;
    tunnelIp: string;
  }): Promise<void> {
    const transport = this.factory()(this.config.hubHost, this.config.hubPort);
    const conn = new RosConnection(transport);
    try {
      await conn.connect();
      await conn.login(this.config.hubUsername, this.config.hubPassword);
      await conn.talk(
        pppSecretAdd({
          name: input.sstpUsername,
          password: input.sstpPassword,
          service: 'sstp',
          profile: 'default',
          remoteAddress: input.tunnelIp,
          comment: `panel-router:${input.routerUuid}`,
        }),
      );
    } finally {
      await conn.close().catch(() => undefined);
    }
  }

  /**
   * Full onboarding orchestration for a new site router.
   *
   * TODO (DB wiring):
   * - load used tunnel IPs from the Router table instead of the `usedTunnelIps` arg
   * - persist the Router row with status 'provisioning'
   * - store the SSTP password in the vault, save only `sstpPasswordRef`
   * - persist + return the onboarding token; the device redeems it once via
   *   POST /provisioning/redeem to receive its credentials, then the token burns
   * - enqueue a worker job that verifies the tunnel comes up (identity comment check)
   */
  async provisionNewRouter(input: {
    routerUuid: string;
    usedTunnelIps: string[];
  }): Promise<{ sstpUsername: string; tunnelIp: string }> {
    const { username, password } = generateRouterCredentials();
    const tunnelIp = allocateTunnelIp(new Set(input.usedTunnelIps));
    await this.provisionRouterOnHub({
      routerUuid: input.routerUuid,
      sstpUsername: username,
      sstpPassword: password,
      tunnelIp,
    });
    return { sstpUsername: username, tunnelIp };
  }
}

/** Builds the NestJS provider values for ProvisioningService from env config. */
export function provisioningProviders() {
  return [
    {
      provide: PROVISIONING_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ProvisioningConfig => ({
        hubHost: config.getOrThrow<string>('SSTP_HUB_HOST'),
        hubPort: Number(config.get('SSTP_HUB_API_PORT') ?? 8728),
        hubUsername: config.getOrThrow<string>('SSTP_HUB_API_USER'),
        hubPassword: config.getOrThrow<string>('SSTP_HUB_API_PASSWORD'),
      }),
    },
    { provide: ROS_TRANSPORT_FACTORY, useValue: defaultTransportFactory },
    ProvisioningService,
  ];
}
