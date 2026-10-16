import { describe, expect, it } from 'vitest';
import {
  GapTracker,
  RateTracker,
  normalizeMetrics,
  parseUptimeSeconds,
  InMemoryMetricsIngest,
} from '../src/metrics.js';

describe('parseUptimeSeconds', () => {
  it('parses RouterOS duration strings', () => {
    expect(parseUptimeSeconds('1d2h3m4s')).toBe(86400 + 7200 + 180 + 4);
    expect(parseUptimeSeconds('5m')).toBe(300);
    expect(parseUptimeSeconds('2w1d')).toBe(2 * 604800 + 86400);
  });
  it('parses clock strings', () => {
    expect(parseUptimeSeconds('12:34:56')).toBe(12 * 3600 + 34 * 60 + 56);
  });
  it('returns undefined for garbage', () => {
    expect(parseUptimeSeconds('')).toBeUndefined();
    expect(parseUptimeSeconds(undefined)).toBeUndefined();
    expect(parseUptimeSeconds('never')).toBeUndefined();
  });
});

describe('RateTracker', () => {
  it('derives bps from cumulative counters', () => {
    const t = new RateTracker();
    const first = t.rate('r1', 'ether1', '2026-10-16T00:00:00.000Z', 1000, 2000);
    expect(first).toEqual({ rxBps: 0, txBps: 0 }); // no previous sample
    const second = t.rate('r1', 'ether1', '2026-10-16T00:00:10.000Z', 2000, 4000);
    expect(second).toEqual({ rxBps: 800, txBps: 1600 });
  });
  it('yields 0 on counter reset (reboot)', () => {
    const t = new RateTracker();
    t.rate('r1', 'ether1', '2026-10-16T00:00:00.000Z', 99999, 88888);
    const after = t.rate('r1', 'ether1', '2026-10-16T00:00:10.000Z', 10, 20);
    expect(after.rxBps).toBe(0);
    expect(after.txBps).toBe(0);
  });
  it('tracks interfaces independently', () => {
    const t = new RateTracker();
    t.rate('r1', 'a', '2026-10-16T00:00:00.000Z', 0, 0);
    t.rate('r1', 'b', '2026-10-16T00:00:00.000Z', 0, 0);
    const r = t.rate('r1', 'a', '2026-10-16T00:00:10.000Z', 1250, 0);
    expect(r.rxBps).toBe(1000);
  });
});

describe('normalizeMetrics', () => {
  it('normalizes one poll cycle into a canonical ingest batch', () => {
    const tracker = new RateTracker();
    const batch = normalizeMetrics({
      ts: '2026-10-16T00:00:00.000Z',
      routerId: 'r1',
      resource: {
        'cpu-load': '12',
        'free-memory': '123456',
        'total-memory': '524288',
        uptime: '1d2h',
      },
      traffic: [{ name: 'ether1', 'rx-bytes': '1000', 'tx-bytes': '2000' }],
      hotspotActive: 3,
      hotspotUsers: 11,
      tracker,
    });
    expect(batch.cpu?.[0]).toMatchObject({ routerId: 'r1', cpuPct: 12 });
    expect(batch.mem?.[0]).toMatchObject({ routerId: 'r1' });
    expect(batch.mem?.[0]?.totalKb).toBe(512); // 524288 bytes → KB
    expect(batch.hotspotActive?.[0]).toMatchObject({ routerId: 'r1', activeN: 3 });
    expect(batch.traffic).toHaveLength(1);
    expect(batch.traffic?.[0]).toMatchObject({ iface: 'ether1', rxBps: 0 });
  });
});

describe('GapTracker', () => {
  it('flags gaps beyond 2x cadence', () => {
    const g = new GapTracker();
    expect(g.observe('r1', 0, 60)).toBeNull(); // first sample, no baseline
    expect(g.observe('r1', 60_000, 60)).toBeNull(); // exactly on cadence
    expect(g.observe('r1', 121_000, 60)).toBeNull(); // within 2x
    const gap = g.observe('r1', 400_000, 60);
    expect(gap).toBeCloseTo(279, 0);
    expect(g.gaps).toHaveLength(1);
  });
});

describe('InMemoryMetricsIngest', () => {
  it('collects batches per router', async () => {
    const ingest = new InMemoryMetricsIngest();
    const tracker = new RateTracker();
    const batch = normalizeMetrics({
      ts: '2026-10-16T00:00:00.000Z', routerId: 'r1', resource: {},
      traffic: [], hotspotActive: 0, hotspotUsers: 0, tracker,
    });
    await ingest.ingest(batch);
    expect(ingest.latestFor('r1')).toEqual(batch);
    expect(ingest.latestFor('nope')).toBeUndefined();
  });
});
