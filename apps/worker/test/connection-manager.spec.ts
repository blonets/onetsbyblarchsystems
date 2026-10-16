import { describe, expect, it } from 'vitest';
import { RosConnection, Transport } from '@mtk/ros-api';
import { ConnectionManager } from '../src/connection-manager.js';

/** Controllable in-memory transport — no network. */
class FakeTransport implements Transport {
  private closeCbs: Array<() => void> = [];
  private connectedFlag = false;

  async connect(): Promise<void> {
    this.connectedFlag = true;
  }
  async disconnect(): Promise<void> {
    this.connectedFlag = false;
  }
  isConnected(): boolean {
    return this.connectedFlag;
  }
  onClose(cb: () => void): void {
    this.closeCbs.push(cb);
  }
  async sendSentence(): Promise<void> {}
  async readSentence(): Promise<string[]> {
    return ['!done'];
  }

  /** Simulate the network dropping underneath the session. */
  drop(): void {
    this.connectedFlag = false;
    const cbs = this.closeCbs.splice(0);
    for (const cb of cbs) cb();
  }
}

describe('ConnectionManager', () => {
  it('establishes a session once and reuses it while live', async () => {
    let now = 1_000_000;
    let factoryCalls = 0;
    const manager = new ConnectionManager(
      async () => {
        factoryCalls++;
        const conn = new RosConnection(new FakeTransport());
        await conn.connect();
        return conn;
      },
      { now: () => now },
    );

    const a = await manager.ensure('r1');
    const b = await manager.ensure('r1');
    expect(b).toBe(a);
    expect(factoryCalls).toBe(1);
  });

  it('opens a downtime entry on transport drop and closes it on reconnect', async () => {
    let now = 1_000_000;
    const transports: FakeTransport[] = [];
    const manager = new ConnectionManager(
      async () => {
        const t = new FakeTransport();
        transports.push(t);
        const conn = new RosConnection(t);
        await conn.connect();
        return conn;
      },
      { now: () => now },
    );

    await manager.ensure('r1');
    transports[0]!.drop(); // network drops underneath the session

    now += 5_000;
    let entries = manager.getDowntime('r1');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.endedAt).toBeUndefined();
    expect(entries[0]!.durationS).toBe(5); // running duration
    expect(entries[0]!.cause).toBe('transport closed');

    now += 2_000;
    const conn2 = await manager.ensure('r1'); // reconnects
    expect(conn2.connected).toBe(true);
    entries = manager.getDowntime('r1');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.endedAt).toBe(new Date(now).toISOString());
    expect(entries[0]!.durationS).toBe(7);
  });

  it('does not duplicate an open outage on repeated failure reports', async () => {
    let now = 2_000_000;
    const transports: FakeTransport[] = [];
    const manager = new ConnectionManager(
      async () => {
        const t = new FakeTransport();
        transports.push(t);
        const conn = new RosConnection(t);
        await conn.connect();
        return conn;
      },
      { now: () => now },
    );

    await manager.ensure('r1');
    transports[0]!.drop();
    manager.reportFailure('r1', 'poll op threw');
    manager.reportFailure('r1', 'poll op threw again');
    expect(manager.getDowntime('r1')).toHaveLength(1);
  });

  it('tracks outages per router independently', async () => {
    let now = 3_000_000;
    const manager = new ConnectionManager(
      async () => {
        const conn = new RosConnection(new FakeTransport());
        await conn.connect();
        return conn;
      },
      { now: () => now },
    );

    manager.reportFailure('r1', 'x');
    manager.reportFailure('r2', 'y');
    expect(manager.getDowntime('r1')).toHaveLength(1);
    expect(manager.getDowntime('r2')).toHaveLength(1);
    expect(manager.getDowntime('r3')).toHaveLength(0);
  });
});
