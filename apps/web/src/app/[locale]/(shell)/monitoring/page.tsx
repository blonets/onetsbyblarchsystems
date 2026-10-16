'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { PageHeader, Tabs } from '@/components/ui/page';
import { EmptyState, QueryState } from '@/components/ui/states';
import { Table, TBody, THead, Th, Tr, Td, Mono } from '@/components/ui/table';
import { CpuMemChart, HotspotActiveChart, TrafficChart } from '@/components/charts';
import { RouterSelect, useRouterPicker } from '@/components/router-picker';
import {
  useAlertRules,
  useCreateAlertRule,
  useDeleteAlertRule,
  useDowntime,
  useFleetHealth,
  useHotspotActiveSessions,
  useKickHotspotSession,
  useNotificationChannels,
  useRouterMetrics,
  useRouters,
  useSearchHotspotSessions,
  useUpdateAlertRule,
} from '@/lib/queries';
import { formatBytes, formatDateTime, formatDurationMs, formatRate, formatUptime } from '@/lib/format';
import type { AlertKind, AlertRule, MetricRange } from '@/lib/types';

const ranges: MetricRange[] = ['1h', '24h', '7d'];
const kinds: AlertKind[] = ['router_offline', 'cpu_high', 'hotspot_spike', 'backup_failed'];

// ---------------------------------------------------------------- active hotspot sessions
function ActiveSessionsSection({ routerId }: { routerId: string }) {
  const t = useTranslations('monitoring.active');
  const tCommon = useTranslations('common');
  const q = useHotspotActiveSessions(routerId);
  const kickM = useKickHotspotSession(routerId);
  const [server, setServer] = useState('all');
  const [kicking, setKicking] = useState<{ id: string; username: string } | null>(null);

  const rows = q.data ?? [];
  const servers = [...new Set(rows.map((s) => s.server))];
  const filtered = server === 'all' ? rows : rows.filter((s) => s.server === server);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-3">
          {t('title')}
          <Field label={t('serverFilter')} className="w-44">
            <Select value={server} onChange={(e) => setServer(e.target.value)}>
              <option value="all">{t('allServers')}</option>
              {servers.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </Field>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <QueryState
          isLoading={q.isLoading} isError={q.isError} error={q.error} refetch={() => q.refetch()}
          isEmpty={filtered.length === 0}
          empty={<EmptyState title={t('empty')} />}
        >
          <Table>
            <THead>
              <Th>{t('username')}</Th><Th>{t('ip')}</Th><Th>{t('mac')}</Th><Th>{t('server')}</Th>
              <Th>{t('uptime')}</Th><Th>{t('download')}</Th><Th>{t('upload')}</Th><Th>{tCommon('actions')}</Th>
            </THead>
            <TBody>
              {filtered.map((s) => (
                <Tr key={s.id}>
                  <Td><Mono>{s.username}</Mono></Td>
                  <Td><Mono>{s.ip}</Mono></Td>
                  <Td><Mono>{s.mac}</Mono></Td>
                  <Td><Mono>{s.server}</Mono></Td>
                  <Td className="tabular-nums text-slate-400">{formatUptime(s.uptimeS)}</Td>
                  <Td className="tabular-nums text-slate-400">↓ {formatBytes(Number(s.bytesIn))}</Td>
                  <Td className="tabular-nums text-slate-400">↑ {formatBytes(Number(s.bytesOut))}</Td>
                  <Td>
                    <Button
                      size="sm" variant="ghost" className="text-red-300"
                      disabled={kickM.isPending}
                      onClick={() => setKicking({ id: s.id, username: s.username })}
                    >
                      {t('kick')}
                    </Button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </QueryState>
        <ConfirmDialog
          open={kicking !== null} onClose={() => setKicking(null)}
          onConfirm={async () => { if (kicking) await kickM.mutateAsync(kicking.id); setKicking(null); }}
          title={t('kickTitle')}
          message={t('kickMessage')}
          confirmLabel={t('kick')}
        />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- fleet-wide session lookup
function SessionLookupSection() {
  const t = useTranslations('monitoring.lookup');
  const [q, setQ] = useState('');
  const searchQ = useSearchHotspotSessions(q);
  const hits = searchQ.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <p className="text-xs text-slate-500">{t('subtitle')}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Input
          value={q} onChange={(e) => setQ(e.target.value)} dir="ltr"
          placeholder={t('placeholder')} className="max-w-md font-mono"
        />
        {q.trim().length < 2 ? (
          <EmptyState title={t('typeMore')} />
        ) : searchQ.isLoading ? (
          <p className="py-8 text-center text-sm text-slate-400">…</p>
        ) : hits.length === 0 ? (
          <EmptyState title={t('noResults')} />
        ) : (
          <div className="flex flex-col gap-3">
            {hits.map((h) => (
              <div key={h.routerId} className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-mono text-sm font-bold text-slate-100">{h.routerName}</p>
                  <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs text-emerald-300">
                    {h.sessions.length} {t('sessions')}
                  </span>
                </div>
                <Table>
                  <THead>
                    <Th>{t('username')}</Th><Th>{t('ip')}</Th><Th>{t('mac')}</Th><Th>{t('uptime')}</Th>
                  </THead>
                  <TBody>
                    {h.sessions.map((s) => (
                      <Tr key={s.id}>
                        <Td><Mono>{s.username}</Mono></Td>
                        <Td><Mono>{s.ip}</Mono></Td>
                        <Td><Mono>{s.mac}</Mono></Td>
                        <Td className="tabular-nums text-slate-400">{formatUptime(s.uptimeS)}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AlertRulesSection() {
  const t = useTranslations('monitoring.alerts');
  const tCommon = useTranslations('common');
  const tMon = useTranslations('monitoring');
  const rulesQ = useAlertRules();
  const channelsQ = useNotificationChannels();
  const createM = useCreateAlertRule();
  const updateM = useUpdateAlertRule();
  const deleteM = useDeleteAlertRule();

  const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'edit'; rule: AlertRule } | null>(null);
  const [deleting, setDeleting] = useState<AlertRule | null>(null);
  const [form, setForm] = useState<{ name: string; kind: AlertKind; threshold: number; channels: Array<'telegram' | 'email'> }>({
    name: '', kind: 'router_offline', threshold: 5, channels: ['telegram'],
  });

  const channels = channelsQ.data;
  const unconfigured = (c: 'telegram' | 'email') =>
    channels && (!channels[c].enabled || !channels[c].configured);

  const rules = rulesQ.data ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          {t('title')}
          <Button size="sm" onClick={() => { setForm({ name: '', kind: 'router_offline', threshold: 5, channels: ['telegram'] }); setDialog({ mode: 'create' }); }}>
            + {t('add')}
          </Button>
        </CardTitle>
        <p className="text-xs text-slate-500">{t('subtitle')}</p>
      </CardHeader>
      <CardContent>
        <QueryState
          isLoading={rulesQ.isLoading} isError={rulesQ.isError} error={rulesQ.error} refetch={() => rulesQ.refetch()}
          isEmpty={rules.length === 0}
          empty={<EmptyState title={t('empty')} />}
        >
          <Table>
            <THead><Th>{t('name')}</Th><Th>{t('kind')}</Th><Th>{t('threshold')}</Th><Th>{t('channels')}</Th><Th>{tCommon('status')}</Th><Th>{tCommon('actions')}</Th></THead>
            <TBody>
              {rules.map((r) => (
                <Tr key={r.id} className={!r.enabled ? 'opacity-55' : undefined}>
                  <Td className="font-medium">{r.name}</Td>
                  <Td className="text-slate-400">{t(`kinds.${r.kind}`)}</Td>
                  <Td className="tabular-nums">{r.threshold} <span className="text-[11px] text-slate-500">{t(`thresholdHints.${r.kind}`)}</span></Td>
                  <Td>
                    <div className="flex gap-1.5">
                      {r.channels.map((c) => (
                        <span
                          key={c}
                          className={`rounded-full px-2 py-0.5 text-[11px] ${unconfigured(c) ? 'bg-amber-500/15 text-amber-300' : 'bg-slate-800 text-slate-300'}`}
                          title={unconfigured(c) ? tMon('needsConfigHint') : undefined}
                        >
                          {c === 'telegram' ? t('telegram') : t('email')}
                          {unconfigured(c) && ` · ${tMon('needsConfig')}`}
                        </span>
                      ))}
                    </div>
                  </Td>
                  <Td>
                    <Switch checked={r.enabled} onChange={(v) => updateM.mutate({ id: r.id, input: { enabled: v } })} label={r.name} />
                  </Td>
                  <Td>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setForm({ name: r.name, kind: r.kind, threshold: r.threshold, channels: [...r.channels] }); setDialog({ mode: 'edit', rule: r }); }}>
                        {tCommon('edit')}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-red-300" onClick={() => setDeleting(r)}>
                        {tCommon('delete')}
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </QueryState>

        <Dialog open={dialog !== null} onClose={() => setDialog(null)} title={dialog?.mode === 'edit' ? t('edit') : t('add')}>
          <form
            className="flex flex-col gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (dialog?.mode === 'edit') await updateM.mutateAsync({ id: dialog.rule.id, input: { ...form, enabled: dialog.rule.enabled } });
              else await createM.mutateAsync({ ...form, enabled: true });
              setDialog(null);
            }}
          >
            <Field label={t('name')}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
            <Field label={t('kind')}>
              <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as AlertKind })}>
                {kinds.map((k) => (
                  <option key={k} value={k}>{t(`kinds.${k}`)}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('threshold')} hint={t(`thresholdHints.${form.kind}`)}>
              <Input type="number" min={1} dir="ltr" value={form.threshold} onChange={(e) => setForm({ ...form, threshold: Number(e.target.value) })} required />
            </Field>
            <Field label={t('channels')}>
              <div className="flex gap-4">
                {(['telegram', 'email'] as const).map((c) => (
                  <label key={c} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-emerald-500"
                      checked={form.channels.includes(c)}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          channels: e.target.checked ? [...f.channels, c] : f.channels.filter((x) => x !== c),
                        }))
                      }
                    />
                    {c === 'telegram' ? t('telegram') : t('email')}
                    {unconfigured(c) && <span className="text-[11px] text-amber-300">({tMon('needsConfig')})</span>}
                  </label>
                ))}
              </div>
            </Field>
            <Button type="submit" disabled={createM.isPending || updateM.isPending}>{tCommon('save')}</Button>
          </form>
        </Dialog>
        <ConfirmDialog
          open={deleting !== null} onClose={() => setDeleting(null)}
          onConfirm={async () => { if (deleting) await deleteM.mutateAsync(deleting.id); setDeleting(null); }}
          title={t('deleteTitle')} message={t('deleteMessage')} confirmLabel={tCommon('delete')}
        />
      </CardContent>
    </Card>
  );
}

export default function MonitoringPage() {
  const t = useTranslations('monitoring');
  const tCommon = useTranslations('common');
  const tDown = useTranslations('monitoring.downtime');
  const tFleet = useTranslations('monitoring.fleetHealth');
  const tActive = useTranslations('monitoring.active');
  const locale = useLocale();

  const { routers, selected, setSelected, isLoading } = useRouterPicker();
  const routersQ = useRouters();
  const [range, setRange] = useState<MetricRange>('1h');
  const [section, setSection] = useState<'overview' | 'active' | 'lookup'>('overview');

  const metricsQ = useRouterMetrics(selected, range);
  const downtimeQ = useDowntime(selected || undefined);
  const healthQ = useFleetHealth();

  const routerName = (id: string) => routersQ.data?.find((r) => r.id === id)?.identityName ?? id;
  const downtime = downtimeQ.data ?? [];

  const sectionTabs = [
    { key: 'overview' as const, label: tActive('tabOverview') },
    { key: 'active' as const, label: tActive('tabActive') },
    { key: 'lookup' as const, label: tActive('tabLookup') },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={<RouterSelect routers={routers} selected={selected} onChange={setSelected} />}
      />

      {/* fleet health */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[
          { label: tFleet('title'), value: healthQ.data ? `${healthQ.data.online}/${healthQ.data.total}` : '—', accent: 'text-emerald-300' },
          { label: tFleet('avgCpu'), value: healthQ.data ? `${healthQ.data.avgCpuPct}%` : '—', accent: 'text-sky-300' },
          { label: tFleet('totalHotspot'), value: healthQ.data?.totalHotspotActive ?? '—', accent: 'text-violet-300' },
          { label: tDown('title'), value: downtime.filter((d) => !d.endedAt).length, accent: 'text-amber-300' },
        ].map((c) => (
          <Card key={c.label}>
            <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-slate-400">{c.label}</CardTitle></CardHeader>
            <CardContent><p className={`text-3xl font-bold tabular-nums ${c.accent}`}>{c.value}</p></CardContent>
          </Card>
        ))}
      </div>

      <Tabs tabs={sectionTabs} active={section} onChange={setSection} />

      {section === 'lookup' && <SessionLookupSection />}

      {section === 'active' && (
        !selected || isLoading ? (
          <EmptyState title={t('selectRouter')} />
        ) : (
          <ActiveSessionsSection routerId={selected} />
        )
      )}

      {section === 'overview' && (
        <>
          {/* per-router charts */}
          {!selected || isLoading ? (
            <EmptyState title={t('selectRouter')} />
          ) : (
            <>
              <Tabs tabs={ranges.map((r) => ({ key: r, label: t(`range.${r}`) }))} active={range} onChange={setRange} />
              {metricsQ.isLoading ? (
                <Card><CardContent className="py-12 text-center text-sm text-slate-400">{tCommon('loading')}</CardContent></Card>
              ) : metricsQ.isError ? (
                <Card><CardContent className="py-12 text-center text-sm text-red-300">{tCommon('error')}</CardContent></Card>
              ) : (
                <div className="grid gap-4 xl:grid-cols-2">
                  <CpuMemChart title={t('cpuMem')} data={metricsQ.data ?? []} />
                  <TrafficChart title={t('traffic')} data={metricsQ.data ?? []} formatRate={formatRate} />
                  <div className="xl:col-span-2">
                    <HotspotActiveChart title={t('hotspotActive')} data={metricsQ.data ?? []} />
                  </div>
                </div>
              )}
            </>
          )}

          {/* downtime ledger */}
          <Card>
            <CardHeader><CardTitle>{tDown('title')}</CardTitle></CardHeader>
            <CardContent>
              {downtime.length === 0 ? (
                <EmptyState title={tDown('empty')} />
              ) : (
                <Table>
                  <THead>
                    <Th>{tDown('router')}</Th><Th>{tDown('disconnectedAt')}</Th><Th>{tDown('reconnectedAt')}</Th>
                    <Th>{tDown('duration')}</Th><Th>{tDown('reason')}</Th><Th>{tCommon('status')}</Th>
                  </THead>
                  <TBody>
                    {downtime.map((d) => (
                      <Tr key={d.id}>
                        <Td><Mono>{routerName(d.routerId)}</Mono></Td>
                        <Td className="whitespace-nowrap text-slate-400">{formatDateTime(d.startedAt, locale)}</Td>
                        <Td className="whitespace-nowrap text-slate-400">
                          {d.endedAt ? formatDateTime(d.endedAt, locale) : '—'}
                        </Td>
                        <Td className="tabular-nums text-slate-300">
                          {d.durationS != null
                            ? formatDurationMs(d.durationS * 1000)
                            : <span className="text-amber-300">{formatDurationMs(Date.now() - new Date(d.startedAt).getTime())}</span>}
                        </Td>
                        <Td className="text-slate-500">{d.cause ?? '—'}</Td>
                        <Td>
                          {d.endedAt ? <StatusBadge status="online" /> : <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs text-amber-300">{tDown('open')}</span>}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <AlertRulesSection />
    </div>
  );
}
