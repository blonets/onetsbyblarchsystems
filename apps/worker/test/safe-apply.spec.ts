import { describe, expect, it } from 'vitest';
import { RosConnection } from '@mtk/ros-api';
import { ConnectionManager } from '../src/connection-manager.js';
import {
  safeApplyFirewallChange,
  diffFilterRevert,
  rowToFilterPatch,
} from '../src/jobs/safe-apply.js';
import { InMemoryAuditSink } from '../src/audit.js';
import { InMemoryEventBus } from '../src/queues.js';
import { ScriptedTransport, mapHandler, reDone, done } from './helpers.js';

function setup(checks: { filterPrint?: string[][]; afterPrint?: string[][] } = {}) {
  const manager = new ConnectionManager(
    async () => {
      const conn = new RosConnection(
        new ScriptedTransport(
          mapHandler({
            '/ip/firewall/filter/print':
              checks.afterPrint && (manager as { __after?: boolean }).__after
                ? checks.afterPrint
                : (checks.filterPrint ?? reDone([{ '.id': '*1', chain: 'input', action: 'accept' }])),
            '/ip/firewall/filter/add': [['!done', '=ret=*99']],
            '/ip/firewall/filter/remove': done(),
            '/ip/firewall/filter/set': done(),
            '/system/identity/print': done(),
          }),
        ),
      );
      await conn.connect();
      return conn;
    },
    { backoff: { maxAttempts: 1 }, sleep: async () => {} },
  );
  const audit = new InMemoryAuditSink();
  const events = new InMemoryEventBus();
  return {
    deps: { manager, audit, events, sleep: async () => {} },
    audit,
    events,
    manager,
  };
}

const applyAdd = async (
  talk: (words: string[]) => Promise<Record<string, string>[]>,
): Promise<Record<string, string>[]> => {
  await talk(['/ip/firewall/filter/add', '=chain=input', '=action=drop']);
  return [];
};

describe('safe-apply watchdog', () => {
  it('applies and verifies when the router stays reachable', async () => {
    const { deps, audit, events } = setup();
    const result = await safeApplyFirewallChange(deps, {
      routerId: 'r1', opId: 'op-safe-1', apply: applyAdd, verifyAfterMs: 0,
    });
    expect(result).toMatchObject({ rows: 0, reverted: false });
    expect(events.ofType('config.changed')).toHaveLength(1);
    expect(events.ofType('config.changed')[0]!.payload.action).toBe('apply');
    expect(events.ofType('alert.raised')).toHaveLength(0);
    expect(audit.events.map((e) => e.action)).toContain('safe-apply.verify');
  });

  it('auto-reverts an added rule when reachability is lost at verify time', async () => {
    // Simulate: apply succeeds, the fresh-session verify fails once
    // (transient), then the router answers again and the revert lands.
    const sent: string[][] = [];
    let connections = 0;
    const manager = new ConnectionManager(
      async () => {
        connections++;
        if (connections === 2) throw new Error('socket hangup'); // verify fails
        const t = new ScriptedTransport((words) => {
          sent.push(words);
          if (words[0] === '/ip/firewall/filter/print') {
            const applied = sent.some((w) => w[0] === '/ip/firewall/filter/add');
            const rows: Record<string, string>[] = [
              { '.id': '*1', chain: 'input', action: 'accept' },
            ];
            if (applied) rows.push({ '.id': '*99', chain: 'input', action: 'drop' });
            return reDone(rows);
          }
          if (words[0] === '/ip/firewall/filter/add') return [['!done', '=ret=*99']];
          if (words[0] === '/ip/firewall/filter/remove') return done();
          return done();
        });
        const conn = new RosConnection(t);
        await conn.connect();
        return conn;
      },
      { backoff: { maxAttempts: 1 }, sleep: async () => {} },
    );
    const audit = new InMemoryAuditSink();
    const events = new InMemoryEventBus();

    const result = await safeApplyFirewallChange(
      { manager, audit, events, sleep: async () => {} },
      { routerId: 'r1', opId: 'op-safe-2', apply: applyAdd, verifyAfterMs: 0 },
    );

    expect(result.reverted).toBe(true);
    // the diff removed exactly the added rule
    expect(sent.some((w) => w[0] === '/ip/firewall/filter/remove' && w[1] === '=.id=*99')).toBe(
      true,
    );
    const alerts = events.ofType('alert.raised');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.payload.severity).toBe('warning');
    // apply emitted one config.changed, the revert emitted another
    const changed = events.ofType('config.changed');
    expect(changed.map((e) => e.payload.action)).toEqual(['apply', 'revert']);
  });

  it('escalates critically when the revert path is broken too', async () => {
    let connections = 0;
    const manager = new ConnectionManager(
      async () => {
        connections++;
        if (connections > 1) throw new Error('socket hangup'); // router stays dark
        const t = new ScriptedTransport((words) => {
          if (words[0] === '/ip/firewall/filter/print') {
            return reDone([{ '.id': '*1', chain: 'input', action: 'accept' }]);
          }
          if (words[0] === '/ip/firewall/filter/add') return [['!done', '=ret=*99']];
          return done();
        });
        const conn = new RosConnection(t);
        await conn.connect();
        return conn;
      },
      { backoff: { maxAttempts: 1 }, sleep: async () => {} },
    );
    const audit = new InMemoryAuditSink();
    const events = new InMemoryEventBus();
    const result = await safeApplyFirewallChange(
      { manager, audit, events, sleep: async () => {} },
      { routerId: 'r1', opId: 'op-safe-3', apply: applyAdd, verifyAfterMs: 0 },
    );
    // verify fails (connection 2) → revert attempt also fails (connection 3)
    // → critical escalation, nothing reverted
    expect(result.reverted).toBe(false);
    const alerts = events.ofType('alert.raised');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.payload.severity).toBe('critical');
  });
});

describe('diffFilterRevert', () => {
  it('removes added rules and restores modified ones', () => {
    const before = [{ '.id': '*1', chain: 'input', action: 'accept', disabled: 'no' }];
    const after = [
      { '.id': '*1', chain: 'input', action: 'drop', disabled: 'no' },
      { '.id': '*2', chain: 'input', action: 'drop' },
    ];
    const sentences = diffFilterRevert(before, after);
    expect(sentences).toHaveLength(2);
    // implementation walks the after-snapshot in order: restore *1 first…
    expect(sentences[0]?.[0]).toBe('/ip/firewall/filter/set');
    expect(sentences[0]).toContain('=.id=*1');
    expect(sentences[0]).toContain('=action=accept');
    // …then remove the added *2
    expect(sentences[1]).toEqual(['/ip/firewall/filter/remove', '=.id=*2']);
  });

  it('ignores volatile fields (bytes/packets)', () => {
    const before = [{ '.id': '*1', chain: 'input', action: 'accept', bytes: '10', packets: '1' }];
    const after = [{ '.id': '*1', chain: 'input', action: 'accept', bytes: '999', packets: '42' }];
    expect(diffFilterRevert(before, after)).toHaveLength(0);
  });

  it('is empty when nothing changed', () => {
    const rows = [{ '.id': '*1', chain: 'input', action: 'accept' }];
    expect(diffFilterRevert(rows, [...rows])).toHaveLength(0);
  });
});

describe('rowToFilterPatch', () => {
  it('maps dashed device keys to camelCase patch fields', () => {
    const patch = rowToFilterPatch({
      chain: 'input', action: 'drop', 'src-address': '10.0.0.0/8', disabled: 'yes',
    });
    expect(patch).toMatchObject({
      chain: 'input', action: 'drop', srcAddress: '10.0.0.0/8', disabled: true,
    });
  });
});
