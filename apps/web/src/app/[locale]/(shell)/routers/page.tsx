'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/page';
import { EmptyState, QueryState } from '@/components/ui/states';
import { Table, TBody, THead, Th, Tr, Td, Mono } from '@/components/ui/table';
import { FleetResultView } from '@/components/fleet-result';
import { useBulkRouterOperation, useRouters, useSites } from '@/lib/queries';
import { formatDateTime } from '@/lib/format';
import type { BulkOperation, FleetResult, RouterStatus } from '@/lib/types';

const statuses: Array<RouterStatus | 'all'> = ['all', 'online', 'offline', 'pending', 'suspect', 'decommissioned'];
const bulkOps: BulkOperation[] = ['reboot', 'rotate-secret', 'trigger-backup'];

// ---------------------------------------------------------------- bulk operations
function BulkOpsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('routers.bulk');
  const tCommon = useTranslations('common');
  const allQ = useRouters();
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
          <p className="text-xs text-slate-500">{t('subtitle')}</p>
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
            <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto rounded-xl border border-slate-700 p-3">
              {candidates.length === 0 && <p className="text-xs text-slate-500">{t('noRouters')}</p>}
              {candidates.map((r) => (
                <label key={r.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-800">
                  <input
                    type="checkbox" className="h-5 w-5 accent-emerald-500"
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
  const [bulkOpen, setBulkOpen] = useState(false);

  const query = useRouters({ q: q || undefined, status, siteId: siteId || undefined, tag: tag || undefined });
  const sitesQ = useSites();
  const allTagsQ = useRouters();
  const routers = query.data ?? [];
  const allTags = useMemo(
    () => [...new Set((allTagsQ.data ?? []).flatMap((r) => r.tags ?? []))].sort(),
    [allTagsQ.data],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setBulkOpen(true)}>⚡ {t('bulkOps')}</Button>
            <Link href="/routers/new">
              <Button>+ {t('onboard.title')}</Button>
            </Link>
          </div>
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row">
          <div className="flex-1">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('searchPlaceholder')}
            />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value as RouterStatus | 'all')} className="sm:w-48">
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? `${t('filterStatus')}: ${tCommon('all')}` : tStatus(s)}
              </option>
            ))}
          </Select>
          <Select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="sm:w-56">
            <option value="">{t('site')}: {tCommon('all')}</option>
            {(sitesQ.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Select value={tag} onChange={(e) => setTag(e.target.value)} className="sm:w-48">
            <option value="">{t('tagFilter')}: {tCommon('allTags')}</option>
            {allTags.map((tg) => (
              <option key={tg} value={tg}>{tg}</option>
            ))}
          </Select>
        </CardContent>
      </Card>

      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        refetch={() => query.refetch()}
        isEmpty={routers.length === 0}
        empty={<EmptyState title={t('empty')} hint={t('emptyHint')} action={<Link href="/routers/new"><Button>{t('onboard.title')}</Button></Link>} />}
      >
        <Card>
          <CardContent className="pt-6">
            <p className="mb-3 text-xs text-slate-500">
              {tCommon('showingOf', { shown: routers.length, total: routers.length })}
            </p>
            <Table>
              <THead>
                <Th>{t('identity')}</Th>
                <Th>{t('site')}</Th>
                <Th>{t('tags')}</Th>
                <Th>{t('status')}</Th>
                <Th>{t('tunnelIp')}</Th>
                <Th>{t('version')}</Th>
                <Th>{t('lastSeen')}</Th>
              </THead>
              <TBody>
                {routers.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <Link href={`/routers/${r.id}`} className="font-mono text-[13px] text-emerald-300 hover:underline">
                        {r.identityName}
                      </Link>
                      {r.isHub && (
                        <span className="ms-2 rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-300">
                          HUB
                        </span>
                      )}
                    </Td>
                    <Td className="text-slate-300">{r.siteName ?? '—'}</Td>
                    <Td>
                      {(r.tags ?? []).length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {(r.tags ?? []).map((tg) => (
                            <button
                              key={tg}
                              onClick={() => setTag(tg)}
                              className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] text-sky-300 hover:bg-sky-500/25"
                              title={`${t('tagFilter')}: ${tg}`}
                            >
                              {tg}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </Td>
                    <Td>
                      <StatusBadge status={r.status} />
                    </Td>
                    <Td>
                      <Mono>{r.tunnelIp ?? '—'}</Mono>
                    </Td>
                    <Td className="text-slate-400">{r.routerOsVersion ?? '—'}</Td>
                    <Td className="whitespace-nowrap text-slate-400">
                      {r.lastSeen ? formatDateTime(r.lastSeen, locale) : tCommon('never')}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </QueryState>

      <BulkOpsDialog open={bulkOpen} onClose={() => setBulkOpen(false)} />
    </div>
  );
}
