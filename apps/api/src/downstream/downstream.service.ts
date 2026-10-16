import { Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { downstreamProxyRuleAdd, natRuleRemove, neighborList } from '@mtk/ros-api';
import type { DeviceMgmtMethods, DeviceVendor, DownstreamDevice, DownstreamKind } from '@mtk/types';
import { AuditService } from '../audit/audit.service.js';
import type { CurrentUserType } from '../common/types.js';
import { DB_PORT, type DbPort } from '../db/database.port.js';
import type { DownstreamDeviceRow } from '../db/rows.js';
import { EventsService } from '../events/events.module.js';
import { DISCOVERY_RAW_EVENT, RouterCommandsService, type EnqueuedCommand } from '../commands/commands.service.js';
import { getDriver, type DeviceDriverContext } from './device-driver.js';
import { REALTIME_PORT, type RealtimePort } from '../realtime/realtime.port.js';
import { VAULT_PORT, type VaultPort } from '../vault/vault.port.js';
import { allocateTunnelIp, generateRouterCredentials } from '../provisioning/credentials.js';
import type { RegisterDeviceDto, UpdateDeviceDto } from './dto/downstream.dto.js';

/**
 * Downstream-device proxy — devices behind a site router (APs, cameras, POS,
 * switches, cascaded MikroTiks) discovered via `/ip/neighbor` and reached
 * through platform-managed dst-nat rules (`comment=panel-proxy:<deviceId>`).
 *
 * - `discover` enqueues a neighbor print; the worker's result rows come back
 *   tagged `downstream-discover` and are ingested here (see note on row
 *   shapes below).
 * - `enableProxy` allocates a tunnel-side port and installs the dst-nat rule;
 *   the rule is mirrored in the firewall table so the firewall UI shows it.
 * - A downstream MikroTik can be *cascade-registered* as a managed Router;
 *   full onboarding (hub /ppp secret) still goes through the provisioning
 *   token flow.
 */
@Injectable()
export class DownstreamService {
  private readonly logger = new Logger(DownstreamService.name);

  constructor(
    @Inject(DB_PORT) private readonly db: DbPort,
    @Inject(VAULT_PORT) private readonly vault: VaultPort,
    private readonly commands: RouterCommandsService,
    @Inject(REALTIME_PORT) private readonly realtime: RealtimePort,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    // Internal handoff from RouterCommandsService.reportResult() — NOT part of
    // the stable Phase-2 bus contract.
    this.events.on(DISCOVERY_RAW_EVENT, (payload: { routerId: string; rows: Record<string, string>[] }) => {
      this.ingestDiscovery(payload.routerId, payload.rows ?? []).catch((err) =>
        this.logger.error(`discovery ingest failed for ${payload.routerId}: ${(err as Error).message}`),
      );
    });
  }

  private async routerOrThrow(routerId: string) {
    const router = await this.db.routers.findUnique({ id: routerId });
    if (!router) throw new NotFoundException(`router ${routerId} not found`);
    return router;
  }

  private async deviceOrThrow(routerId: string, deviceId: string): Promise<DownstreamDeviceRow> {
    await this.routerOrThrow(routerId);
    const row = await this.db.downstreamDevices.findFirst({ routerId, deviceId });
    if (!row) throw new NotFoundException(`downstream device ${deviceId} not found`);
    return row;
  }

  // ------------------------------------------------------------------ CRUD --

  async list(routerId: string): Promise<DownstreamDevice[]> {
    await this.routerOrThrow(routerId);
    const rows = await this.db.downstreamDevices.findMany({ where: { routerId }, orderBy: { name: 'asc' } });
    return rows.map(toDto);
  }

  async register(routerId: string, dto: RegisterDeviceDto, actor?: CurrentUserType): Promise<DownstreamDevice> {
    await this.routerOrThrow(routerId);
    const deviceId = `dd-${randomBytes(4).toString('hex')}`;
    const row = await this.db.downstreamDevices.create({
      routerId,
      deviceId,
      name: dto.name,
      kind: dto.kind,
      vendor: dto.vendor ?? 'unknown',
      model: dto.model ?? null,
      mgmtMethods: dto.mgmtMethods ? { ...dto.mgmtMethods } : null,
      macAddress: dto.macAddress ?? null,
      lanIp: dto.lanIp,
      mgmtPort: dto.mgmtPort,
      protocol: dto.protocol ?? 'tcp',
    });
    await this.audit.append({
      actorId: actor?.sub ?? null,
      routerId,
      action: 'downstream.device.register',
      opId: dto.opId,
      after: { deviceId, name: dto.name, lanIp: dto.lanIp },
      result: 'done',
    });
    return toDto(row);
  }

  async update(routerId: string, deviceId: string, dto: UpdateDeviceDto, actor?: CurrentUserType): Promise<DownstreamDevice> {
    const row = await this.deviceOrThrow(routerId, deviceId);
    const updated = await this.db.downstreamDevices.update(
      { id: row.id },
      Object.fromEntries(
        Object.entries({
          name: dto.name,
          kind: dto.kind,
          vendor: dto.vendor,
          model: dto.model ?? undefined,
          mgmtMethods: dto.mgmtMethods ? { ...dto.mgmtMethods } : undefined,
          macAddress: dto.macAddress ?? undefined,
          lanIp: dto.lanIp,
          mgmtPort: dto.mgmtPort,
        }).filter(([, v]) => v !== undefined),
      ),
    );
    await this.audit.append({
      actorId: actor?.sub ?? null,
      routerId,
      action: 'downstream.device.update',
      opId: dto.opId,
      before: row,
      result: 'done',
    });
    return toDto(updated);
  }

  async remove(routerId: string, deviceId: string, opId: string | undefined, actor?: CurrentUserType): Promise<void> {
    const row = await this.deviceOrThrow(routerId, deviceId);
    if (row.proxyPort) {
      await this.disableProxy(routerId, deviceId, opId, actor);
    }
    await this.db.downstreamDevices.delete({ id: row.id });
    await this.audit.append({
      actorId: actor?.sub ?? null,
      routerId,
      action: 'downstream.device.remove',
      opId,
      before: { deviceId, name: row.name },
      result: 'done',
    });
  }

  // --------------------------------------------------------------- discovery --

  /** Enqueue a `/ip/neighbor/print`; results are ingested via the result tag. */
  async discover(routerId: string, opId: string | undefined, actor?: CurrentUserType): Promise<EnqueuedCommand> {
    await this.routerOrThrow(routerId);
    return this.commands.enqueueRos({
      routerId,
      action: 'downstream.discover',
      sentences: [[...neighborList()]],
      opId,
      actorId: actor?.sub,
      resultTag: 'downstream-discover',
    });
  }

  /**
   * Ingest neighbor rows from a discovery result.
   *
   * ROW SHAPE NOTE (rosapi-agent findings): `packages/ros-api` parsers return
   * *device* rows (`IpNeighbor`: id/interface/macAddress/identity/platform/
   * version/board/address) — NOT @mtk/types entities. The worker posts raw
   * reply records, so this normalizer accepts BOTH raw (`mac-address`,
   * `address`, `.id`) and parsed (`macAddress`, `lanIp`, `id`) key shapes,
   * and maps them into the platform `DownstreamDevice` entity.
   */
  async ingestDiscovery(routerId: string, rows: Record<string, string>[]): Promise<{ discovered: number; updated: number }> {
    let discovered = 0;
    let updated = 0;
    const now = new Date();
    for (const raw of rows) {
      const n = normalizeNeighbor(raw);
      if (!n.lanIp) continue;
      const matchKey = n.macAddress ?? n.lanIp;
      const existing = n.macAddress
        ? await this.db.downstreamDevices.findFirst({ routerId, macAddress: n.macAddress })
        : await this.db.downstreamDevices.findFirst({ routerId, lanIp: n.lanIp });
      const kind: DownstreamKind =
        n.platform && /mikrotik/i.test(n.platform) ? 'mikrotik' : 'other';
      // Vendor is classification metadata only (no vendor-specific config in
      // Phase 1). A manually-set vendor is never overwritten by a guess.
      const guessedVendor = guessVendor(n.platform);
      const mgmtMethods: DeviceMgmtMethods = { web: 80, ssh: 22 };
      if (existing) {
        await this.db.downstreamDevices.update(
          { id: existing.id },
          {
            lastSeen: now,
            name: n.identity ?? existing.name,
            kind: existing.kind === 'other' && kind === 'mikrotik' ? 'mikrotik' : existing.kind,
            vendor: existing.vendor === 'unknown' && guessedVendor !== 'unknown' ? guessedVendor : existing.vendor,
            model: existing.model ?? n.model ?? null,
            mgmtMethods: existing.mgmtMethods ?? mgmtMethods,
          },
        );
        updated++;
      } else {
        await this.db.downstreamDevices.create({
          routerId,
          deviceId: `dd-${randomBytes(4).toString('hex')}`,
          name: n.identity ?? matchKey,
          kind,
          vendor: guessedVendor,
          model: n.model ?? null,
          mgmtMethods,
          macAddress: n.macAddress ?? null,
          lanIp: n.lanIp,
          mgmtPort: kind === 'mikrotik' ? 8728 : 80,
          protocol: 'tcp',
        });
        // lastSeen is set on the follow-up update for uniformity.
        discovered++;
      }
    }
    // Stamp lastSeen on everything seen in this pass.
    const seenMacs = new Set(rows.map((r) => normalizeNeighbor(r).macAddress).filter(Boolean) as string[]);
    const seenIps = new Set(rows.map((r) => normalizeNeighbor(r).lanIp).filter(Boolean) as string[]);
    const all = await this.db.downstreamDevices.findMany({ where: { routerId } });
    for (const d of all) {
      if ((d.macAddress && seenMacs.has(d.macAddress)) || seenIps.has(d.lanIp)) {
        await this.db.downstreamDevices.update({ id: d.id }, { lastSeen: now }).catch(() => undefined);
      }
    }
    this.realtime.emitToRouter(routerId, 'downstream.discovered', { discovered, updated, at: now.toISOString() });
    return { discovered, updated };
  }

  // ------------------------------------------------------------------- proxy --

  /**
   * Allocate a tunnel-side port and install the dst-nat proxy rule.
   * Techs then reach the device at `<router tunnel IP>:<proxyPort>`.
   */
  async enableProxy(routerId: string, deviceId: string, opId: string | undefined, actor?: CurrentUserType) {
    const row = await this.deviceOrThrow(routerId, deviceId);
    if (row.proxyPort) return { device: toDto(row), alreadyEnabled: true as const };

    const proxyPort = await this.allocateProxyPort(routerId);
    const siblings = await this.db.firewallRules.findMany({
      where: { routerId, table: 'nat', chain: 'dstnat' },
      orderBy: { order: 'asc' },
    });
    const order = siblings.length === 0 ? 0 : Math.max(...siblings.map((r) => r.order)) + 1;
    const mirror = await this.db.firewallRules.create({
      routerId,
      table: 'nat',
      chain: 'dstnat',
      action: 'dst-nat',
      order,
      protocol: 'tcp',
      dstPort: String(proxyPort),
      toAddresses: row.lanIp,
      toPorts: String(row.mgmtPort),
      comment: `panel-proxy:${deviceId}`,
      disabled: false,
      managed: true,
    });
    const updated = await this.db.downstreamDevices.update({ id: row.id }, { proxyPort });
    const enq = await this.commands.enqueueRos({
      routerId,
      action: 'downstream.proxy.enable',
      sentences: [downstreamProxyRuleAdd(deviceId, proxyPort, row.lanIp, row.mgmtPort)],
      opId,
      actorId: actor?.sub,
      after: { deviceId, proxyPort, lanIp: row.lanIp, mgmtPort: row.mgmtPort },
      entity: { table: 'firewall', id: mirror.id },
    });
    return { device: toDto(updated), proxyPort, ...enq };
  }

  async disableProxy(routerId: string, deviceId: string, opId: string | undefined, actor?: CurrentUserType): Promise<EnqueuedCommand | { disabled: false }> {
    const row = await this.deviceOrThrow(routerId, deviceId);
    const mirror = await this.db.firewallRules.findFirst({
      routerId,
      table: 'nat',
      comment: `panel-proxy:${deviceId}`,
    });
    if (!mirror) {
      if (row.proxyPort) await this.db.downstreamDevices.update({ id: row.id }, { proxyPort: null });
      return { disabled: false as const };
    }
    if (!mirror.mikrotikId) {
      throw new UnprocessableEntityException('proxy rule has no device id yet — wait for the enable command to complete');
    }
    await this.db.firewallRules.delete({ id: mirror.id });
    await this.db.downstreamDevices.update({ id: row.id }, { proxyPort: null });
    return this.commands.enqueueRos({
      routerId,
      action: 'downstream.proxy.disable',
      sentences: [natRuleRemove(mirror.mikrotikId)],
      opId,
      actorId: actor?.sub,
      before: { deviceId, proxyPort: row.proxyPort },
    });
  }

  private async allocateProxyPort(routerId: string): Promise<number> {
    const start = Number(this.config.get('DOWNSTREAM_PROXY_PORT_START') ?? 40000);
    const end = Number(this.config.get('DOWNSTREAM_PROXY_PORT_END') ?? 49999);
    const used = new Set(
      (await this.db.downstreamDevices.findMany({ where: { routerId } }))
        .map((d) => d.proxyPort)
        .filter((p): p is number => p !== null),
    );
    for (let p = start; p <= end; p++) {
      if (!used.has(p)) return p;
    }
    throw new UnprocessableEntityException(`proxy port pool exhausted (${start}-${end})`);
  }

  /**
   * Vendor-neutral status probe for one device, via the DeviceDriver
   * contract. Phase 1 uses the generic TCP probe against the proxy endpoint;
   * Phase 2 drivers plug in behind `getDriver()` without changing this API.
   */
  async getStatus(routerId: string, deviceId: string) {
    const router = await this.routerOrThrow(routerId);
    const device = await this.deviceOrThrow(routerId, deviceId);
    const driver = getDriver(device.vendor as DeviceVendor);
    const ctx: DeviceDriverContext = {
      routerTunnelIp: router.tunnelIp,
      proxyPort: device.proxyPort,
      mgmtMethods: (device.mgmtMethods as DeviceMgmtMethods | null) ?? {},
      device: {
        deviceId: device.deviceId,
        name: device.name,
        vendor: device.vendor as DeviceVendor,
        model: device.model,
        lanIp: device.lanIp,
        mgmtPort: device.mgmtPort,
      },
    };
    return driver.getStatus(ctx);
  }

  // ----------------------------------------------------------------- cascade --

  /**
   * Register a downstream MikroTik as a managed router (cascade). Creates the
   * platform Router row with fresh vaulted credentials and an allocated tunnel
   * IP; the hub-side `/ppp secret` is created when an onboarding token is
   * issued for it via the provisioning flow.
   */
  async registerCascade(routerId: string, deviceId: string, actor?: CurrentUserType) {
    const parent = await this.routerOrThrow(routerId);
    const row = await this.deviceOrThrow(routerId, deviceId);
    if (row.kind !== 'mikrotik') {
      throw new UnprocessableEntityException('only kind=mikrotik devices can be cascade-registered');
    }
    if (row.managedRouterId) {
      const existing = await this.db.routers.findUnique({ id: row.managedRouterId });
      if (existing) return { routerId: existing.id, alreadyRegistered: true as const };
    }
    const usedIps = new Set((await this.db.routers.findMany({})).map((r) => r.tunnelIp));
    const tunnelIp = allocateTunnelIp(usedIps);
    const { username, password } = generateRouterCredentials();
    const [sstpPasswordRef, apiPasswordRef] = await Promise.all([
      this.vault.store(`sstp:${password}`),
      this.vault.store(`api:${randomBytes(24).toString('hex')}`),
    ]);
    const created = await this.db.routers.create({
      uuid: randomUUID(),
      siteId: parent.siteId,
      tunnelIp,
      sstpUsername: username,
      sstpPasswordRef,
      apiPasswordRef,
      status: 'pending',
      identityName: row.name.slice(0, 64),
      boardName: null,
    });
    const updated = await this.db.downstreamDevices.update({ id: row.id }, { managedRouterId: created.id });
    await this.audit.append({
      actorId: actor?.sub ?? null,
      routerId,
      action: 'downstream.cascade.register',
      after: { deviceId, managedRouterId: created.id, tunnelIp },
      result: 'done',
    });
    return { routerId: created.id, tunnelIp, device: toDto(updated), alreadyRegistered: false as const };
  }
}

interface NormalizedNeighbor {
  macAddress?: string;
  lanIp?: string;
  identity?: string;
  platform?: string;
  model?: string;
  iface?: string;
}

function normalizeNeighbor(r: Record<string, string>): NormalizedNeighbor {
  return {
    macAddress: r['mac-address'] ?? r['macAddress'] ?? undefined,
    lanIp: r['address'] ?? r['lanIp'] ?? r['address4'] ?? undefined,
    identity: r['identity'] ?? undefined,
    platform: r['platform'] ?? undefined,
    model: r['board'] ?? r['model'] ?? undefined,
    iface: r['interface'] ?? r['iface'] ?? undefined,
  };
}

/**
 * Guess the vendor from the `/ip/neighbor` platform string. Classification
 * metadata only — no vendor-specific behavior is keyed off this in Phase 1.
 */
export function guessVendor(platform?: string): DeviceVendor {
  if (!platform) return 'unknown';
  const p = platform.toLowerCase();
  if (p.includes('mikrotik') || p.includes('routeros')) return 'mikrotik';
  if (p.includes('openwrt')) return 'openwrt';
  if (p.includes('dd-wrt') || p.includes('ddwrt')) return 'ddwrt';
  if (p.includes('ubiquiti') || p.includes('unifi') || p.includes('airos')) return 'ubiquiti';
  if (p.includes('cisco')) return 'cisco';
  return 'unknown';
}

function toDto(r: DownstreamDeviceRow): DownstreamDevice {
  return {
    id: r.id,
    routerId: r.routerId,
    deviceId: r.deviceId,
    name: r.name,
    kind: r.kind as DownstreamKind,
    vendor: (r.vendor as DeviceVendor) || 'unknown',
    model: r.model,
    mgmtMethods: (r.mgmtMethods as DeviceMgmtMethods | null) ?? null,
    macAddress: r.macAddress,
    lanIp: r.lanIp,
    mgmtPort: r.mgmtPort,
    protocol: r.protocol,
    proxyPort: r.proxyPort,
    managedRouterId: r.managedRouterId,
    lastSeen: r.lastSeen ? r.lastSeen.toISOString() : null,
  };
}
