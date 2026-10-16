import { Socket } from 'node:net';
import type { DeviceMgmtMethods, DeviceVendor, DownstreamDevice } from '@mtk/types';

/**
 * Vendor driver contract.
 *
 * Phase 1 ships exactly ONE driver — {@link GenericWebSshDriver} — which is
 * vendor-neutral: it only probes the proxy endpoint at the TCP level. Phase 2
 * lands real per-vendor drivers (RouterOS API / OpenWrt UCI-over-SSH /
 * DD-WRT / UniFi) implementing this interface; the downstream module, its
 * REST surface and its DB records do not change.
 *
 * No vendor-specific configuration logic lives here or anywhere in Phase 1.
 */

export interface DeviceDriverContext {
  /** Site router's tunnel IP — the proxy endpoint is `<tunnelIp>:<proxyPort>`. */
  routerTunnelIp: string;
  /** Allocated tunnel-side port, or null when the proxy is not enabled. */
  proxyPort: number | null;
  mgmtMethods: DeviceMgmtMethods;
  device: Pick<DownstreamDevice, 'deviceId' | 'name' | 'vendor' | 'model' | 'lanIp' | 'mgmtPort'>;
}

export interface DeviceStatusReport {
  reachable: boolean;
  latencyMs?: number;
  checkedAt: string;
  detail?: string;
}

export interface DeviceConfigBackup {
  /** Vendor-defined in Phase 2, e.g. 'rsc' | 'uci-tar' | 'unifi-json'. */
  format: string;
  /** base64-encoded backup blob. */
  data: string;
  capturedAt: string;
}

export interface DeviceDriver {
  /** 'unknown' for the generic driver; the vendor id for real drivers. */
  readonly vendor: DeviceVendor;
  /** Vendor-neutral reachability check of the proxy endpoint. */
  getStatus(ctx: DeviceDriverContext): Promise<DeviceStatusReport>;
  /** Phase 2: vendor-specific reboot. */
  reboot(ctx: DeviceDriverContext): Promise<void>;
  /** Phase 2: vendor-specific config backup. */
  backupConfig(ctx: DeviceDriverContext): Promise<DeviceConfigBackup>;
}

/**
 * Driver registry. Phase 1 returns the generic passthrough for every vendor;
 * Phase 2 returns real drivers here (OpenWrt UCI-over-SSH, DD-WRT, UniFi,
 * RouterOS API…) without touching the downstream module.
 */
export function getDriver(_vendor: DeviceVendor): DeviceDriver {
  return new GenericWebSshDriver();
}

/**
 * Generic vendor-neutral driver (Phase 1).
 *
 * - `getStatus` performs a TCP connect probe against the allocated proxy
 *   port — no vendor knowledge required, works for any web/SSH device.
 * - `reboot` / `backupConfig` are contract stubs: they throw a clear
 *   NOT_IMPLEMENTED error naming Phase 2, instead of faking vendor behavior.
 */
export class GenericWebSshDriver implements DeviceDriver {
  readonly vendor: DeviceVendor = 'unknown';

  constructor(private readonly timeoutMs: number = Number(process.env.DEVICE_STATUS_TIMEOUT_MS ?? 5000)) {}

  async getStatus(ctx: DeviceDriverContext): Promise<DeviceStatusReport> {
    const checkedAt = new Date().toISOString();
    if (!ctx.proxyPort) {
      return {
        reachable: false,
        checkedAt,
        detail: 'proxy port not allocated — enable the device proxy first',
      };
    }
    try {
      const latencyMs = await tcpProbe(ctx.routerTunnelIp, ctx.proxyPort, this.timeoutMs);
      return { reachable: true, latencyMs, checkedAt };
    } catch (err) {
      return { reachable: false, checkedAt, detail: (err as Error).message };
    }
  }

  async reboot(_ctx: DeviceDriverContext): Promise<void> {
    throw new Error(
      'NOT_IMPLEMENTED: vendor-specific reboot requires a Phase 2 device driver (OpenWrt/DD-WRT/UniFi/RouterOS)',
    );
  }

  async backupConfig(_ctx: DeviceDriverContext): Promise<DeviceConfigBackup> {
    throw new Error(
      'NOT_IMPLEMENTED: vendor-specific config backup requires a Phase 2 device driver (OpenWrt/DD-WRT/UniFi/RouterOS)',
    );
  }
}

/** TCP connect probe with a hard timeout; resolves with latency ms. */
function tcpProbe(host: string, port: number, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const start = Date.now();
    const done = (err?: Error): void => {
      socket.destroy();
      if (err) reject(err);
      else resolve(Date.now() - start);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done());
    socket.once('timeout', () => done(new Error(`connect to ${host}:${port} timed out after ${timeoutMs}ms`)));
    socket.once('error', (err) => done(err));
    socket.connect(port, host);
  });
}
