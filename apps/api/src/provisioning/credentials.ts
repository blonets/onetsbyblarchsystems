import { randomBytes } from 'node:crypto';
import type { ProvisioningToken } from '@mtk/types';

/**
 * Pure provisioning primitives — no I/O, fully unit-tested.
 * The service layer (provisioning.service.ts) wires these to ros-api + the DB.
 */

/** Per-router UNIQUE SSTP credentials: `sstp-<12 hex>` / 32-char base64url secret. */
export function generateRouterCredentials(): { username: string; password: string } {
  return {
    username: `sstp-${randomBytes(6).toString('hex')}`,
    password: randomBytes(24).toString('base64url'),
  };
}

/**
 * Next free tunnel IP in 10.200.0.0/16, scanning 10.200.0.1 → 10.200.255.254.
 * Skips .0/.255 host endings (per-/24 convention) and the hub IP.
 * Throws when the pool is exhausted.
 */
export function allocateTunnelIp(used: Set<string>, hubIp = '10.200.0.1'): string {
  for (let c = 0; c <= 255; c++) {
    for (let d = 0; d <= 255; d++) {
      if (d === 0 || d === 255) continue; // network / broadcast of the /24 slice
      const ip = `10.200.${c}.${d}`;
      if (ip === hubIp) continue; // the hub itself
      if (!used.has(ip)) return ip;
    }
  }
  throw new Error('tunnel pool exhausted: no free IP left in 10.200.0.0/16');
}

/** Single-use onboarding token the site router redeems to fetch its SSTP credentials. */
export function issueOnboardingToken(
  routerId: string,
  ttlHours = 24,
  nowMs = Date.now(),
): ProvisioningToken {
  return {
    token: randomBytes(32).toString('hex'),
    routerId,
    expiresAt: new Date(nowMs + ttlHours * 3_600_000).toISOString(),
  };
}
