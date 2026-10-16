'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/page';
import { EmptyState, QueryState } from '@/components/ui/states';
import { Table, TBody, THead, Th, Tr, Td, Mono } from '@/components/ui/table';
import {
  useBackupPolicy,
  useBackups,
  useRestoreBackup,
  useRouters,
  useTriggerBackup,
} from '@/lib/queries';
import { formatBytes, formatDateTime } from '@/lib/format';
import type { BackupRecord } from '@/lib/types';

export default function BackupsPage() {
  const t = useTranslations('backups');
  const tCommon = useTranslations('common');
  const locale = useLocale();

  const routersQ = useRouters();
  const [routerId, setRouterId] = useState('');

  const backupsQ = useBackups(routerId || undefined);
  const policyQ = useBackupPolicy();
  const triggerM = useTriggerBackup();
  const restoreM = useRestoreBackup();

  const [restoring, setRestoring] = useState<BackupRecord | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const routerName = (id: string) => routersQ.data?.find((r) => r.id === id)?.identityName ?? id;
  const backups = backupsQ.data ?? [];

  async function doRestore() {
    if (!restoring) return;
    try {
      const out = await restoreM.mutateAsync(restoring.id);
      setNotice(out.message || t('restored'));
    } finally {
      setRestoring(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <div className="flex gap-2">
            <Select value={routerId} onChange={(e) => setRouterId(e.target.value)} className="w-56">
              <option value="">{t('allRouters')}</option>
              {(routersQ.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>{r.identityName}</option>
              ))}
            </Select>
            <Button
              disabled={!routerId || triggerM.isPending}
              onClick={async () => {
                await triggerM.mutateAsync(routerId);
                setNotice(t('triggered'));
              }}
            >
              {triggerM.isPending ? t('triggering') : t('trigger')}
            </Button>
          </div>
        }
      />

      {notice && (
        <p className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{notice}</p>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {[
          { label: t('retention'), value: policyQ.data ? t('retentionValue', { days: policyQ.data.retentionDays }) : '—' },
          { label: t('schedule'), value: policyQ.data?.schedule ?? '—' },
          { label: t('encrypted'), value: policyQ.data?.encrypted ? '✓ AES-256-GCM' : '—' },
        ].map((c) => (
          <Card key={c.label}>
            <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-slate-400">{c.label}</CardTitle></CardHeader>
            <CardContent><p className="text-sm font-semibold">{c.value}</p></CardContent>
          </Card>
        ))}
      </div>

      <QueryState
        isLoading={backupsQ.isLoading} isError={backupsQ.isError} error={backupsQ.error} refetch={() => backupsQ.refetch()}
        isEmpty={backups.length === 0}
        empty={<EmptyState title={t('empty')} hint={t('emptyHint')} />}
      >
        <Card>
          <CardContent className="pt-6">
            <Table>
              <THead>
                <Th>{t('fileName')}</Th><Th>{t('router')}</Th><Th>{t('type')}</Th>
                <Th>{t('size')}</Th><Th>{t('date')}</Th><Th>{tCommon('actions')}</Th>
              </THead>
              <TBody>
                {backups.map((b) => (
                  <Tr key={b.id}>
                    <Td><Mono className="text-xs">{b.fileName}</Mono></Td>
                    <Td><Mono>{routerName(b.routerId)}</Mono></Td>
                    <Td>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${b.type === 'binary' ? 'bg-sky-500/15 text-sky-300' : 'bg-violet-500/15 text-violet-300'}`}>
                        {b.type === 'binary' ? t('binary') : t('export')}
                      </span>
                    </Td>
                    <Td className="tabular-nums text-slate-400">{formatBytes(Number(b.sizeBytes))}</Td>
                    <Td className="whitespace-nowrap text-slate-400">{formatDateTime(b.createdAt, locale)}</Td>
                    <Td>
                      <Button size="sm" variant="outline" onClick={() => setRestoring(b)}>
                        {t('restore')}
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </QueryState>

      <ConfirmDialog
        open={restoring !== null}
        onClose={() => setRestoring(null)}
        onConfirm={doRestore}
        title={t('restoreTitle')}
        message={t('restoreMessage')}
        confirmLabel={t('restoreConfirm')}
        loading={restoreM.isPending}
      />
    </div>
  );
}
