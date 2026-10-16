'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { PageHeader } from '@/components/ui/page';
import { EmptyState } from '@/components/ui/states';
import { Mono } from '@/components/ui/table';
import { RouterSelect, useRouterPicker } from '@/components/router-picker';
import {
  useApplySetupWizard,
  usePreviewSetupWizard,
  useSetupWizardStatus,
} from '@/lib/queries';
import type { WizardPreviewRequest } from '@/lib/api-client';
import type { WizardConfig, WizardPreview, WizardStepKey } from '@/lib/types';

const steps: WizardStepKey[] = ['pool', 'dhcp', 'nat', 'walledGarden', 'dns', 'hotspot', 'review'];

const defaultConfig: WizardConfig = {
  poolName: 'hotspot-pool',
  poolRange: '192.168.88.10-192.168.88.250',
  dhcpInterface: 'bridge-hotspot',
  leaseTime: '1h',
  wanInterface: 'ether1-WAN',
  walledGardenHosts: '*.whatsapp.com\n*.facebook.com',
  dnsServers: '8.8.8.8, 1.1.1.1',
  allowRemoteRequests: true,
  hotspotInterface: 'bridge-hotspot',
  hotspotProfile: 'cafe-default',
  hotspotDnsName: 'login.cafe.local',
};

function Stepper({ step, setStep, t }: {
  step: WizardStepKey;
  setStep: (s: WizardStepKey) => void;
  t: (k: string) => string;
}) {
  const idx = steps.indexOf(step);
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => i < idx && setStep(s)}
            disabled={i >= idx}
            className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${
              s === step
                ? 'bg-emerald-500/20 text-emerald-300'
                : i < idx
                  ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  : 'bg-slate-800/40 text-slate-500'
            }`}
          >
            <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
              i < idx ? 'bg-emerald-500 text-slate-950' : 'bg-slate-700 text-slate-300'
            }`}>
              {i < idx ? '✓' : i + 1}
            </span>
            {t(`steps.${s}`)}
          </button>
          {i < steps.length - 1 && <span className="text-slate-700">←</span>}
        </li>
      ))}
    </ol>
  );
}

export default function ProvisioningPage() {
  const t = useTranslations('provisioning');
  const tw = useTranslations('provisioning.wizard');
  const tCommon = useTranslations('common');
  const { routers, selected, setSelected, isLoading } = useRouterPicker();

  const [step, setStep] = useState<WizardStepKey>('pool');
  const [config, setConfig] = useState<WizardConfig>(defaultConfig);
  const [preview, setPreview] = useState<WizardPreview | null>(null);
  const [opId, setOpId] = useState<string | null>(null);

  const previewM = usePreviewSetupWizard(selected);
  const applyM = useApplySetupWizard(selected);
  const statusQ = useSetupWizardStatus(selected, opId);

  const upd = <K extends keyof WizardConfig>(k: K, v: WizardConfig[K]) =>
    setConfig((c) => ({ ...c, [k]: v }));

  const routerName = routers.find((r) => r.id === selected)?.identityName ?? selected;

  const grouped = useMemo(() => {
    const g = new Map<WizardPreview['sentences'][number]['step'], string[]>();
    for (const s of preview?.sentences ?? []) {
      const arr = g.get(s.step) ?? [];
      arr.push(s.text);
      g.set(s.step, arr);
    }
    return [...g.entries()];
  }, [preview]);

  const doPreview = async () => {
    const req: WizardPreviewRequest = { ...config };
    const p = await previewM.mutateAsync(req);
    setPreview(p);
  };

  const doApply = async () => {
    if (!preview) return;
    const { opId: id } = await applyM.mutateAsync(preview.opId);
    setOpId(id);
  };

  const reset = () => {
    setPreview(null);
    setOpId(null);
    setStep('pool');
    previewM.reset();
    applyM.reset();
  };

  const status = statusQ.data;
  const running = opId !== null && status && status.status !== 'done' && status.status !== 'failed';
  const done = status?.status === 'done';

  const next = () => setStep(steps[Math.min(steps.length - 1, steps.indexOf(step) + 1)]);
  const back = () => setStep(steps[Math.max(0, steps.indexOf(step) - 1)]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={<RouterSelect routers={routers} selected={selected} onChange={setSelected} />}
      />

      {isLoading || !selected ? (
        <EmptyState title={tCommon('selectRouter')} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{tw('title')}</CardTitle>
            <p className="text-xs text-slate-500">
              {tw('subtitle')} · <Mono>{routerName}</Mono>
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <Stepper step={step} setStep={(s) => { setStep(s); setPreview(null); }} t={tw} />

            {/* ---- step forms ---- */}
            {step === 'pool' && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={tw('poolName')}><Input value={config.poolName} onChange={(e) => upd('poolName', e.target.value)} dir="ltr" required /></Field>
                <Field label={tw('poolRange')}><Input value={config.poolRange} onChange={(e) => upd('poolRange', e.target.value)} dir="ltr" required placeholder="192.168.88.10-192.168.88.250" /></Field>
              </div>
            )}
            {step === 'dhcp' && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={tw('dhcpInterface')}><Input value={config.dhcpInterface} onChange={(e) => upd('dhcpInterface', e.target.value)} dir="ltr" required /></Field>
                <Field label={tw('leaseTime')}><Input value={config.leaseTime} onChange={(e) => upd('leaseTime', e.target.value)} dir="ltr" required placeholder="1h" /></Field>
              </div>
            )}
            {step === 'nat' && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={tw('wanInterface')}><Input value={config.wanInterface} onChange={(e) => upd('wanInterface', e.target.value)} dir="ltr" required /></Field>
              </div>
            )}
            {step === 'walledGarden' && (
              <Field label={tw('walledGardenHosts')} hint={tw('walledGardenHint')}>
                <Textarea rows={4} value={config.walledGardenHosts} onChange={(e) => upd('walledGardenHosts', e.target.value)} dir="ltr" className="font-mono text-[13px]" />
              </Field>
            )}
            {step === 'dns' && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={tw('dnsServers')} className="sm:col-span-2">
                  <Input value={config.dnsServers} onChange={(e) => upd('dnsServers', e.target.value)} dir="ltr" required placeholder="8.8.8.8, 1.1.1.1" />
                </Field>
                <Field label={tw('allowRemoteRequests')}>
                  <div className="flex items-center gap-3 pt-2">
                    <Switch checked={config.allowRemoteRequests} onChange={(v) => upd('allowRemoteRequests', v)} label={tw('allowRemoteRequests')} />
                  </div>
                </Field>
              </div>
            )}
            {step === 'hotspot' && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={tw('hotspotInterface')}><Input value={config.hotspotInterface} onChange={(e) => upd('hotspotInterface', e.target.value)} dir="ltr" required /></Field>
                <Field label={tw('hotspotProfile')}><Input value={config.hotspotProfile} onChange={(e) => upd('hotspotProfile', e.target.value)} dir="ltr" required /></Field>
                <Field label={tw('hotspotDnsName')} className="sm:col-span-2"><Input value={config.hotspotDnsName} onChange={(e) => upd('hotspotDnsName', e.target.value)} dir="ltr" required /></Field>
              </div>
            )}

            {/* ---- review: preview grouped by step ---- */}
            {step === 'review' && (
              <div className="flex flex-col gap-4">
                {!preview ? (
                  <div>
                    <Button onClick={doPreview} disabled={previewM.isPending} size="lg">
                      {previewM.isPending ? tw('previewing') : tw('preview')}
                    </Button>
                    {previewM.isError && <p className="mt-2 text-sm text-red-300">{tCommon('error')}</p>}
                  </div>
                ) : (
                  <>
                    {grouped.length === 0 && <p className="text-sm text-slate-400">{tw('noSentences')}</p>}
                    {grouped.map(([stepKey, lines]) => (
                      <div key={stepKey} className="rounded-xl border border-slate-700 bg-slate-800/40">
                        <p className="border-b border-slate-700 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-400">
                          {tw(`steps.${stepKey}`)}
                        </p>
                        <ul className="flex flex-col gap-1 p-4">
                          {lines.map((line, i) => (
                            <li key={i} dir="ltr" className="text-start">
                              <code className="text-[12px] text-emerald-200">{line}</code>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {/* ---- progress ---- */}
            {opId && status && (
              <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
                {done ? (
                  <p className="text-sm font-bold text-emerald-300">✓ {tw('done')}</p>
                ) : status.status === 'failed' ? (
                  <p className="text-sm font-bold text-red-300">✗ {tw('failed')}{status.message ? ` — ${status.message}` : ''}</p>
                ) : (
                  <>
                    <p className="text-sm text-slate-300">{tw('progress')}</p>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-700">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all"
                        style={{ width: `${status.totalSteps ? Math.round((status.doneSteps / status.totalSteps) * 100) : 0}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-slate-400">
                      {tw('stepOf', { current: status.doneSteps, total: status.totalSteps })}
                      {status.currentStep && steps.includes(status.currentStep as WizardStepKey)
                        ? ` · ${tw(`steps.${status.currentStep}`)}`
                        : ''}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-slate-500" dir="ltr">{status.opId}</p>
                  </>
                )}
              </div>
            )}

            {/* ---- nav buttons ---- */}
            <div className="flex items-center justify-between border-t border-slate-800 pt-4">
              <Button variant="outline" onClick={back} disabled={step === 'pool' || running}>
                {tCommon('back')}
              </Button>
              {done ? (
                <Button onClick={reset}>{tCommon('refresh')}</Button>
              ) : step === 'review' && preview && !opId ? (
                <Button onClick={doApply} disabled={applyM.isPending} size="lg">
                  {applyM.isPending ? tw('applying') : tw('confirmApply')}
                </Button>
              ) : step !== 'review' ? (
                <Button onClick={next}>{tCommon('next')}</Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
