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
import {
  useRouter as useRouterQuery,
  useRouterResources,
  useRebootRouter,
  useRotateRouterSecret,
  useDeleteRouter,
  useDeleteRouterPermanent,
  useTestRouterConnection,
  useSyncRouter,
} from '@/lib/queries';
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
  const deletePermM = useDeleteRouterPermanent();
  const testConnM = useTestRouterConnection();
  const syncM = useSyncRouter();

  const [confirm, setConfirm] = useState<'reboot' | 'rotate' | 'delete' | 'deletePermanent' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<RouterStatus | null>(null);
  const [liveMetrics, setLiveMetrics] = useState<{ cpuPct: number; hotspotActive: number } | null>(null);
  const [testResult, setTestResult] = useState<{ latencyMs: number; ok: boolean } | null>(null);

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

  async function handleTest() {
    try {
      const out = await testConnM.mutateAsync(r.id);
      setTestResult({ latencyMs: out.latencyMs, ok: out.ok });
      setNotice(out.ok ? `✓ اتصال سريع بالراوتر (${out.latencyMs}ms)` : `✕ ${out.message}`);
    } catch (err) {
      setNotice(`✕ ${(err as Error).message}`);
    }
  }

  async function handleSync() {
    try {
      const out = await syncM.mutateAsync(r.id);
      setNotice(out.ok ? '✓ تمت مزامنة مواصفات وبيانات الراوتر بنجاح' : `✕ ${out.message}`);
    } catch (err) {
      setNotice(`✕ ${(err as Error).message}`);
    }
  }

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
      } else if (confirm === 'deletePermanent') {
        await deletePermM.mutateAsync(r.id);
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
        subtitle={`${r.siteName ?? ''} · IP النفق: ${r.tunnelIp ?? '—'}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={testConnM.isPending}
              className="border-sky-500/40 text-sky-300 hover:bg-sky-500/10"
            >
              {testConnM.isPending ? 'جارٍ الفحص…' : '⚡ فحص الاتصال'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSync}
              disabled={syncM.isPending}
              className="border-slate-700 text-slate-200 hover:bg-slate-800"
            >
              {syncM.isPending ? 'جارٍ المزامنة…' : '🔄 مزامنة البيانات'}
            </Button>
            <Link href="/routers">
              <Button variant="outline" size="sm">← {tCommon('back')}</Button>
            </Link>
          </div>
        }
      />

      {notice && (
        <div className="flex items-center justify-between rounded-xl bg-slate-900 border border-slate-700 px-4 py-3 text-sm text-slate-200">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-xs text-slate-500 hover:text-slate-300">✕</button>
        </div>
      )}

      {/* Hero identity and status bar */}
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={status} />
        <span className="flex items-center gap-1.5 rounded-full bg-sky-500/10 px-3 py-1 text-xs text-sky-300 border border-sky-500/20">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
          {t('liveBadge')}
        </span>
        {testResult && (
          <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-mono text-emerald-300 border border-emerald-500/30">
            {testResult.latencyMs} ms
          </span>
        )}
        {r.isHub && <span className="rounded-full bg-violet-500/20 px-3 py-1 text-xs font-bold text-violet-300 border border-violet-500/30">HUB SERVER</span>}
        <span className="text-xs text-slate-500 font-mono">UUID: {r.uuid}</span>
      </div>

      {/* Telemetry metrics widgets */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-slate-800 bg-slate-900/40">
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-slate-400">{t('cpu')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums text-sky-300">
              {liveMetrics?.cpuPct ?? res?.cpuLoadPct ?? 0}%
            </p>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full bg-sky-400 transition-all duration-500"
                style={{ width: `${Math.min(100, liveMetrics?.cpuPct ?? res?.cpuLoadPct ?? 0)}%` }}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900/40">
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-slate-400">{t('memory')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums text-slate-200">
              {memUsed !== undefined ? `${formatBytes(memUsed)}` : '—'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              من إجمالي {res ? formatBytes(res.totalMemoryBytes) : '—'}
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900/40">
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-slate-400">{t('hotspotActiveNow')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums text-violet-300">
              {liveMetrics?.hotspotActive ?? res?.hotspotActive ?? 0}
            </p>
            <p className="text-xs text-slate-500 mt-1">مستخدم متصل الآن</p>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900/40">
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-slate-400">{t('uptime')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums text-emerald-300">
              {res ? formatUptime(res.uptimeSeconds) : '—'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              آخر ظهور: {r.lastSeen ? formatDateTime(r.lastSeen, locale) : tCommon('never')}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-slate-800 bg-slate-900/40">
          <CardHeader>
            <CardTitle>{t('overview')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TBody>
                <Tr><Td className="text-slate-400">{tRouters('tunnelIp')}</Td><Td><Mono className="text-emerald-300">{r.tunnelIp ?? '—'}</Mono></Td></Tr>
                <Tr><Td className="text-slate-400">{t('board')}</Td><Td className="font-semibold text-slate-200">{r.boardName ?? '—'}</Td></Tr>
                <Tr><Td className="text-slate-400">{tRouters('version')}</Td><Td><Mono>RouterOS {r.routerOsVersion ?? '—'}</Mono></Td></Tr>
                <Tr><Td className="text-slate-400">الرقم التسلسلي</Td><Td><Mono>{r.serialNumber ?? '—'}</Mono></Td></Tr>
                <Tr><Td className="text-slate-400">اسم المستخدم للـ API</Td><Td><Mono>{r.apiUsername ?? 'panel-api'}</Mono></Td></Tr>
                <Tr><Td className="text-slate-400">اسم مستخدم الـ SSTP</Td><Td><Mono className="text-xs">{r.sstpUsername}</Mono></Td></Tr>
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900/40">
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
            {res && (
              <div className="mt-4 flex gap-4 pt-4 border-t border-slate-800 text-xs">
                <div>حركة النفق ↓: <span className="font-mono text-emerald-400">{formatRate(res.tunnelRxBps)}</span></div>
                <div>حركة النفق ↑: <span className="font-mono text-sky-400">{formatRate(res.tunnelTxBps)}</span></div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Network Modules Navigation */}
      <Card className="border-slate-800 bg-slate-900/40">
        <CardHeader>
          <CardTitle>وحدات الإدارة المربوطة بالراوتر</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Link href={`/hotspot?router=${r.id}`} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 hover:border-violet-500/50 hover:bg-violet-500/5 transition">
            <p className="text-sm font-semibold text-violet-300">👥 {tNav('hotspot')}</p>
            <p className="mt-1 text-xs text-slate-400">إدارة كروت وباقات الهوت سبوت والمستخدمين المتصلين</p>
          </Link>
          <Link href={`/firewall?router=${r.id}`} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 hover:border-sky-500/50 hover:bg-sky-500/5 transition">
            <p className="text-sm font-semibold text-sky-300">🛡️ {tNav('firewall')}</p>
            <p className="mt-1 text-xs text-slate-400">قواعد الحماية، الـ NAT، وإعادة توجيه المنافذ</p>
          </Link>
          <Link href={`/queues?router=${r.id}`} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 hover:border-emerald-500/50 hover:bg-emerald-500/5 transition">
            <p className="text-sm font-semibold text-emerald-300">⚡ {tNav('queues')}</p>
            <p className="mt-1 text-xs text-slate-400">تحديد السرعات وتوزيع الباندويث العادل</p>
          </Link>
          <Link href={`/backups?router=${r.id}`} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 hover:border-amber-500/50 hover:bg-amber-500/5 transition">
            <p className="text-sm font-semibold text-amber-300">💾 {tNav('backups')}</p>
            <p className="mt-1 text-xs text-slate-400">النسخ الاحتياطي التلقائي وسحب ملفات الإعدادات</p>
          </Link>
        </CardContent>
      </Card>

      {/* Control Actions & Danger Zone */}
      <Card className="border-slate-800 bg-slate-900/40">
        <CardHeader>
          <CardTitle>{t('actions')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => setConfirm('reboot')} disabled={rebootM.isPending}>
              {t('reboot')}
            </Button>
            {canEditNetwork && (
              <Button variant="outline" onClick={() => setConfirm('rotate')} disabled={rotateM.isPending}>
                {t('rotateSecret')}
              </Button>
            )}
            {canEditNetwork && (
              <Button
                variant="outline"
                className="border-slate-700 text-slate-400 hover:bg-slate-800"
                onClick={() => setConfirm('delete')}
                disabled={deleteM.isPending}
              >
                {tRouters('deleteRouter')} (تعطيل)
              </Button>
            )}
          </div>

          {canEditNetwork && (
            <div>
              <Button
                variant="destructive"
                className="bg-rose-600 hover:bg-rose-500 text-white font-bold"
                onClick={() => setConfirm('deletePermanent')}
                disabled={deletePermM.isPending}
              >
                🗑️ {tRouters('deletePermanent')}
              </Button>
            </div>
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
        confirmLabel={tRouters('deleteRouter')}
        loading={deleteM.isPending}
      />
      <ConfirmDialog
        open={confirm === 'deletePermanent'}
        onClose={() => setConfirm(null)}
        onConfirm={doConfirm}
        title={tRouters('deletePermanentConfirmTitle')}
        message={tRouters('deletePermanentConfirmMessage')}
        confirmLabel={tRouters('deletePermanent')}
        loading={deletePermM.isPending}
      />
    </div>
  );
}