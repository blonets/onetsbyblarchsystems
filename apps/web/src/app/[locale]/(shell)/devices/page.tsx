'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/page';
import { EmptyState, QueryState } from '@/components/ui/states';
import { Table, TBody, THead, Th, Tr, Td, Mono } from '@/components/ui/table';
import { RouterSelect, useRouterPicker } from '@/components/router-picker';
import {
  useDisableRemoteAccess,
  useDiscoveredDevices,
  useDownstreamDevices,
  useEnableRemoteAccess,
  useRescanDevices,
  useRouters,
} from '@/lib/queries';
import type { DownstreamDevice, DownstreamKind, ProxyAllocation } from '@/lib/types';

const kinds: readonly DownstreamKind[] = ['mikrotik', 'camera', 'ap', 'pos', 'switch', 'other'];
const servicePortHints: Record<DownstreamKind, number> = { mikrotik: 8728, camera: 80, ap: 80, pos: 9100, switch: 22, other: 22 };

export default function DevicesPage() {
  const t = useTranslations('devices');
  const tCommon = useTranslations('common');
  const { routers, selected, setSelected, isLoading } = useRouterPicker();
  const routersQ = useRouters();

  const discoveredQ = useDiscoveredDevices(selected, !!selected);
  const rescanM = useRescanDevices(selected);
  const devicesQ = useDownstreamDevices(selected || undefined);
  const enableM = useEnableRemoteAccess(selected);
  const disableM = useDisableRemoteAccess(selected);

  const [enabling, setEnabling] = useState<{ ipAddress: string; identity?: string } | null>(null);
  const [disabling, setDisabling] = useState<DownstreamDevice | null>(null);
  const [allocation, setAllocation] = useState<ProxyAllocation | null>(null);
  const [form, setForm] = useState({ label: '', kind: 'mikrotik' as DownstreamKind, servicePort: 8728 });

  const discovered = discoveredQ.data ?? [];
  const devices = devicesQ.data ?? [];
  const tunnelIp = routersQ.data?.find((r) => r.id === selected)?.tunnelIp;

  async function doEnable() {
    if (!enabling) return;
    const out = await enableM.mutateAsync({
      ipAddress: enabling.ipAddress,
      label: form.label || enabling.identity || enabling.ipAddress,
      kind: form.kind,
      servicePort: form.servicePort,
    });
    setAllocation(out);
    setEnabling(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={<RouterSelect routers={routers} selected={selected} onChange={setSelected} />}
      />

      {allocation && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
          <p className="text-sm font-medium text-emerald-300">✓ {t('enabled')}</p>
          <p className="mt-2 font-mono text-lg text-emerald-200" dir="ltr">
            {allocation.tunnelIp}:{allocation.proxyPort}
          </p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => setAllocation(null)}>
            {tCommon('close')}
          </Button>
        </div>
      )}

      {!selected || isLoading ? (
        <Card><CardContent className="py-12 text-center text-sm text-slate-400">{tCommon('loading')}</CardContent></Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                {t('discovered')}
                <Button size="sm" variant="outline" onClick={() => rescanM.mutate()} disabled={rescanM.isPending}>
                  {rescanM.isPending ? t('rescanning') : t('rescan')}
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <QueryState
                isLoading={discoveredQ.isLoading} isError={discoveredQ.isError} error={discoveredQ.error} refetch={() => discoveredQ.refetch()}
                isEmpty={discovered.length === 0}
                empty={<EmptyState title={t('noDiscovered')} hint={t('noDiscoveredHint')} />}
              >
                <Table>
                  <THead>
                    <Th>{t('label')}</Th><Th>{t('ipAddress')}</Th><Th>{t('mac')}</Th><Th>{t('iface')}</Th><Th>{tCommon('actions')}</Th>
                  </THead>
                  <TBody>
                    {discovered.map((d) => {
                      const managed = devices.some((x) => x.lanIp === d.ipAddress);
                      return (
                        <Tr key={d.mac} className={managed ? 'opacity-55' : undefined}>
                          <Td className="font-medium">{d.identity ?? '—'}</Td>
                          <Td><Mono dir="ltr">{d.ipAddress}</Mono></Td>
                          <Td><Mono dir="ltr" className="text-xs">{d.mac}</Mono></Td>
                          <Td><Mono>{d.iface ?? '—'}</Mono></Td>
                          <Td>
                            <Button
                              size="sm" variant="outline" disabled={managed}
                              onClick={() => {
                                setForm({ label: d.identity ?? '', kind: 'mikrotik', servicePort: 8728 });
                                setEnabling({ ipAddress: d.ipAddress, identity: d.identity });
                              }}
                            >
                              {t('enableAccess')}
                            </Button>
                          </Td>
                        </Tr>
                      );
                    })}
                  </TBody>
                </Table>
              </QueryState>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>{t('managed')}</CardTitle></CardHeader>
            <CardContent>
              {devices.length === 0 ? (
                <EmptyState title={t('noDevices')} hint={t('noDevicesHint')} />
              ) : (
                <Table>
                  <THead>
                    <Th>{t('label')}</Th><Th>{t('kind')}</Th><Th>{t('endpoint')}</Th><Th>{t('proxyPort')}</Th><Th>{tCommon('actions')}</Th>
                  </THead>
                  <TBody>
                    {devices.map((d) => (
                      <Tr key={d.id}>
                        <Td>
                          <p className="font-medium">{d.name}</p>
                          <p className="font-mono text-[11px] text-slate-500" dir="ltr">{d.lanIp}</p>
                        </Td>
                        <Td className="text-slate-400">{t(`kinds.${d.kind}`)}</Td>
                        <Td>
                          <Mono dir="ltr" className="text-emerald-300">{tunnelIp ?? '…'}:{d.proxyPort}</Mono>
                          <p className="mt-0.5 text-[11px] text-slate-500" dir="ltr">
                            → {d.lanIp}:{d.mgmtPort}
                          </p>
                        </Td>
                        <Td><Mono>{d.proxyPort ?? '—'}</Mono></Td>
                        <Td>
                          <Button size="sm" variant="ghost" className="text-red-300" onClick={() => setDisabling(d)}>
                            {t('disable')}
                          </Button>
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

      <Dialog open={enabling !== null} onClose={() => setEnabling(null)} title={t('enableTitle')}>
        <div className="flex flex-col gap-4">
          <p className="text-xs text-slate-500">{t('enableHint')}</p>
          <Field label={t('ipAddress')}><Input value={enabling?.ipAddress ?? ''} disabled dir="ltr" /></Field>
          <Field label={t('label')}>
            <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('kind')}>
              <Select
                value={form.kind}
                onChange={(e) => {
                  const kind = e.target.value as DownstreamKind;
                  setForm({ ...form, kind, servicePort: servicePortHints[kind] });
                }}
              >
                {kinds.map((k) => (
                  <option key={k} value={k}>{t(`kinds.${k}`)}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('servicePort')} hint={t('servicePortHint')}>
              <Input type="number" dir="ltr" value={form.servicePort} onChange={(e) => setForm({ ...form, servicePort: Number(e.target.value) })} />
            </Field>
          </div>
          <Button size="lg" onClick={doEnable} disabled={enableM.isPending}>
            {enableM.isPending ? t('enabling') : t('enable')}
          </Button>
        </div>
      </Dialog>

      <ConfirmDialog
        open={disabling !== null}
        onClose={() => setDisabling(null)}
        onConfirm={async () => { if (disabling) await disableM.mutateAsync(disabling.id); setDisabling(null); }}
        title={t('disableTitle')}
        message={t('disableMessage')}
        confirmLabel={t('disable')}
        loading={disableM.isPending}
      />
    </div>
  );
}
