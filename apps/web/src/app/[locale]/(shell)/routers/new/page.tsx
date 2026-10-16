'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/page';
import { LoadingState } from '@/components/ui/states';
import { useIssueOnboardingToken, useOnboardingToken, useSites } from '@/lib/queries';
import { useSocketRoom } from '@/lib/socket';
import { formatDateTime } from '@/lib/format';
import type { OnboardingIssue } from '@/lib/types';

const steps = ['step1', 'step2', 'step3'] as const;

export default function OnboardRouterPage() {
  const t = useTranslations('routers.onboard');
  const tCommon = useTranslations('common');
  const locale = useLocale();

  const sitesQ = useSites();
  const issueM = useIssueOnboardingToken();
  const [siteId, setSiteId] = useState('');
  const [identity, setIdentity] = useState('');
  const [issue, setIssue] = useState<OnboardingIssue | null>(null);
  const [copied, setCopied] = useState(false);
  const [connected, setConnected] = useState(false);

  // Poll token state so when the router sends the callback, success flips automatically
  const tokenQ = useOnboardingToken(issue?.token ?? null);
  useEffect(() => {
    if (tokenQ.data?.usedAt) {
      setConnected(true);
    }
  }, [tokenQ.data?.usedAt]);

  // Listen for the new router coming online (mock: any router:status online
  // flips the waiting state — production: token-bound room).
  useSocketRoom('fleet', 'router:status', (p) => {
    if (p.status === 'online') setConnected(true);
  });

  async function generate() {
    if (!siteId || !identity.trim()) return;
    const out = await issueM.mutateAsync({ siteId, identity: identity.trim() });
    setIssue(out);
    setCopied(false);
    setConnected(false);
  }

  async function copyCommand() {
    if (!issue) return;
    try {
      await navigator.clipboard.writeText(issue.oneLineCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard unavailable — user can select manually */
    }
  }

  if (sitesQ.isLoading) return <LoadingState />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <div className="grid gap-4 lg:grid-cols-3">
        {steps.map((s, i) => (
          <Card key={s} className={i === 1 && issue ? 'border-emerald-500/40' : undefined}>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/15 text-sm font-bold text-emerald-300">
                  {i + 1}
                </span>
                {t(s)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {i === 0 && (
                <div className="flex flex-col gap-4">
                  <Field label={tCommon('selectSite')}>
                    <Select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
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
                      placeholder="cafe-maadi-01"
                      dir="ltr"
                    />
                  </Field>
                  <Button onClick={generate} disabled={!siteId || !identity.trim() || issueM.isPending} size="lg">
                    {issueM.isPending ? t('generating') : t('generate')}
                  </Button>
                </div>
              )}

              {i === 1 &&
                (issue ? (
                  <div className="flex flex-col gap-3">
                    <p className="text-xs font-medium text-slate-400">{t('commandLabel')}</p>
                    <div
                      dir="ltr"
                      className="max-h-40 overflow-auto rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs leading-relaxed text-emerald-200"
                    >
                      {issue.oneLineCommand}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={copyCommand} className="flex-1">
                        {copied ? tCommon('copied') : tCommon('copy')}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setIssue(null);
                          setConnected(false);
                        }}
                      >
                        {t('newToken')}
                      </Button>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {t('commandHint')} · {t('expiresAt')}: {formatDateTime(issue.expiresAt, locale)}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">—</p>
                ))}

              {i === 2 &&
                (issue ? (
                  connected ? (
                    <div className="flex flex-col gap-3">
                      <p className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-300">
                        ✓ {t('success')}
                      </p>
                      <Link href="/routers">
                        <Button className="w-full">{t('viewRouter')}</Button>
                      </Link>
                    </div>
                  ) : (
                    <p className="flex items-center gap-2 text-sm text-amber-300">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-amber-400" />
                      {t('waiting')}
                    </p>
                  )
                ) : (
                  <p className="text-sm text-slate-500">—</p>
                ))}
            </CardContent>
          </Card>
        ))}
      </div>

      {issue && !connected && (
        <p className="text-center text-xs text-slate-500">{t('waiting')}</p>
      )}
    </div>
  );
}
