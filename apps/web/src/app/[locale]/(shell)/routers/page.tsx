'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/page';
import { EmptyState, QueryState } from '@/components/ui/states';
import { Table, TBody, THead, Th, Tr, Td, Mono } from '@/components/ui/table';
import { FleetResultView } from '@/components/fleet-result';
import {
  useBulkRouterOperation,
  useDeleteRouterPermanent,
  useReconcileHubSecrets,
  useRouters,
  useSites,
  useSyncRouter,
  useTestRouterConnection,
} from '@/lib/queries';
import { formatDateTime } from '@/lib/format';
import type { BulkOperation, FleetResult, RouterStatus } from '@/lib/types';

const statuses: Array<RouterStatus | 'all'> = ['all', 'online', 'offline', 'pending', 'suspect', 'decommissioned'];
const bulkOps: BulkOperation[] = ['reboot', 'rotate-secret', 'trigger-backup'];

// ---------------------------------------------------------------- bulk operations
function BulkOpsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('routers.bulk');
  const tCommon = useTranslations('common');
  const allQ = useRouters({ includeDecommissioned: true });
  const runM = useBulkRouterOperation();

  const [tag, setTag] = useState('');
  const [operation, setOperation] = useState<BulkOperation>('reboot');
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<FleetResult | null>(null);

  const all = allQ.data ?? [];
  const tags = useMemo(() => [...new Set(all.flatMap((r) => r.tags ?? []))].sort(), [all]);
  const candidates = tag ? all.filter((r) => (r.tags ?? []).includes(tag)) : all;

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const close = () => {
    setSelected([]);
    setResult(null);
    runM.reset();
    onClose();
  };

  const run = async () => {
    const r = await runM.mutateAsync({ routerIds: selected, operation });
    setResult(r);
  };

  return (
    <Dialog open={open} onClose={close} title={t('title')} wide>
      {!result ? (
        <div className="flex flex-col gap-4">
          <p className="text-xs text-slate-400">{t('subtitle')}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('selectTag')}>
              <Select value={tag} onChange={(e) => { setTag(e.target.value); setSelected([]); }}>
                <option value="">{tCommon('allTags')}</option>
                {tags.map((tg) => (
                  <option key={tg} value={tg}>{tg}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('selectOperation')}>
              <Select value={operation} onChange={(e) => setOperation(e.target.value as BulkOperation)}>
                {bulkOps.map((op) => (
                  <option key={op} value={op}>{t(`operations.${op}`)}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label={`${t('selectRouters')} · ${t('selectedCount', { n: selected.length })}`}>
            <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900/60 p-3">
              {candidates.length === 0 && <p className="text-xs text-slate-500">{t('noRouters')}</p>}
              {candidates.map((r) => (
                <label key={r.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-800">
                  <input
                    type="checkbox" className="h-4 w-4 accent-emerald-500"
                    checked={selected.includes(r.id)} onChange={() => toggle(r.id)}
                  />
                  <span className="font-mono text-[13px] text-slate-200">{r.identityName}</span>
                  <StatusBadge status={r.status} />
                </label>
              ))}
            </div>
          </Field>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setSelected(candidates.map((r) => r.id))}>
              {t('selectAll')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>{t('clear')}</Button>
          </div>
          {runM.isError && <p className="text-sm text-red-300">{tCommon('error')}</p>}
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={close}>{tCommon('cancel')}</Button>
            <Button onClick={run} disabled={selected.length === 0 || runM.isPending}>
              {runM.isPending ? t('running') : `${t('run')} · ${selected.length}`}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <FleetResultView result={result} />
          <div className="flex justify-end">
            <Button variant="outline" onClick={close}>{tCommon('close')}</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

export default function RoutersPage() {
  const t = useTranslations('routers');
  const tCommon = useTranslations('common');
  const tStatus = useTranslations('status');
  const locale = useLocale();

  const [q, setQ] = useState('');
  const [status, setStatus] = useState<RouterStatus | 'all'>('all');
  const [siteId, setSiteId] = useState('');
  const [tag, setTag] = useState('');
  const [includeDecom, setIncludeDecom] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  const query = useRouters({
    q: q || undefined,
    status,
    siteId: siteId || undefined,
    tag: tag || undefined,
    includeDecommissioned: includeDecom || status === 'decommissioned',
  });

  const sitesQ = useSites();
  const allRoutersQ = useRouters({ includeDecommissioned: true });
  const deletePermM = useDeleteRouterPermanent();
  const testConnM = useTestRouterConnection();
  const syncM = useSyncRouter();
  const reconcileM = useReconcileHubSecrets();

  const routers = query.data ?? [];
  const allList = allRoutersQ.data ?? [];

  // Metric counts across all fleet
  const stats = useMemo(() => {
    return {
      total: allList.length,
      online: allList.filter((r) => r.status === 'online').length,
      offline: allList.filter((r) => r.status === 'offline' || r.status === 'suspect').length,
      pending: allList.filter((r) => r.status === 'pending').length,
      decom: allList.filter((r) => r.status === 'decommissioned').length,
    };
  }, [allList]);

  const allTags = useMemo(
    () => [...new Set(allList.flatMap((r) => r.tags ?? []))].sort(),
    [allList],
  );

  async function handlePermanentDelete() {
    if (!deleteTarget) return;
    try {
      await deletePermM.mutateAsync(deleteTarget.id);
      setActionFeedback({ id: deleteTarget.id, text: '✓ تم الحذف النهائي بنجاح', ok: true });
    } catch (err) {
      setActionFeedback({ id: deleteTarget.id, text: `فشل الحذف: ${(err as Error).message}`, ok: false });
    } finally {
      setDeleteTarget(null);
    }
  }

  async function handleTestConnection(id: string) {
    try {
      const res = await testConnM.mutateAsync(id);
      if (res.ok) {
        setActionFeedback({ id, text: `✓ متصل (${res.latencyMs}ms)`, ok: true });
      } else {
        setActionFeedback({ id, text: `✕ ${res.message}`, ok: false });
      }
    } catch (err) {
      setActionFeedback({ id, text: `✕ ${(err as Error).message}`, ok: false });
    }
  }

  async function handleSync(id: string) {
    try {
      const res = await syncM.mutateAsync(id);
      setActionFeedback({ id, text: res.ok ? '✓ تمت المزامنة' : `✕ ${res.message}`, ok: res.ok });
    } catch (err) {
      setActionFeedback({ id, text: `✕ ${(err as Error).message}`, ok: false });
    }
  }

  async function handleReconcileHub() {
    try {
      const res = await reconcileM.mutateAsync();
      setActionFeedback({
        id: 'global',
        text: t('reconcileSuccess', { count: res.removedCount }),
        ok: true,
      });
    } catch (err) {
      setActionFeedback({ id: 'global', text: `فشل التطهير: ${(err as Error).message}`, ok: false });
    } finally {
      setReconcileOpen(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReconcileOpen(true)}
              className="border-slate-700 hover:border-amber-500/50 hover:bg-amber-500/10 text-amber-300"
            >
              🧹 {t('reconcileHub')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setBulkOpen(true)}>
              ⚡ {t('bulkOps')}
            </Button>
            <Link href="/routers/new">
              <Button size="sm" className="bg-emerald-500 text-slate-950 font-bold hover:bg-emerald-400">
                + {t('onboard.title')}
              </Button>
            </Link>
          </div>
        }
      />

      {/* Global feedback banner */}
      {actionFeedback && (
        <div
          className={`flex items-center justify-between rounded-xl px-4 py-3 text-sm font-medium transition ${
            actionFeedback.ok
              ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/15 border border-rose-500/30 text-rose-300'
          }`}
        >
          <span>{actionFeedback.text}</span>
          <button
            onClick={() => setActionFeedback(null)}
            className="text-xs opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      {/* Quick stats ribbon */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <button
          onClick={() => { setStatus('all'); setIncludeDecom(false); }}
          className={`rounded-xl border p-3 text-start transition ${
            status === 'all' && !includeDecom
              ? 'border-emerald-500 bg-emerald-500/10'
              : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
          }`}
        >
          <p className="text-xs text-slate-400">{tCommon('all')}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-100">{stats.total}</p>
        </button>
        <button
          onClick={() => setStatus('online')}
          className={`rounded-xl border p-3 text-start transition ${
            status === 'online'
              ? 'border-emerald-500 bg-emerald-500/10'
              : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
          }`}
        >
          <p className="text-xs text-emerald-400">{tStatus('online')}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-300">{stats.online}</p>
        </button>
        <button
          onClick={() => setStatus('offline')}
          className={`rounded-xl border p-3 text-start transition ${
            status === 'offline'
              ? 'border-red-500 bg-red-500/10'
              : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
          }`}
        >
          <p className="text-xs text-red-400">{tStatus('offline')}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-red-300">{stats.offline}</p>
        </button>
        <button
          onClick={() => setStatus('pending')}
          className={`rounded-xl border p-3 text-start transition ${
            status === 'pending'
              ? 'border-amber-500 bg-amber-500/10'
              : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
          }`}
        >
          <p className="text-xs text-amber-400">{tStatus('pending')}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-amber-300">{stats.pending}</p>
        </button>
        <button
          onClick={() => { setStatus('decommissioned'); setIncludeDecom(true); }}
          className={`rounded-xl border p-3 text-start transition ${
            status === 'decommissioned'
              ? 'border-slate-600 bg-slate-800'
              : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
          }`}
        >
          <p className="text-xs text-slate-400">{tStatus('decommissioned')}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-400">{stats.decom}</p>
        </button>
      </div>

      {/* Filter and search bar */}
      <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center">
          <div className="flex-1">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="bg-slate-950/80 border-slate-700"
            />
          </div>
          <Select
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            className="sm:w-52 bg-slate-950/80 border-slate-700"
          >
            <option value="">{t('site')}: {tCommon('all')}</option>
            {(sitesQ.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Select
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            className="sm:w-44 bg-slate-950/80 border-slate-700"
          >
            <option value="">{t('tagFilter')}: {tCommon('allTags')}</option>
            {allTags.map((tg) => (
              <option key={tg} value={tg}>{tg}</option>
            ))}
          </Select>
          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer sm:ms-2">
            <input
              type="checkbox"
              checked={includeDecom}
              onChange={(e) => setIncludeDecom(e.target.checked)}
              className="h-4 w-4 rounded accent-emerald-500"
            />
            {t('showDecommissioned')}
          </label>
        </CardContent>
      </Card>

      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        refetch={() => query.refetch()}
        isEmpty={routers.length === 0}
        empty={
          <EmptyState
            title={t('empty')}
            hint={t('emptyHint')}
            action={
              <Link href="/routers/new">
                <Button>{t('onboard.title')}</Button>
              </Link>
            }
          />
        }
      >
        <Card className="border-slate-800 bg-slate-900/40">
          <CardContent className="pt-6">
            <div className="mb-4 flex items-center justify-between text-xs text-slate-500">
              <p>{tCommon('showingOf', { shown: routers.length, total: allList.length })}</p>
              <div className="flex gap-2 text-[11px]">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  {tStatus('online')}
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-red-400" />
                  {tStatus('offline')}
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                  {tStatus('pending')}
                </span>
              </div>
            </div>

            <Table>
              <THead>
                <Th>{t('identity')}</Th>
                <Th>{t('site')}</Th>
                <Th>{t('status')}</Th>
                <Th>{t('tunnelIp')}</Th>
                <Th>{t('version')}</Th>
                <Th>{t('lastSeen')}</Th>
                <Th className="text-end">الإجراءات</Th>
              </THead>
              <TBody>
                {routers.map((r) => (
                  <Tr key={r.id} className="hover:bg-slate-800/40">
                    <Td>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/routers/${r.id}`}
                          className="font-mono text-[13px] font-semibold text-emerald-300 hover:text-emerald-200 hover:underline"
                        >
                          {r.identityName || r.uuid.slice(0, 8)}
                        </Link>
                        {r.isHub && (
                          <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-bold text-violet-300 border border-violet-500/30">
                            HUB
                          </span>
                        )}
                      </div>
                      {(r.tags ?? []).length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {(r.tags ?? []).map((tg) => (
                            <span
                              key={tg}
                              onClick={() => setTag(tg)}
                              className="cursor-pointer rounded-full bg-sky-500/10 px-1.5 py-0.2 text-[10px] text-sky-300 hover:bg-sky-500/20"
                            >
                              #{tg}
                            </span>
                          ))}
                        </div>
                      )}
                    </Td>
                    <Td className="text-slate-300">{r.siteName ?? '—'}</Td>
                    <Td>
                      <StatusBadge status={r.status} />
                    </Td>
                    <Td>
                      <Mono className="text-slate-300 select-all">{r.tunnelIp ?? '—'}</Mono>
                    </Td>
                    <Td className="text-slate-400 text-xs">
                      {r.boardName ? `${r.boardName} ` : ''}
                      {r.routerOsVersion ? `(v${r.routerOsVersion})` : '—'}
                    </Td>
                    <Td className="whitespace-nowrap text-slate-400 text-xs">
                      {r.lastSeen ? formatDateTime(r.lastSeen, locale) : tCommon('never')}
                    </Td>
                    <Td className="text-end">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleTestConnection(r.id)}
                          disabled={testConnM.isPending}
                          title={t('testConnection')}
                          className="h-8 px-2 text-xs text-sky-300 hover:bg-sky-500/10"
                        >
                          ⚡ فحص
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleSync(r.id)}
                          disabled={syncM.isPending}
                          title={t('syncHardware')}
                          className="h-8 px-2 text-xs text-slate-300 hover:bg-slate-700"
                        >
                          🔄 مزامنة
                        </Button>
                        <Link href={`/routers/${r.id}`}>
                          <Button size="sm" variant="ghost" className="h-8 px-2 text-xs text-emerald-300 hover:bg-emerald-500/10">
                            👁️ عرض
                          </Button>
                        </Link>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeleteTarget({ id: r.id, name: r.identityName || r.tunnelIp || r.id })}
                          title={t('deletePermanent')}
                          className="h-8 px-2 text-xs text-rose-400 hover:bg-rose-500/15 hover:text-rose-300"
                        >
                          🗑️ {t('deletePermanent')}
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </QueryState>

      {/* Permanent Delete Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handlePermanentDelete}
        title={t('deletePermanentConfirmTitle')}
        message={`${t('deletePermanentConfirmMessage')} [${deleteTarget?.name ?? ''}]`}
        confirmLabel={t('deletePermanent')}
        loading={deletePermM.isPending}
      />

      {/* Reconcile Hub Dialog */}
      <ConfirmDialog
        open={reconcileOpen}
        onClose={() => setReconcileOpen(false)}
        onConfirm={handleReconcileHub}
        title={t('reconcileConfirmTitle')}
        message={t('reconcileConfirmMessage')}
        confirmLabel={t('reconcileHub')}
        loading={reconcileM.isPending}
      />

      <BulkOpsDialog open={bulkOpen} onClose={() => setBulkOpen(false)} />
    </div>
  );
}