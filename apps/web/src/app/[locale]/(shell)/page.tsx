'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, TBody, THead, Th, Tr, Td, Mono } from '@/components/ui/table';
import { useDowntime, useFleetHealth, useRevenueSummary, useRouters } from '@/lib/queries';
import { useAuditLog } from '@/lib/queries';
import { formatDateTime, formatDurationMs } from '@/lib/format';

function RevenueTile() {
  const t = useTranslations('dashboard.revenue');
  const q = useRevenueSummary();
  const s = q.data;

  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium text-slate-400">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <p className="text-3xl font-bold text-slate-600">—</p>
        ) : (
          <>
            <p className="text-3xl font-bold tabular-nums text-amber-300">
              {s?.revenue != null ? `${s.revenue.toLocaleString()} ${s.currency}` : `0 ${s?.currency ?? ''}`}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {t('vouchers')}: <span className="tabular-nums font-semibold text-slate-300">{s?.vouchers ?? 0}</span>
            </p>
            {s?.revenue == null && (
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{t('unset')}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const tNav = useTranslations('nav');
  const tDown = useTranslations('monitoring.downtime');
  const locale = useLocale();

  const routersQ = useRouters();
  const healthQ = useFleetHealth();
  const downtimeQ = useDowntime();
  const auditQ = useAuditLog(1);

  const routers = routersQ.data ?? [];
  const health = healthQ.data;
  const openOutages = (downtimeQ.data ?? []).filter((d) => !d.endedAt);
  const recentAudit = (auditQ.data?.items ?? []).slice(0, 6);

  const cards = [
    { label: t('total'), value: health?.total ?? routers.length, accent: 'text-slate-100' },
    { label: t('online'), value: health?.online ?? 0, accent: 'text-emerald-300' },
    { label: t('offline'), value: (health?.offline ?? 0) + (health?.suspect ?? 0), accent: 'text-red-300' },
    { label: t('pending'), value: health?.pending ?? 0, accent: 'text-amber-300' },
    { label: t('hotspotActive'), value: health?.totalHotspotActive ?? 0, accent: 'text-violet-300' },
    { label: t('avgCpu'), value: health ? `${health.avgCpuPct}%` : '—', accent: 'text-sky-300' },
  ];

  if (routersQ.isLoading || healthQ.isLoading) return <LoadingState />;
  if (routersQ.isError || healthQ.isError)
    return <ErrorState onRetry={() => { routersQ.refetch(); healthQ.refetch(); }} />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Link
            href="/routers"
            className="inline-flex h-11 items-center rounded-lg bg-emerald-500 px-4 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
          >
            {t('viewRouters')}
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-6">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-medium text-slate-400">{c.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`text-3xl font-bold tabular-nums ${c.accent}`}>{c.value}</p>
            </CardContent>
          </Card>
        ))}
        <RevenueTile />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              {t('fleetHealth')} · {t('downtimeNow')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {openOutages.length === 0 ? (
              <p className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-4 py-6 text-sm text-emerald-300">
                ✓ {t('allClear')}
              </p>
            ) : (
              <Table>
                <THead>
                  <Th>{tDown('router')}</Th>
                  <Th>{tDown('disconnectedAt')}</Th>
                  <Th>{tDown('duration')}</Th>
                  <Th>{t('offline')}</Th>
                </THead>
                <TBody>
                  {openOutages.map((d) => {
                    const r = routers.find((x) => x.id === d.routerId);
                    return (
                      <Tr key={d.id}>
                        <Td>
                          <Mono>{r?.identityName ?? d.routerId}</Mono>
                        </Td>
                        <Td className="text-slate-400">{formatDateTime(d.startedAt, locale)}</Td>
                        <Td className="tabular-nums text-amber-300">
                          {formatDurationMs(Date.now() - new Date(d.startedAt).getTime())}
                        </Td>
                        <Td>
                          <StatusBadge status="offline" />
                        </Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('recentActivity')}</CardTitle>
          </CardHeader>
          <CardContent>
            {recentAudit.length === 0 ? (
              <EmptyState title={t('noActivity')} />
            ) : (
              <ul className="flex flex-col gap-3">
                {recentAudit.map((a) => (
                  <li key={a.id} className="flex items-start gap-3 rounded-xl bg-slate-800/40 px-4 py-3">
                    <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[13px] text-slate-200">{a.action}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {a.actorType === 'system' ? 'system' : a.actorId} ·{' '}
                        {formatDateTime(a.createdAt, locale)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{tNav('routers')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <Th>{tNav('routers')}</Th>
            </THead>
            <TBody>
              {routers.slice(0, 5).map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Link href={`/routers/${r.id}`} className="font-mono text-[13px] text-emerald-300 hover:underline">
                          {r.identityName}
                        </Link>
                        <p className="text-xs text-slate-500">{r.siteName}</p>
                      </div>
                      <StatusBadge status={r.status} />
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
