'use client';

import { use, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { PageHeader } from '@/components/ui/page';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, TBody, Tr, Td, Mono } from '@/components/ui/table';
import { useRouter as useRouterQuery, useRouterResources, useRebootRouter, useRotateRouterSecret, useDeleteRouter } from '@/lib/queries';
import { useSocketRoom } from '@/lib/socket';
import { formatBytes, formatDateTime, formatRate, formatUptime } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import type { RouterStatus } from '@/lib/types';

function PortRow({ label, value, custom }: { label: string; value?: number; custom?: boolean }) {
  return (
    <Tr>
      <Td className="text-slate-400">{label}</Td>
      <Td>
        <Mono className={custom ? 'text-amber-300' : undefined}>{value ?? '—'}</Mono>
        {custom && <span className="ms-2 text-[10px] text-amber-400">*</span>}
      </Td>
    </Tr>
  );
}

export default function RouterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations('routers.detail');
  const tRouters = useTranslations('routers');
  const tNav = useTranslations('nav');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const nav = useRouter();
  const { canEditNetwork } = useAuth();

  const detailQ = useRouterQuery(id);
  const resQ = useRouterResources(id, true);
  const rebootM = useRebootRouter();
  const rotateM = useRotateRouterSecret();
  const deleteM = useDeleteRouter();

  const [confirm, setConfirm] = useState<'reboot' | 'rotate' | 'delete' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<RouterStatus | null>(null);
  const [liveMetrics, setLiveMetrics] = useState<{ cpuPct: number; hotspotActive: number } | null>(null);

  useSocketRoom(`router:${id}`, 'router:status', (p) => {
    if (p.routerId === id) {
      setLiveStatus(p.status);
      detailQ.refetch();
    }
  });
  useSocketRoom(`router:${id}`, 'router:metrics', (p) => {
    if (p.routerId === id) setLiveMetrics({ cpuPct: p.point.cpuPct, hotspotActive: p.point.hotspotActive });
  });

  if (detailQ.isLoading) return <LoadingState />;
  if (detailQ.isError || !detailQ.data)
    return <ErrorState onRetry={() => detailQ.refetch()} message={t('notFound')} />;

  const r = detailQ.data;
  const res = resQ.data;
  const status = liveStatus ?? r.status;
  const memUsed = res ? res.totalMemoryBytes - res.freeMemoryBytes : undefined;

  async function doConfirm() {
    try {
      if (confirm === 'reboot') {
        const out = await rebootM.mutateAsync(r.id);
        setNotice(out.message || t('rebootQueued'));
      } else if (confirm === 'rotate') {
        await rotateM.mutateAsync(r.id);
        setNotice(t('rotateDone'));
      } else if (confirm === 'delete') {
        await deleteM.mutateAsync(r.id);
        nav.push('/routers');
        return;
      }
    } finally {
      setConfirm(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={r.identityName ?? r.id}
        subtitle={`${r.siteName ?? ''} · ${r.tunnelIp ?? ''}`}
        actions={
          <Link href="/routers">
            <Button variant="outline">← {tCommon('back')}</Button>
          </Link>
        }
      />

      {notice && (
        <p className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{notice}</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={status} />
        <span className="flex items-center gap-1.5 rounded-full bg-sky-500/10 px-3 py-1 text-xs text-sky-300">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
          {t('liveBadge')}
        </span>
        {r.isHub && <span className="rounded-full bg-violet-500/15 px-3 py-1 text-xs text-violet-300">HUB</span>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('overview')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TBody>
                <Tr><Td className="text-slate-400">{tRouters('tunnelIp')}</Td><Td><Mono>{r.tunnelIp ?? '—'}</Mono></Td></Tr>
                <Tr><Td className="text-slate-400">{t('board')}</Td><Td>{r.boardName ?? '—'}</Td></Tr>
                <Tr><Td className="text-slate-400">{tRouters('version')}</Td><Td><Mono>{r.routerOsVersion ?? '—'}</Mono></Td></Tr>
                <Tr><Td className="text-slate-400">{t('arch')}</Td><Td><Mono>{r.architecture ?? '—'}</Mono></Td></Tr>
                <Tr><Td className="text-slate-400">{tRouters('lastSeen')}</Td><Td>{r.lastSeen ? formatDateTime(r.lastSeen, locale) : tCommon('never')}</Td></Tr>
                <Tr><Td className="text-slate-400">UUID</Td><Td><Mono className="text-xs">{r.id}</Mono></Td></Tr>
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('resources')}</CardTitle>
          </CardHeader>
          <CardContent>
            {!res ? (
              <EmptyState title={tCommon('loading')} />
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: t('cpu'), value: `${liveMetrics?.cpuPct ?? res.cpuLoadPct}%` },
                  { label: t('memory'), value: memUsed !== undefined ? `${formatBytes(memUsed)} / ${formatBytes(res.totalMemoryBytes)}` : '—' },
                  { label: t('uptime'), value: formatUptime(res.uptimeSeconds) },
                  { label: t('hotspotActiveNow'), value: `${liveMetrics?.hotspotActive ?? res.hotspotActive}` },
                  { label: `${t('rxTx')} ↓`, value: formatRate(res.tunnelRxBps) },
                  { label: `${t('rxTx')} ↑`, value: formatRate(res.tunnelTxBps) },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl bg-slate-800/50 px-4 py-3">
                    <p className="text-xs text-slate-400">{s.label}</p>
                    <p className="mt-1 text-lg font-bold tabular-nums">{s.value}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('portsTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {r.isHub && <p className="mb-3 text-xs text-amber-300">* {t('noteHubPorts')}</p>}
          <div className="grid gap-4 md:grid-cols-2">
            <Table>
              <TBody>
                <PortRow label={t('apiPort')} value={r.apiPort} />
                <PortRow label="API-SSL" value={r.apiSslPort} />
                <PortRow label="WinBox" value={r.winboxPort} />
              </TBody>
            </Table>
            <Table>
              <TBody>
                <PortRow label={t('sshPort')} value={r.sshPort} custom={r.sshPort !== 22} />
                <PortRow label="Telnet" value={r.telnetPort} custom={r.telnetPort !== 23} />
                <PortRow label="FTP" value={r.ftpPort} custom={r.ftpPort !== 21} />
                <PortRow label="WWW" value={r.wwwPort} custom={r.wwwPort !== 80} />
              </TBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('actions')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => setConfirm('reboot')} disabled={rebootM.isPending}>
            {t('reboot')}
          </Button>
          {canEditNetwork && (
            <Button variant="outline" onClick={() => setConfirm('rotate')} disabled={rotateM.isPending}>
              {t('rotateSecret')}
            </Button>
          )}
          <Link href={`/hotspot?router=${r.id}`}>
            <Button variant="outline">{tNav('hotspot')}</Button>
          </Link>
          <Link href={`/firewall?router=${r.id}`}>
            <Button variant="outline">{tNav('firewall')}</Button>
          </Link>
          <Link href={`/monitoring?router=${r.id}`}>
            <Button variant="outline">{tNav('monitoring')}</Button>
          </Link>
          <Link href={`/backups?router=${r.id}`}>
            <Button variant="outline">{tNav('backups')}</Button>
          </Link>
          {canEditNetwork && (
            <Button variant="destructive" onClick={() => setConfirm('delete')} disabled={deleteM.isPending}>
              {tRouters('deleteRouter')}
            </Button>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirm === 'reboot'}
        onClose={() => setConfirm(null)}
        onConfirm={doConfirm}
        title={t('rebootTitle')}
        message={t('rebootMessage')}
        confirmLabel={t('reboot')}
        loading={rebootM.isPending}
      />
      <ConfirmDialog
        open={confirm === 'rotate'}
        onClose={() => setConfirm(null)}
        onConfirm={doConfirm}
        title={t('rotateTitle')}
        message={t('rotateMessage')}
        confirmLabel={t('rotateSecret')}
        loading={rotateM.isPending}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        onConfirm={doConfirm}
        title={tRouters('deleteConfirmTitle')}
        message={tRouters('deleteConfirmMessage')}
        confirmLabel={tCommon('delete')}
        loading={deleteM.isPending}
      />
    </div>
  );
}
