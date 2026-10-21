'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/page';
import { LoadingState } from '@/components/ui/states';
import {
  useIssueOnboardingToken,
  useOnboardingToken,
  useProvisionDirect,
  useSites,
} from '@/lib/queries';
import { useSocketRoom } from '@/lib/socket';
import { formatDateTime } from '@/lib/format';
import type { OnboardingIssue } from '@/lib/types';

export default function OnboardRouterPage() {
  const t = useTranslations('routers.onboard');
  const tRouters = useTranslations('routers');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const nav = useRouter();

  const sitesQ = useSites();
  const issueM = useIssueOnboardingToken();
  const directM = useProvisionDirect();

  const [mode, setMode] = useState<'tunnel' | 'direct'>('tunnel');
  const [siteId, setSiteId] = useState('');
  const [identity, setIdentity] = useState('');
  const [issue, setIssue] = useState<OnboardingIssue | null>(null);
  const [copied, setCopied] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connectedRouterId, setConnectedRouterId] = useState<string | null>(null);

  // Direct Mode States
  const [directHost, setDirectHost] = useState('');
  const [directPort, setDirectPort] = useState('8728');
  const [directUser, setDirectUser] = useState('admin');
  const [directPass, setDirectPass] = useState('');
  const [directTags, setDirectTags] = useState('');
  const [directError, setDirectError] = useState<string | null>(null);

  // Poll token state so when the router sends the callback, success flips automatically
  const tokenQ = useOnboardingToken(issue?.token ?? null);
  useEffect(() => {
    if (tokenQ.data?.usedAt) {
      setConnected(true);
      if (tokenQ.data.routerId) {
        setConnectedRouterId(tokenQ.data.routerId);
      }
    }
  }, [tokenQ.data?.usedAt, tokenQ.data?.routerId]);

  useSocketRoom('fleet', 'router:status', (p) => {
    if (p.status === 'online') {
      setConnected(true);
      setConnectedRouterId(p.routerId);
    }
  });

  async function generate() {
    if (!siteId || !identity.trim()) return;
    const out = await issueM.mutateAsync({ siteId, identity: identity.trim() });
    setIssue(out);
    setCopied(false);
    setConnected(false);
    setConnectedRouterId(null);
  }

  async function copyCommand() {
    if (!issue) return;
    try {
      await navigator.clipboard.writeText(issue.oneLineCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {}
  }

  async function handleDirectSubmit(e: React.FormEvent) {
    e.preventDefault();
    setDirectError(null);
    if (!directHost.trim() || !directUser.trim()) {
      setDirectError('الرجاء إدخال عنوان الـ IP واسم المستخدم');
      return;
    }
    try {
      const tagsArray = directTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const router = await directM.mutateAsync({
        host: directHost.trim(),
        apiPort: Number(directPort) || 8728,
        username: directUser.trim(),
        password: directPass,
        siteId: siteId || undefined,
        identityName: identity.trim() || undefined,
        tags: tagsArray,
      });
      nav.push(`/routers/${router.id}`);
    } catch (err) {
      setDirectError((err as Error).message || 'فشل الاتصال بالراوتر');
    }
  }

  if (sitesQ.isLoading) return <LoadingState />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Link href="/routers">
            <Button variant="outline">← {tCommon('back')}</Button>
          </Link>
        }
      />

      {/* Mode Switcher */}
      <div className="flex gap-2 rounded-xl bg-slate-900/60 p-1.5 border border-slate-800 w-fit">
        <button
          onClick={() => setMode('tunnel')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
            mode === 'tunnel'
              ? 'bg-emerald-500 text-slate-950 shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
        >
          <span>🌐</span>
          {tRouters('tunnelOnboard')} (مُوصى به)
        </button>
        <button
          onClick={() => setMode('direct')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
            mode === 'direct'
              ? 'bg-emerald-500 text-slate-950 shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
        >
          <span>🔌</span>
          {tRouters('directOnboard')} (IP مباشر)
        </button>
      </div>

      {mode === 'tunnel' ? (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Step 1: Configuration */}
          <Card className={`border-slate-800 bg-slate-900/40 ${!issue ? 'border-emerald-500/40 ring-1 ring-emerald-500/20' : ''}`}>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 text-sm font-bold text-emerald-300">
                  1
                </span>
                {t('step1')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4">
                <Field label={tCommon('selectSite')}>
                  <Select
                    value={siteId}
                    onChange={(e) => setSiteId(e.target.value)}
                    className="bg-slate-950 border-slate-700"
                  >
                    <option value="">{tCommon('selectSite')}…</option>
                    {(sitesQ.data ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('identityLabel')} hint={t('identityHint')}>
                  <Input
                    value={identity}
                    onChange={(e) => setIdentity(e.target.value)}
                    placeholder="cafe-branch-01"
                    dir="ltr"
                    className="bg-slate-950 border-slate-700 font-mono"
                  />
                </Field>
                <Button
                  onClick={generate}
                  disabled={!siteId || !identity.trim() || issueM.isPending}
                  className="bg-emerald-500 text-slate-950 font-bold hover:bg-emerald-400"
                  size="lg"
                >
                  {issueM.isPending ? t('generating') : t('generate')}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Step 2: Command Exec */}
          <Card className={`border-slate-800 bg-slate-900/40 ${issue && !connected ? 'border-emerald-500/40 ring-1 ring-emerald-500/20' : ''}`}>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 text-sm font-bold text-emerald-300">
                  2
                </span>
                {t('step2')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {issue ? (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span className="font-semibold text-emerald-400">{t('commandLabel')}</span>
                    {issue.tunnelIp && (
                      <span className="font-mono text-[11px] text-slate-500">
                        IP النفق المخصص: <strong className="text-slate-300">{issue.tunnelIp}</strong>
                      </span>
                    )}
                  </div>
                  <div
                    dir="ltr"
                    className="max-h-48 overflow-auto rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs leading-relaxed text-emerald-200 select-all"
                  >
                    {issue.oneLineCommand}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={copyCommand}
                      className="flex-1 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
                    >
                      {copied ? '✓ تم النسخ إلى الحافظة' : '📋 نسخ أمر التجهيز'}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setIssue(null);
                        setConnected(false);
                      }}
                      className="text-xs text-slate-400 hover:text-slate-200"
                    >
                      {t('newToken')}
                    </Button>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {t('commandHint')} · {t('expiresAt')}: {formatDateTime(issue.expiresAt, locale)}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-slate-600 text-sm text-center">
                  <span className="text-3xl mb-2 opacity-40">⚙️</span>
                  <span>أكمل الخطوة الأولى لتوليد أمر الإعداد الخاص بهذا الراوتر</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Step 3: Real-time Handshake & Pipeline Status */}
          <Card className={`border-slate-800 bg-slate-900/40 ${connected ? 'border-emerald-500/40 bg-emerald-950/10' : ''}`}>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 text-sm font-bold text-emerald-300">
                  3
                </span>
                {t('step3')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {issue ? (
                <div className="flex flex-col gap-4">
                  {/* Visual pipeline steps */}
                  <div className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-xs">
                    <div className="flex items-center gap-2 text-emerald-400">
                      <span>✓</span>
                      <span>توليد رمز المصادقة وبيانات النفق</span>
                    </div>
                    <div className="flex items-center gap-2 text-emerald-400">
                      <span>✓</span>
                      <span>تجهيز حساب الـ SSTP على سيرفر الـ Hub</span>
                    </div>
                    <div className={`flex items-center gap-2 ${connected ? 'text-emerald-400' : 'text-amber-400 animate-pulse'}`}>
                      <span>{connected ? '✓' : '⟳'}</span>
                      <span>{connected ? 'تم اتصال نفق الـ SSTP بنجاح' : 'بانتظار تنفيذ الأمر واتصال الراوتر…'}</span>
                    </div>
                    <div className={`flex items-center gap-2 ${connected ? 'text-emerald-400' : 'text-slate-600'}`}>
                      <span>{connected ? '✓' : '○'}</span>
                      <span>تثبيت هوية النظام والـ UUID</span>
                    </div>
                    <div className={`flex items-center gap-2 ${connected ? 'text-emerald-400' : 'text-slate-600'}`}>
                      <span>{connected ? '✓' : '○'}</span>
                      <span>سحب المواصفات المبدئية وحالة التشغيل</span>
                    </div>
                  </div>

                  {connected ? (
                    <div className="flex flex-col gap-3">
                      <div className="rounded-xl bg-emerald-500/15 border border-emerald-500/30 p-4 text-emerald-300 text-sm font-semibold flex items-center gap-2">
                        <span>🎉</span>
                        <span>{t('success')}</span>
                      </div>
                      <Link href={connectedRouterId ? `/routers/${connectedRouterId}` : '/routers'}>
                        <Button className="w-full bg-emerald-500 text-slate-950 font-bold hover:bg-emerald-400" size="lg">
                          {t('viewRouter')} ←
                        </Button>
                      </Link>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center gap-3 py-6 text-sm text-amber-300 bg-amber-500/5 rounded-xl border border-amber-500/20">
                      <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-amber-400" />
                      <span>{t('waiting')}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-slate-600 text-sm text-center">
                  <span className="text-3xl mb-2 opacity-40">📡</span>
                  <span>ستظهر مؤشرات الاتصال الحية بعد توليد الأمر</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        /* Direct IP Mode Form */
        <Card className="max-w-2xl border-slate-800 bg-slate-900/40">
          <CardHeader>
            <CardTitle>إضافة راوتر مباشرة عبر عنوان الـ IP</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleDirectSubmit} className="flex flex-col gap-4">
              <p className="text-xs text-slate-400 leading-relaxed">
                استخدم هذا الخيار للراوترات التي تمتلك عنوان IP عام أو موجودة على نفس الشبكة المحلية ويمكن الوصول إلى منفذ الـ API الخاص بها (افتراضيًا 8728).
              </p>

              {directError && (
                <div className="rounded-xl bg-rose-500/15 border border-rose-500/30 p-3 text-sm text-rose-300">
                  {directError}
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="عنوان الـ IP أو النطاق *">
                  <Input
                    value={directHost}
                    onChange={(e) => setDirectHost(e.target.value)}
                    placeholder="34.12.242.142 أو 192.168.88.1"
                    dir="ltr"
                    required
                    className="bg-slate-950 border-slate-700 font-mono"
                  />
                </Field>
                <Field label="منفذ API">
                  <Input
                    type="number"
                    value={directPort}
                    onChange={(e) => setDirectPort(e.target.value)}
                    placeholder="8728"
                    dir="ltr"
                    className="bg-slate-950 border-slate-700 font-mono"
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="اسم مستخدم الـ API *">
                  <Input
                    value={directUser}
                    onChange={(e) => setDirectUser(e.target.value)}
                    placeholder="admin"
                    dir="ltr"
                    required
                    className="bg-slate-950 border-slate-700 font-mono"
                  />
                </Field>
                <Field label="كلمة المرور">
                  <Input
                    type="password"
                    value={directPass}
                    onChange={(e) => setDirectPass(e.target.value)}
                    placeholder="••••••••"
                    dir="ltr"
                    className="bg-slate-950 border-slate-700 font-mono"
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={tCommon('selectSite')}>
                  <Select
                    value={siteId}
                    onChange={(e) => setSiteId(e.target.value)}
                    className="bg-slate-950 border-slate-700"
                  >
                    <option value="">{tCommon('selectSite')}…</option>
                    {(sitesQ.data ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="اسم الراوتر (الهوية)">
                  <Input
                    value={identity}
                    onChange={(e) => setIdentity(e.target.value)}
                    placeholder="branch-router-01"
                    dir="ltr"
                    className="bg-slate-950 border-slate-700 font-mono"
                  />
                </Field>
              </div>

              <Field label="الوسوم (مفصولة بفواصل)" hint="مثال: vip, alexandria, core">
                <Input
                  value={directTags}
                  onChange={(e) => setDirectTags(e.target.value)}
                  placeholder="vip, cairo, mikrotik"
                  className="bg-slate-950 border-slate-700"
                />
              </Field>

              <div className="pt-2 flex justify-end gap-3">
                <Link href="/routers">
                  <Button variant="outline" type="button">
                    {tCommon('cancel')}
                  </Button>
                </Link>
                <Button
                  type="submit"
                  disabled={directM.isPending}
                  className="bg-emerald-500 text-slate-950 font-bold hover:bg-emerald-400"
                >
                  {directM.isPending ? 'جارٍ فحص الاتصال والإضافة…' : 'فحص وإضافة الراوتر ←'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}