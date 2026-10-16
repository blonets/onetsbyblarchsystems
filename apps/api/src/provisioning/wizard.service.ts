import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import {
  dhcpNetworkAdd,
  dhcpServerAdd,
  hotspotServerAdd,
  hotspotServerProfileAdd,
  ipAddressAdd,
  ipPoolAdd,
  natRuleAdd,
  walledGardenAdd,
} from '@mtk/ros-api';
import {
  newOpId,
  type HotspotSetupWizardPreview,
  type HotspotSetupWizardStep,
} from '@mtk/types';
import type { CurrentUserType } from '../common/types.js';
import { DB_PORT, type DbPort } from '../db/database.port.js';
import { RouterCommandsService } from '../commands/commands.service.js';
import type { HotspotSetupWizardDto } from './dto/wizard.dto.js';

export interface ResolvedWizardParams {
  iface: string;
  hotspotAddress: string;
  gateway: string;
  network: string;
  poolName: string;
  poolRange: string;
  dhcpServerName: string;
  leaseTime: string;
  dnsServers: string;
  outInterface: string;
  serverProfileName: string;
  dnsName?: string;
  loginBy: string;
  serverName: string;
  walledGardenHosts: string[];
}

/**
 * Derive the network address + gateway from a CIDR hotspot address.
 * Pure — unit-testable. Throws on malformed input.
 */
export function deriveNetwork(cidr: string): { network: string; gateway: string } {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(cidr.trim());
  if (!m) {
    throw new UnprocessableEntityException(
      `hotspotAddress must be CIDR like "192.168.10.1/24", got "${cidr}"`,
    );
  }
  const octets = m.slice(1, 5).map(Number);
  const prefix = Number(m[5]);
  if (octets.some((o) => o > 255) || prefix < 1 || prefix > 32) {
    throw new UnprocessableEntityException(`invalid CIDR "${cidr}"`);
  }
  const toNum = (o: number[]) => ((o[0] * 256 + o[1]) * 256 + o[2]) * 256 + o[3];
  const fmt = (v: number) =>
    [Math.floor(v / 16777216) % 256, Math.floor(v / 65536) % 256, Math.floor(v / 256) % 256, v % 256].join('.');
  const ip = toNum(octets);
  const net = ip - (ip % 2 ** (32 - prefix));
  return { network: `${fmt(net)}/${prefix}`, gateway: fmt(ip) };
}

export function resolveWizardParams(dto: HotspotSetupWizardDto): ResolvedWizardParams {
  const { network, gateway } = deriveNetwork(dto.hotspotAddress);
  const lastOctet = gateway.split('.');
  const base = lastOctet.slice(0, 3).join('.');
  return {
    iface: dto.interface,
    hotspotAddress: dto.hotspotAddress,
    gateway,
    network,
    poolName: dto.poolName ?? 'hotspot-pool',
    poolRange: dto.poolRange ?? `${base}.100-${base}.200`,
    dhcpServerName: dto.dhcpServerName ?? 'hotspot-dhcp',
    leaseTime: dto.leaseTime ?? '1h',
    dnsServers: dto.dnsServers ?? '8.8.8.8,1.1.1.1',
    outInterface: dto.outInterface ?? 'ether1',
    serverProfileName: dto.serverProfileName ?? 'hotspot-profile',
    dnsName: dto.dnsName,
    loginBy: dto.loginBy ?? 'http-pap,http-chap,cookie',
    serverName: dto.serverName ?? 'hotspot1',
    walledGardenHosts: dto.walledGardenHosts ?? [],
  };
}

/**
 * NOTE on the `dns` step: @mtk/ros-api has no /ip/dns builder yet, so the
 * sentence below is built inline. It MUST move to @mtk/ros-api when it
 * gains one (same interim pattern as the hotspot ip-binding sentences).
 */
function dnsSetSentence(servers: string): string[] {
  return ['/ip/dns/set', `=servers=${servers}`, '=allow-remote-requests=yes'];
}

/**
 * Build the wizard's sentence batch, grouped into guided steps.
 * Pure (no DB, no queue) — the preview endpoint returns this directly.
 */
export function buildHotspotSetupSteps(p: ResolvedWizardParams): HotspotSetupWizardStep[] {
  const steps: HotspotSetupWizardStep[] = [
    {
      key: 'address',
      title: 'Hotspot gateway address',
      sentences: [
        ipAddressAdd({
          address: p.hotspotAddress,
          interface: p.iface,
          network: p.network.split('/')[0],
          comment: 'panel-wizard: hotspot gateway',
        }),
      ],
      notes: [`Assigns ${p.hotspotAddress} to ${p.iface}.`],
    },
    {
      key: 'pool',
      title: 'Client address pool',
      sentences: [
        ipPoolAdd({ name: p.poolName, ranges: p.poolRange, comment: 'panel-wizard: hotspot clients' }),
      ],
      notes: [`Pool ${p.poolName}: ${p.poolRange}.`],
    },
    {
      key: 'dhcp',
      title: 'DHCP server + network',
      sentences: [
        dhcpNetworkAdd({
          address: p.network,
          gateway: p.gateway,
          dnsServer: p.dnsServers,
          comment: 'panel-wizard: hotspot network',
        }),
        dhcpServerAdd({
          name: p.dhcpServerName,
          interface: p.iface,
          addressPool: p.poolName,
          leaseTime: p.leaseTime,
          authoritative: true,
          comment: 'panel-wizard: hotspot dhcp',
        }),
      ],
      notes: [`Network ${p.network}, gateway ${p.gateway}, DNS ${p.dnsServers}.`],
    },
    {
      key: 'dns',
      title: 'Router DNS',
      sentences: [dnsSetSentence(p.dnsServers)],
      notes: ['Enables DNS relay so the hotspot login page resolves before auth.'],
    },
    {
      key: 'nat',
      title: 'NAT masquerade',
      sentences: [
        natRuleAdd({
          chain: 'srcnat',
          action: 'masquerade',
          outInterface: p.outInterface,
          comment: 'panel-wizard: hotspot masquerade',
        }),
      ],
      notes: [`Masquerades hotspot clients out via ${p.outInterface}.`],
    },
  ];

  if (p.walledGardenHosts.length > 0) {
    steps.push({
      key: 'walled-garden',
      title: 'Walled garden',
      sentences: p.walledGardenHosts.map((host) =>
        walledGardenAdd({ dstHost: host, action: 'allow', comment: 'panel-wizard: pre-auth allow' }),
      ),
      notes: ['Reachable before login (e.g. payment gateways).'],
    });
  }

  steps.push(
    {
      key: 'server-profile',
      title: 'Hotspot server profile',
      sentences: [
        hotspotServerProfileAdd({
          name: p.serverProfileName,
          hotspotAddress: p.gateway,
          dnsName: p.dnsName,
          loginBy: p.loginBy,
          comment: 'panel-wizard',
        }),
      ],
      notes: [`Login methods: ${p.loginBy}.`],
    },
    {
      key: 'server',
      title: 'Hotspot server',
      sentences: [
        hotspotServerAdd({
          name: p.serverName,
          interface: p.iface,
          addressPool: p.poolName,
          profile: p.serverProfileName,
        }),
      ],
      notes: [`Binds ${p.iface} to profile ${p.serverProfileName}.`],
    },
    {
      key: 'login-page',
      title: 'Login page (manual)',
      sentences: [],
      notes: [
        'PLACEHOLDER — RouterOS serves the login page from Files; it cannot be pushed over the API.',
        'Upload your branded login.html via WinBox → Files, then set html-directory on the server profile.',
        'Until then the stock RouterOS login page is served.',
      ],
    },
  );
  return steps;
}

/**
 * Setup wizard: ONE guided, opId-tracked step that generates the full
 * hotspot sentence batch. Preview (default) returns the steps; confirm=true
 * enqueues them as a single command (idempotent by opId).
 */
@Injectable()
export class HotspotSetupWizardService {
  constructor(
    @Inject(DB_PORT) private readonly db: DbPort,
    private readonly commands: RouterCommandsService,
  ) {}

  async preview(routerId: string, dto: HotspotSetupWizardDto): Promise<HotspotSetupWizardPreview> {
    await this.commands.requireRouter(routerId);
    const opId = dto.opId ?? newOpId();
    const steps = buildHotspotSetupSteps(resolveWizardParams(dto));
    return {
      opId,
      routerId,
      steps,
      totalSentences: steps.reduce((n, s) => n + s.sentences.length, 0),
    };
  }

  async run(routerId: string, dto: HotspotSetupWizardDto, actor?: CurrentUserType) {
    const { opId, steps } = await this.preview(routerId, dto);

    // Idempotency BEFORE any writes: a replayed opId returns the original
    // outcome instead of re-applying the wizard.
    const existing = await this.db.auditLogs.findUnique({ opId });
    if (existing) {
      return { opId, auditId: existing.id, jobId: opId, replayed: true as const };
    }

    const p = resolveWizardParams(dto);
    // Best-effort mirror rows so the new server/profile show up in the panel
    // (mikrotikId reconciles later via the normal reconciliation pass).
    const serverDupe = await this.db.hotspotServers.findFirst({ routerId, name: p.serverName });
    if (!serverDupe) {
      await this.db.hotspotServers.create({
        routerId,
        name: p.serverName,
        interface: p.iface,
        addressPool: p.poolName,
        profile: p.serverProfileName,
      });
    }
    const profileDupe = await this.db.hotspotProfiles.findFirst({ routerId, name: p.serverProfileName });
    if (!profileDupe) {
      await this.db.hotspotProfiles.create({
        routerId,
        name: p.serverProfileName,
        hotspotAddress: p.gateway,
        dnsName: p.dnsName ?? null,
        loginBy: p.loginBy,
      });
    }

    const sentences = steps.flatMap((s) => s.sentences);
    const enq = await this.commands.enqueueRos({
      routerId,
      action: 'provisioning.wizard.hotspot-setup',
      sentences,
      opId,
      actorId: actor?.sub,
      after: {
        steps: steps.map((s) => s.key),
        serverName: p.serverName,
        serverProfileName: p.serverProfileName,
      },
    });
    return { ...enq, steps: steps.map((s) => ({ key: s.key, title: s.title, sentences: s.sentences.length })) };
  }
}
