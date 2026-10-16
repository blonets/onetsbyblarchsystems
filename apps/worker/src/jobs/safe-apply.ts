/**
 * Safe-apply watchdog for firewall filter changes.
 *
 * Flow:
 *  1. before-snapshot: `/ip/firewall/filter/print` rows
 *  2. apply the sentences
 *  3. emit `config.changed` (canonical bus event)
 *  4. wait `verifyAfterMs`, then check reachability with a FRESH session
 *     (drop the cached one first — a stale socket would lie)
 *  5a. reachable → done
 *  5b. unreachable → auto-revert from the snapshot diff (rules added since
 *      the snapshot are removed; modified rules are restored field-by-field),
 *      emit `alert.raised` + `config.changed`
 *  5c. revert impossible (no after-snapshot) → `alert.raised` critical;
 *      an operator must intervene on-site
 */

import { filterRuleList, filterRuleRemove, filterRuleSet, replyRows, parseYesNo } from '@mtk/ros-api';
import type { FilterRuleInput } from '@mtk/ros-api';
import { healthPing } from '../ros-ext.js';
import type { ConnectionManager } from '../connection-manager.js';
import type { AuditSink } from '../audit.js';
import { InMemoryAuditSink, makeAuditEvent } from '../audit.js';
import type { EventBus } from '../queues.js';
import { InMemoryEventBus } from '../queues.js';

export interface SafeApplyDeps {
  manager: ConnectionManager;
  audit?: AuditSink;
  events?: EventBus;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface SafeApplyArgs {
  routerId: string;
  opId: string;
  actorId?: string;
  /** the change to apply (already validated); rows captured for the result */
  apply: (talk: (words: string[]) => Promise<Record<string, string>[]>) => Promise<Record<string, string>[]>;
  verifyAfterMs?: number;
}

export interface SafeApplyResult {
  rows: number;
  reverted: boolean;
  /** Rows returned by the apply callback (for result reporting). */
  allRows: Record<string, string>[];
}

/** Volatile/read-only filter fields excluded from the revert diff. */
const REVERT_IGNORED_FIELDS = new Set(['.id', 'bytes', 'packets', 'dynamic', 'invalid']);

/** Map a device filter row (dashed keys) back to a FilterRuleInput patch. */
export function rowToFilterPatch(row: Record<string, string>): Partial<FilterRuleInput> {
  const patch: Partial<FilterRuleInput> = {};
  if (row['chain'] !== undefined) patch.chain = row['chain'];
  if (row['action'] !== undefined) patch.action = row['action'];
  if (row['protocol'] !== undefined) patch.protocol = row['protocol'];
  if (row['src-address'] !== undefined) patch.srcAddress = row['src-address'];
  if (row['dst-address'] !== undefined) patch.dstAddress = row['dst-address'];
  if (row['src-port'] !== undefined) patch.srcPort = row['src-port'];
  if (row['dst-port'] !== undefined) patch.dstPort = row['dst-port'];
  if (row['in-interface'] !== undefined) patch.inInterface = row['in-interface'];
  if (row['out-interface'] !== undefined) patch.outInterface = row['out-interface'];
  if (row['comment'] !== undefined) patch.comment = row['comment'];
  if (row['disabled'] !== undefined) patch.disabled = parseYesNo(row['disabled']);
  if (row['log'] !== undefined) patch.log = parseYesNo(row['log']);
  return patch;
}

/**
 * Compute revert sentences from a before/after snapshot of
 * `/ip/firewall/filter/print` rows: added rules are removed, modified rules
 * are restored field-by-field. Exported for tests.
 */
export function diffFilterRevert(
  before: Record<string, string>[],
  after: Record<string, string>[],
): string[][] {
  const sentences: string[][] = [];
  const beforeById = new Map(before.map((r) => [r['.id'], r]));
  const afterById = new Map(after.map((r) => [r['.id'], r]));

  for (const [id, row] of afterById) {
    if (id === undefined) continue;
    const prev = beforeById.get(id);
    if (!prev) {
      sentences.push(filterRuleRemove(id));
      continue;
    }
    const changed: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      if (REVERT_IGNORED_FIELDS.has(k)) continue;
      if ((prev[k] ?? '') !== v) changed[k] = prev[k] ?? '';
    }
    for (const k of Object.keys(prev)) {
      if (REVERT_IGNORED_FIELDS.has(k)) continue;
      if (!(k in row)) changed[k] = prev[k] ?? '';
    }
    if (Object.keys(changed).length > 0) {
      sentences.push(filterRuleSet(id, rowToFilterPatch(changed)));
    }
  }
  return sentences;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function safeApplyFirewallChange(
  deps: SafeApplyDeps,
  args: SafeApplyArgs,
): Promise<SafeApplyResult> {
  const audit = deps.audit ?? new InMemoryAuditSink();
  const events = deps.events ?? new InMemoryEventBus();
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const { routerId, opId, actorId } = args;
  const verifyAfterMs = args.verifyAfterMs ?? 60_000;
  const at = () => new Date(now()).toISOString();

  const auditIt = (
    action: string,
    result: 'pending' | 'done' | 'failed',
    extra: Record<string, unknown> = {},
  ): Promise<void> =>
    audit.record(
      makeAuditEvent({
        actorType: 'system', action, entityType: 'router', entityId: routerId,
        opId, result, ...(actorId ? { actorId } : {}), ...extra,
      }),
    );

  // 1. before-snapshot
  const before = await deps.manager.execute(routerId, (conn) =>
    conn.talk(filterRuleList()).then(replyRows),
  );

  // 2. apply
  await auditIt('safe-apply.start', 'pending', { before: { rules: before.length } });
  const rows = await deps.manager.execute(
    routerId,
    async (conn) => args.apply((words) => conn.talk(words).then(replyRows)),
    { opId },
  );
  await events.emit({
    event: 'config.changed',
    payload: { routerId, domain: 'firewall', action: 'apply', opId, ...(actorId ? { actorId } : {}), at: at() },
  });

  // 4. wait, then verify with a FRESH session
  await sleep(verifyAfterMs);
  let reachable = false;
  try {
    await deps.manager.drop(routerId);
    const fresh = await deps.manager.ensure(routerId);
    await fresh.talk(healthPing());
    reachable = true;
  } catch {
    reachable = false;
  }

  if (reachable) {
    await auditIt('safe-apply.verify', 'done', { after: { verified: true } });
    return { rows: rows.length, reverted: false, allRows: rows };
  }

  // 5b. unreachable → auto-revert from the snapshot diff
  await auditIt('safe-apply.revert', 'pending', { error: 'reachability lost after apply' });
  let after: Record<string, string>[];
  try {
    after = await deps.manager.execute(routerId, (conn) =>
      conn.talk(filterRuleList()).then(replyRows),
    );
  } catch {
    after = [];
  }
  if (after.length === 0 && before.length > 0) {
    // can't even read the table — revert is impossible; escalate
    await auditIt('safe-apply.revert', 'failed', { error: 'after-snapshot unreadable' });
    await events.emit({
      event: 'alert.raised',
      payload: {
        routerId, severity: 'critical', at: at(),
        message: 'safe-apply: router unreachable and revert impossible — manual intervention required',
      },
    });
    return { rows: rows.length, reverted: false, allRows: rows };
  }
  const revertSentences = diffFilterRevert(before, after);
  for (const sentence of revertSentences) {
    await deps.manager.execute(routerId, (conn) => conn.talk(sentence)).catch(() => undefined);
  }
  await auditIt('safe-apply.revert', 'done', { after: { reverted: true } });
  await events.emit({
    event: 'alert.raised',
    payload: {
      routerId, severity: 'warning', at: at(),
      message: 'safe-apply: firewall change auto-reverted after reachability loss',
    },
  });
  await events.emit({
    event: 'config.changed',
    payload: { routerId, domain: 'firewall', action: 'revert', opId, ...(actorId ? { actorId } : {}), at: at() },
  });
  return { rows: rows.length, reverted: true, allRows: rows };
}
