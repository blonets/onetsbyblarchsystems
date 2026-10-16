'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/form';
import { PageHeader, Tabs } from '@/components/ui/page';
import { EmptyState, QueryState } from '@/components/ui/states';
import { Table, TBody, THead, Th, Tr, Td, Mono } from '@/components/ui/table';
import { RouterSelect, useRouterPicker } from '@/components/router-picker';
import { queueTreeApi, simpleQueuesApi } from '@/lib/queries';
import { useAuth } from '@/lib/auth';
import type { QueueInput } from '@/lib/api-client';
import type { QueueItem } from '@/lib/types';

type TabKey = 'simple' | 'tree';

function QueueTab({
  routerId, canEdit, api, tree,
}: {
  routerId: string;
  canEdit: boolean;
  api: typeof simpleQueuesApi;
  tree: boolean;
}) {
  const t = useTranslations('queues');
  const tCommon = useTranslations('common');
  const q = api.useList(routerId);
  const createM = api.useCreate(routerId);
  const updateM = api.useUpdate(routerId);
  const deleteM = api.useDelete(routerId);

  const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'edit'; row: QueueItem } | null>(null);
  const [deleting, setDeleting] = useState<QueueItem | null>(null);
  const [form, setForm] = useState<QueueInput>({ name: '', target: '' });
  const F = (k: keyof QueueInput) => ({
    value: (form[k] as string | undefined) ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: k === 'name' || k === 'target' ? e.target.value : (e.target.value || undefined) })),
  });

  const rows = q.data ?? [];
  return (
    <div className="flex flex-col gap-4">
      {canEdit && (
        <div>
          <Button onClick={() => { setForm({ name: '', target: '' }); setDialog({ mode: 'create' }); }}>
            + {t('add')}
          </Button>
        </div>
      )}
      <QueryState
        isLoading={q.isLoading} isError={q.isError} error={q.error} refetch={() => q.refetch()}
        isEmpty={rows.length === 0}
        empty={<EmptyState title={t('empty')} hint={t('emptyHint')} />}
      >
        <Table>
          <THead>
            <Th>{t('name')}</Th><Th>{t('target')}</Th><Th>{t('maxLimit')}</Th>
            <Th>{t('limitAt')}</Th><Th>{t('priority')}</Th><Th>{tCommon('status')}</Th>
            {canEdit && <Th>{tCommon('actions')}</Th>}
          </THead>
          <TBody>
            {rows.map((x) => (
              <Tr key={x.id} className={x.disabled ? 'opacity-55' : undefined}>
                <Td><Mono>{x.name}</Mono></Td>
                <Td><Mono dir="ltr">{x.target}</Mono></Td>
                <Td><Mono dir="ltr">{x.maxLimit ?? '—'}</Mono></Td>
                <Td><Mono dir="ltr">{x.limitAt ?? '—'}</Mono></Td>
                <Td className="tabular-nums">{x.priority ?? '—'}</Td>
                <Td><span className="text-xs text-slate-400">{x.disabled ? tCommon('disabled') : tCommon('enabled')}</span></Td>
                {canEdit && (
                  <Td>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setForm({ name: x.name, target: x.target ?? '', maxLimit: x.maxLimit ?? undefined, limitAt: x.limitAt ?? undefined, priority: x.priority != null ? String(x.priority) : undefined }); setDialog({ mode: 'edit', row: x }); }}>
                        {tCommon('edit')}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-red-300" onClick={() => setDeleting(x)}>
                        {tCommon('delete')}
                      </Button>
                    </div>
                  </Td>
                )}
              </Tr>
            ))}
          </TBody>
        </Table>
      </QueryState>

      <Dialog open={dialog !== null} onClose={() => setDialog(null)} title={dialog?.mode === 'edit' ? t('edit') : t('add')} wide>
        <form
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (dialog?.mode === 'edit') await updateM.mutateAsync({ id: dialog.row.id, input: form });
            else await createM.mutateAsync(form);
            setDialog(null);
          }}
        >
          <Field label={t('name')}><Input {...F('name')} required dir="ltr" /></Field>
          <Field label={t('target')}><Input {...F('target')} required dir="ltr" placeholder="192.168.88.0/24" /></Field>
          <Field label={t('maxLimit')}><Input {...F('maxLimit')} dir="ltr" placeholder="10M/10M" /></Field>
          <Field label={t('limitAt')}><Input {...F('limitAt')} dir="ltr" placeholder="5M/5M" /></Field>
          <Field label={t('priority')}><Input {...F('priority')} dir="ltr" type="number" min={1} max={8} /></Field>
          {tree && <Field label={t('parent')}><Input {...F('parent')} dir="ltr" placeholder="global" /></Field>}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={createM.isPending || updateM.isPending || !(form.name ?? '').trim() || !(form.target ?? '').trim()}>{tCommon('save')}</Button>
          </div>
        </form>
      </Dialog>
      <ConfirmDialog
        open={deleting !== null} onClose={() => setDeleting(null)}
        onConfirm={async () => { if (deleting) await deleteM.mutateAsync(deleting.id); setDeleting(null); }}
        title={t('deleteTitle')} message={t('deleteMessage')} confirmLabel={tCommon('delete')}
      />
    </div>
  );
}

export default function QueuesPage() {
  const t = useTranslations('queues');
  const tCommon = useTranslations('common');
  const { routers, selected, setSelected, isLoading } = useRouterPicker();
  const { canEditNetwork } = useAuth();
  const [tab, setTab] = useState<TabKey>('simple');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={<RouterSelect routers={routers} selected={selected} onChange={setSelected} />}
      />
      {!selected || isLoading ? (
        <Card><CardContent className="py-12 text-center text-sm text-slate-400">{tCommon('loading')}</CardContent></Card>
      ) : (
        <>
          <Tabs
            tabs={[
              { key: 'simple', label: t('simple') },
              { key: 'tree', label: t('tree') },
            ]}
            active={tab}
            onChange={setTab}
          />
          {tab === 'simple'
            ? <QueueTab routerId={selected} canEdit={canEditNetwork} api={simpleQueuesApi} tree={false} />
            : <QueueTab routerId={selected} canEdit={canEditNetwork} api={queueTreeApi} tree />}
        </>
      )}
    </div>
  );
}
