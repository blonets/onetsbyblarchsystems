/** Small formatting helpers shared by dashboard views. */

export function formatBytes(bytes?: number): string {
  if (bytes == null || Number.isNaN(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[u]}`;
}

export function formatRate(bps?: number): string {
  if (bps == null || Number.isNaN(bps)) return '—';
  if (bps < 1000) return `${Math.round(bps)} bps`;
  const units = ['Kbps', 'Mbps', 'Gbps'];
  let v = bps / 1000;
  let u = 0;
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000;
    u += 1;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[u]}`;
}

/** 7384000 ms → "2h 3m". Returns '—' for nullish input. */
export function formatDurationMs(ms?: number): string {
  if (ms == null || Number.isNaN(ms)) return '—';
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** RouterOS uptime seconds → "12d 4h". */
export function formatUptime(seconds?: number): string {
  if (seconds == null) return '—';
  return formatDurationMs(seconds * 1000);
}

export function timeAgo(iso?: string, now: number = Date.now()): string {
  if (!iso) return '—';
  const diff = now - new Date(iso).getTime();
  if (Number.isNaN(diff)) return '—';
  if (diff < 60_000) return 'just now';
  return `${formatDurationMs(diff)} ago`;
}

export function formatDateTime(iso?: string, locale = 'en'): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** "10M/10M" → 10_000_000 (bits). Returns null when unparsable. */
export function parseRosRate(value?: string): number | null {
  if (!value) return null;
  const m = value.trim().match(/^([\d.]+)\s*([kMGT]?)$/i);
  if (!m) return null;
  const mult: Record<string, number> = { '': 1, k: 1e3, m: 1e6, g: 1e9, t: 1e12 };
  return parseFloat(m[1]) * (mult[m[2].toLowerCase()] ?? 1);
}
