'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { PageHeader, Tabs } from '@/components/ui/page';
import { EmptyState, QueryState } from '@/components/ui/states';
import { Table, TBody, THead, Th, Tr, Td, Mono } from '@/components/ui/table';
import { RouterSelect, useRouterPicker } from '@/components/router-picker';
import {
  useApplyFirewallChanges,
  useFirewallJournal,
  useFirewallRules,
  usePreviewFirewallChanges,
  useRollbackFirewallJournal,
} from '@/lib/queries';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { useLocale } from 'next-intl';
import type { FirewallChange, FirewallRuleInput } from '@/lib/api-client';
import type { DiffLine, FirewallRule, FirewallTable } from '@/lib/types';

const tables: FirewallTable[] = ['filter', 'nat', 'mangle', 'address-list'];
const chains = ['input', 'forward', 'output', 'srcnat', 'dstnat'];
const actions = ['accept', 'drop', 'reject', 'masquerade', 'dst-nat', 'src-nat', 'mark-connection', 'log'];

/** Compact one-line summary of a rule's matchers. */
function ruleSummary(r: FirewallRule): string {
  const parts: string[] = [];
  if (r.protocol) parts.push(r.protocol);
  if (r.srcAddress) parts.push(`src ${r.srcAddress}`);
  if (r.dstAddress) parts.push(`dst ${r.dstAddress}`);
  if (r.srcPort) parts.push(`sport ${r.srcPort}`);
  if (r.dstPort) parts.push(`dport ${r.dstPort}`);
  if (r.inInterface) parts.push(`in ${r.inInterface}`);
  if (r.outInterface) parts.push(`out ${r.outInterface}`);
  if (r.toAddresses) parts.push(`→ ${r.toAddresses}${r.toPorts ? `:${r.toPorts}` : ''}`);
  return parts.join(' · ') || '—';
}

/** Apply staged changes to the server list to render the working view. */
function applyStaged(routerId: string, table: FirewallTable, base: FirewallRule[], staged: FirewallChange[]): FirewallRule[] {
  let view = base.map((r) => ({ ...r }));
  for (const c of staged) {
    if (c.kind === 'create' && c.input) {
      const { placeBeforeId: _placeBefore, disabled, ...rest } = c.input;
      const rule: FirewallRule = {
        id: c.ruleId!,
        routerId,
        table: table as FirewallRule['table'],
        order: view.length,
        disabled: disabled ?? false,
        revoked: false,
        managed: true,
        ...rest,
      };
      view.push(rule);
    } else if (c.kind === 'delete' && c.ruleId) {
      view = view.filter((r) => r.id !== c.ruleId);
    } else if (c.kind === 'update' && c.ruleId && c.input) {
      view = view.map((r): FirewallRule => {
        if (r.id !== c.ruleId || !c.input) return r;
        const { placeBeforeId: _placeBefore, ...rest } = c.input;
        return { ...r, ...rest, disabled: rest.disabled ?? r.disabled };
      });
    } else if (c.kind === 'toggle' && c.ruleId && c.disabled !== undefined) {
      const disabled = c.disabled;
      view = view.map((r) => (r.id === c.ruleId ? { ...r, disabled } : r));
    } else if (c.kind === 'move' && c.ruleId && c.direction) {
      const i = view.findIndex((r) => r.id === c.ruleId);
      const j = c.direction === 'up' ? i - 1 : i + 1;
      if (i > -1 && j >= 0 && j < view.length) [view[i], view[j]] = [view[j], view[i]];
    }
  }
  return view;
}

let stagedSeq = 0;

function RuleForm({
  initial,
  rules,
  onSubmit,
  busy,
}: {
  initial: FirewallRuleInput;
  rules: FirewallRule[];
  onSubmit: (input: FirewallRuleInput) => void;
  busy: boolean;
}) {
  const t = useTranslations('firewall');
  const tCommon = useTranslations('common');
  const [form, setForm] = useState<FirewallRuleInput>(initial);
  const upd = (k: keyof FirewallRuleInput, v: string | boolean | undefined) =>
    setForm((f) => ({ ...f, [k]: v === '' ? undefined : v }));

  return (
    <form
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(form);
      }}
    >
      <Field label={t('chain')}>
        <Select value={form.chain} onChange={(e) => upd('chain', e.target.value)} required>
          {chains.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>
      </Field>
      <Field label={t('action')}>
        <Select value={form.action} onChange={(e) => upd('action', e.target.value)} required>
          {actions.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </Select>
      </Field>
      <Field label={t('protocol')}><Input dir="ltr" value={form.protocol ?? ''} onChange={(e) => upd('protocol', e.target.value)} placeholder="tcp" /></Field>
      <Field label={t('comment')}><Input value={form.comment ?? ''} onChange={(e) => upd('comment', e.target.value)} /></Field>
      <Field label={t('srcAddress')}><Input dir="ltr" value={form.srcAddress ?? ''} onChange={(e) => upd('srcAddress', e.target.value)} placeholder="10.200.0.0/16" /></Field>
      <Field label={t('dstAddress')}><Input dir="ltr" value={form.dstAddress ?? ''} onChange={(e) => upd('dstAddress', e.target.value)} /></Field>
      <Field label={t('srcPort')}><Input dir="ltr" value={form.srcPort ?? ''} onChange={(e) => upd('srcPort', e.target.value)} /></Field>
      <Field label={t('dstPort')}><Input dir="ltr" value={form.dstPort ?? ''} onChange={(e) => upd('dstPort', e.target.value)} placeholder="8728" /></Field>
      <Field label={t('inInterface')}><Input dir="ltr" value={form.inInterface ?? ''} onChange={(e) => upd('inInterface', e.target.value)} /></Field>
      <Field label={t('outInterface')}><Input dir="ltr" value={form.outInterface ?? ''} onChange={(e) => upd('outInterface', e.target.value)} /></Field>
      <Field label={t('toAddresses')}><Input dir="ltr" value={form.toAddresses ?? ''} onChange={(e) => upd('toAddresses', e.target.value)} /></Field>
      <Field label={t('toPorts')}><Input dir="ltr" value={form.toPorts ?? ''} onChange={(e) => upd('toPorts', e.target.value)} /></Field>
      <Field label={t('placeBefore')} className="sm:col-span-2">
        <Select value={form.placeBeforeId ?? ''} onChange={(e) => upd('placeBeforeId', e.target.value || undefined)}>
          <option value="">— ({t('placeBeforeEnd')})</option>
          {rules.map((r) => (
            <option key={r.id} value={r.id}>
              ⬆ {r.chain}/{r.action} — {r.comment ?? r.id}
            </option>
          ))}
        </Select>
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy}>{tCommon('save')}</Button>
      </div>
    </form>
  );
}

function DiffView({ diff }: { diff: DiffLine[] }) {
  const t = useTranslations('firewall');
  const opStyle: Record<DiffLine['op'], string> = {
    add: 'border-emerald-500/30 bg-emerald-500/5',
    remove: 'border-red-500/30 bg-red-500/5',
    change: 'border-amber-500/30 bg-amber-500/5',
  };
  const opLabel: Record<DiffLine['op'], string> = { add: t('diffAdd'), remove: t('diffRemove'), change: t('diffChange') };
  return (
    <ul className="flex flex-col gap-2">
      {diff.map((d, i) => (
        <li key={i} className={`rounded-xl border p-3 ${opStyle[d.op]}`}>
          <p className="text-xs font-bold uppercase tracking-wide">
            <span className="me-2 rounded bg-slate-800 px-1.5 py-0.5">{opLabel[d.op]}</span>
            <span className="font-mono normal-case text-slate-300">{d.path}</span>
          </p>
          {d.before && d.before !== d.after && (
            <p className="mt-1 font-mono text-[11px] text-red-300" dir="ltr">− {d.before}</p>
          )}
          {d.after && (
            <p className="mt-1 font-mono text-[11px] text-emerald-300" dir="ltr">+ {d.after}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- rollback journal
function JournalSection({ routerId, canEdit }: { routerId: string; canEdit: boolean }) {
  const t = useTranslations('firewall.journal');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const q = useFirewallJournal(routerId);
  const rollbackM = useRollbackFirewallJournal(routerId);
  const [rollingBack, setRollingBack] = useState<string | null>(null);

  const entries = q.data ?? [];

  return (
    <Card>
      <CardContent className="pt-6">
        <p className="mb-4 text-xs text-slate-500">{t('subtitle')}</p>
        <QueryState
          isLoading={q.isLoading} isError={q.isError} error={q.error} refetch={() => q.refetch()}
          isEmpty={entries.length === 0}
          empty={<EmptyState title={t('empty')} />}
        >
          <Table>
            <THead>
              <Th>{t('time')}</Th><Th>{t('op')}</Th><Th>{t('rules')}</Th><Th>{tCommon('status')}</Th>
              {canEdit && <Th>{tCommon('actions')}</Th>}
            </THead>
            <TBody>
              {entries.map((e) => (
                <Tr key={e.id} className={e.rolledBack ? 'opacity-60' : undefined}>
                  <Td className="whitespace-nowrap text-slate-400">{formatDateTime(e.createdAt, locale)}</Td>
                  <Td>
                    <span className="rounded-full bg-slate-800 px-2.5 py-0.5 font-mono text-[11px] text-slate-300" dir="ltr">
                      {e.op}
                    </span>
                    {e.table && <span className="ms-2 font-mono text-[11px] text-slate-500">{e.table}</span>}
                  </Td>
                  <Td className="tabular-nums">{e.ruleCount}</Td>
                  <Td>
                    {e.rolledBack ? (
                      <span className="rounded-full bg-red-500/15 px-2.5 py-0.5 text-xs text-red-300">{t('rolledBack')}</span>
                    ) : (
                      <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs text-emerald-300">{t('applied')}</span>
                    )}
                  </Td>
                  {canEdit && (
                    <Td>
                      {!e.rolledBack ? (
                        <Button
                          size="sm" variant="outline" disabled={rollbackM.isPending}
                          onClick={() => setRollingBack(e.id)}
                        >
                          {t('rollback')}
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </Td>
                  )}
                </Tr>
              ))}
            </TBody>
          </Table>
        </QueryState>
        <ConfirmDialog
          open={rollingBack !== null} onClose={() => setRollingBack(null)}
          onConfirm={async () => { if (rollingBack) await rollbackM.mutateAsync(rollingBack); setRollingBack(null); }}
          title={t('rollbackTitle')} message={t('rollbackMessage')} confirmLabel={t('rollback')}
        />
        {rollbackM.isSuccess && (
          <p className="mt-3 rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{t('rollbackDone')}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function FirewallPage() {
  const t = useTranslations('firewall');
  const tJournal = useTranslations('firewall.journal');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const { routers, selected, setSelected, isLoading } = useRouterPicker();
  const { canEditNetwork } = useAuth();
  const [table, setTable] = useState<FirewallTable>('filter');
  const [section, setSection] = useState<'rules' | 'journal'>('rules');

  const rulesQ = useFirewallRules(selected, table, !!selected);
  const previewM = usePreviewFirewallChanges(selected);
  const applyM = useApplyFirewallChanges(selected, table);

  const [staged, setStaged] = useState<FirewallChange[]>([]);
  const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'edit'; rule: FirewallRule } | null>(null);
  const [deleting, setDeleting] = useState<FirewallRule | null>(null);
  const [preview, setPreview] = useState<DiffLine[] | null>(null);
  const [safeApply, setSafeApply] = useState(true);
  const [result, setResult] = useState<string | null>(null);

  const base = useMemo(() => rulesQ.data ?? [], [rulesQ.data]);
  const view = useMemo(() => applyStaged(selected, table, base, staged), [selected, table, base, staged]);

  function stage(change: FirewallChange) {
    setStaged((s) => [...s, change]);
    setResult(null);
  }

  function stageCreate(input: FirewallRuleInput) {
    stagedSeq += 1;
    stage({ kind: 'create', table, input, ruleId: `staged-${stagedSeq}` });
    setDialog(null);
  }

  function stageDelete(rule: FirewallRule) {
    if (rule.id.startsWith('staged-')) {
      // Never reached the router — just drop the staged create.
      setStaged((s) => s.filter((c) => c.ruleId !== rule.id));
    } else {
      stage({ kind: 'delete', table, ruleId: rule.id });
    }
    setDeleting(null);
  }

  async function doPreview() {
    const diff = await previewM.mutateAsync(staged);
    setPreview(diff);
  }

  async function doApply() {
    const out = await applyM.mutateAsync({ changes: staged, safeApply });
    setResult(out.rolledBack ? t('rolledBack') : out.message || t('applied'));
    setPreview(null);
    if (!out.rolledBack) setStaged([]);
    rulesQ.refetch();
  }

  const tabItems = tables.map((tb) => ({ key: tb, label: t(`tables.${tb}`), badge: tb === table ? view.length : undefined }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={<RouterSelect routers={routers} selected={selected} onChange={setSelected} />}
      />

      <p className="rounded-xl bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-300">
        ⚠ {t('dangerNote')}
      </p>

      {!selected || isLoading ? (
        <Card><CardContent className="py-12 text-center text-sm text-slate-400">{tCommon('loading')}</CardContent></Card>
      ) : (
        <>
          <Tabs
            tabs={[
              { key: 'rules' as const, label: t('tabs.rules') },
              { key: 'journal' as const, label: tJournal('title') },
            ]}
            active={section}
            onChange={setSection}
          />

          {section === 'journal' ? (
            <JournalSection routerId={selected} canEdit={canEditNetwork} />
          ) : (
            <>
              <Tabs tabs={tabItems} active={table} onChange={(tb) => { setTable(tb); setStaged([]); setPreview(null); setResult(null); }} />

          <QueryState
            isLoading={rulesQ.isLoading} isError={rulesQ.isError} error={rulesQ.error} refetch={() => rulesQ.refetch()}
            isEmpty={view.length === 0}
            empty={<EmptyState title={t('noRules')} action={canEditNetwork ? <Button onClick={() => setDialog({ mode: 'create' })}>+ {t('addRule')}</Button> : undefined} />}
          >
            <Card>
              <CardContent className="pt-6">
                {canEditNetwork && (
                  <div className="mb-4 flex flex-wrap items-center gap-3">
                    <Button onClick={() => setDialog({ mode: 'create' })}>+ {t('addRule')}</Button>
                    {staged.length > 0 && (
                      <>
                        <Button variant="outline" onClick={doPreview} disabled={previewM.isPending}>
                          {t('preview')} ({staged.length})
                        </Button>
                        <Button variant="ghost" onClick={() => { setStaged([]); setPreview(null); }}>
                          {tCommon('cancel')}
                        </Button>
                      </>
                    )}
                  </div>
                )}
                <Table>
                  <THead>
                    <Th>#</Th><Th>{t('chain')} / {t('action')}</Th><Th>{t('comment')}</Th>
                    <Th>{tCommon('status')}</Th>{canEditNetwork && <Th>{tCommon('actions')}</Th>}
                  </THead>
                  <TBody>
                    {view.map((r, i) => (
                      <Tr key={r.id} className={r.disabled ? 'opacity-55' : undefined}>
                        <Td className="tabular-nums text-slate-500">{i + 1}</Td>
                        <Td>
                          <div className="flex flex-col gap-0.5">
                            <span className="font-mono text-[13px]">
                              <span className="text-sky-300">{r.chain}</span>
                              <span className="mx-1 text-slate-600">→</span>
                              <span className={r.action === 'drop' || r.action === 'reject' ? 'text-red-300' : 'text-emerald-300'}>{r.action}</span>
                            </span>
                            <span className="font-mono text-[11px] text-slate-500" dir="ltr">{ruleSummary(r)}</span>
                          </div>
                        </Td>
                        <Td className="max-w-48 truncate text-slate-400" title={r.comment ?? undefined}>{r.comment ?? '—'}</Td>
                        <Td>
                          <div className="flex flex-col items-start gap-1.5">
                            {canEditNetwork ? (
                              <Switch
                                checked={!r.disabled}
                                onChange={(v) => stage({ kind: 'toggle', table, ruleId: r.id, disabled: !v })}
                                label={`${r.chain} ${r.action}`}
                              />
                            ) : (
                              <span className="text-xs text-slate-400">{r.disabled ? tCommon('disabled') : tCommon('enabled')}</span>
                            )}
                            {r.revoked && (
                              <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-300">
                                {t('revoked')}
                              </span>
                            )}
                          </div>
                        </Td>
                        {canEditNetwork && (
                          <Td>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => stage({ kind: 'move', table, ruleId: r.id, direction: 'up' })}
                                disabled={i === 0}
                                className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 disabled:opacity-30"
                                title={t('moveUp')}
                              >▲</button>
                              <button
                                onClick={() => stage({ kind: 'move', table, ruleId: r.id, direction: 'down' })}
                                disabled={i === view.length - 1}
                                className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 disabled:opacity-30"
                                title={t('moveDown')}
                              >▼</button>
                              <button
                                onClick={() => setDialog({ mode: 'edit', rule: r })}
                                className="rounded-lg p-2 text-slate-400 hover:bg-slate-800"
                                title={tCommon('edit')}
                              >✎</button>
                              <button
                                onClick={() => setDeleting(r)}
                                className="rounded-lg p-2 text-red-300/80 hover:bg-slate-800"
                                title={tCommon('delete')}
                              >🗑</button>
                            </div>
                          </Td>
                        )}
                      </Tr>
                    ))}
                  </TBody>
                </Table>
                <p className="mt-3 text-[11px] text-slate-600">
                  <span className="me-1 rounded bg-slate-800 px-1.5 py-0.5 text-slate-400">{t('sourcePlatform')}</span>
                  = {t('stagedHint')}
                </p>
              </CardContent>
            </Card>
          </QueryState>

          {result && (
            <p className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{result}</p>
          )}
            </>
          )}
        </>
      )}

      <Dialog
        open={dialog !== null} onClose={() => setDialog(null)}
        title={dialog?.mode === 'edit' ? t('editRule') : t('addRule')} wide
      >
        {dialog && (
          <RuleForm
            initial={
              dialog.mode === 'edit'
                ? {
                    chain: dialog.rule.chain, action: dialog.rule.action, protocol: dialog.rule.protocol ?? undefined,
                    srcAddress: dialog.rule.srcAddress ?? undefined, dstAddress: dialog.rule.dstAddress ?? undefined,
                    srcPort: dialog.rule.srcPort ?? undefined, dstPort: dialog.rule.dstPort ?? undefined,
                    inInterface: dialog.rule.inInterface ?? undefined, outInterface: dialog.rule.outInterface ?? undefined,
                    toAddresses: dialog.rule.toAddresses ?? undefined, toPorts: dialog.rule.toPorts ?? undefined,
                    comment: dialog.rule.comment ?? undefined, disabled: dialog.rule.disabled,
                  }
                : { chain: table === 'nat' ? 'srcnat' : 'input', action: 'accept' }
            }
            rules={view}
            busy={false}
            onSubmit={(input) => {
              if (dialog.mode === 'edit' && !dialog.rule.id.startsWith('staged-')) {
                stage({ kind: 'update', table, ruleId: dialog.rule.id, input });
              } else if (dialog.mode === 'edit') {
                // Editing a staged create: rewrite it in place.
                setStaged((s) => s.map((c) => (c.ruleId === dialog.rule.id ? { ...c, input } : c)));
              } else {
                stageCreate(input);
              }
              setDialog(null);
            }}
          />
        )}
      </Dialog>

      <ConfirmDialog
        open={deleting !== null} onClose={() => setDeleting(null)}
        onConfirm={() => deleting && stageDelete(deleting)}
        title={t('deleteTitle')} message={t('deleteMessage')} confirmLabel={tCommon('delete')}
      />

      <Dialog open={preview !== null} onClose={() => setPreview(null)} title={t('previewTitle')} wide>
        {preview && (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-slate-500">{t('stagedHint')}</p>
            <DiffView diff={preview} />
            <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
              <label className="flex cursor-pointer items-start gap-3">
                <Switch checked={safeApply} onChange={setSafeApply} label={t('safeApply')} />
                <span>
                  <span className="block text-sm font-medium">{t('safeApply')}</span>
                  <span className="block text-xs text-slate-400">{t('safeApplyHint')}</span>
                  {!safeApply && <span className="mt-1 block text-xs text-red-300">⚠ {t('safeApplyWarning')}</span>}
                </span>
              </label>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setPreview(null)}>{tCommon('cancel')}</Button>
              <Button onClick={doApply} disabled={applyM.isPending}>
                {applyM.isPending ? t('applying') : t('apply')}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
