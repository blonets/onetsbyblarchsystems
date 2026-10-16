'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/page';
import { EmptyState, QueryState } from '@/components/ui/states';
import { useCreateSite, useDeleteSite, useRouters, useSites, useUpdateSite } from '@/lib/queries';
import { formatDateTime } from '@/lib/format';
import type { Site } from '@mtk/types';
import type { SiteInput } from '@/lib/api-client';

const emptyForm: SiteInput = { name: '' };

function SiteForm({
  initial,
  onSubmit,
  busy,
}: {
  initial: SiteInput;
  onSubmit: (input: SiteInput) => void;
  busy: boolean;
}) {
  const t = useTranslations('sites');
  const tCommon = useTranslations('common');
  const [form, setForm] = useState<SiteInput>(initial);
  const set = (k: keyof SiteInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: k === 'name' ? e.target.value : (e.target.value || undefined) }));

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = (form.name ?? '').trim();
        if (trimmed) onSubmit({ ...form, name: trimmed });
      }}
    >
      <Field label={t('name')}>
        <Input value={form.name ?? ''} onChange={set('name')} required />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label={t('city')}>
          <Input value={form.city ?? ''} onChange={set('city')} />
        </Field>
        <Field label={t('country')}>
          <Input value={form.country ?? ''} onChange={set('country')} />
        </Field>
      </div>
      <Field label={t('address')}>
        <Input value={form.address ?? ''} onChange={set('address')} />
      </Field>
      <Field label={t('notes')}>
        <Textarea rows={3} value={form.notes ?? ''} onChange={set('notes')} />
      </Field>
      <Button type="submit" size="lg" disabled={busy || !(form.name ?? '').trim()}>
        {busy ? '…' : tCommon('save')}
      </Button>
    </form>
  );
}

export default function SitesPage() {
  const t = useTranslations('sites');
  const tCommon = useTranslations('common');
  const locale = useLocale();

  const sitesQ = useSites();
  const routersQ = useRouters();
  const createM = useCreateSite();
  const updateM = useUpdateSite();
  const deleteM = useDeleteSite();

  const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'edit'; site: Site } | null>(null);
  const [deleting, setDeleting] = useState<Site | null>(null);

  const routerCount = (siteId: string) => (routersQ.data ?? []).filter((r) => r.siteId === siteId).length;

  async function save(input: SiteInput) {
    if (dialog?.mode === 'edit') await updateM.mutateAsync({ id: dialog.site.id, input });
    else await createM.mutateAsync(input);
    setDialog(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={<Button onClick={() => setDialog({ mode: 'create' })}>+ {t('add')}</Button>}
      />

      <QueryState
        isLoading={sitesQ.isLoading}
        isError={sitesQ.isError}
        error={sitesQ.error}
        refetch={() => sitesQ.refetch()}
        isEmpty={(sitesQ.data ?? []).length === 0}
        empty={
          <EmptyState
            title={t('empty')}
            hint={t('emptyHint')}
            action={<Button onClick={() => setDialog({ mode: 'create' })}>{t('add')}</Button>}
          />
        }
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(sitesQ.data ?? []).map((s) => (
            <Card key={s.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  <span className="truncate">{s.name}</span>
                  <span className="shrink-0 rounded-full bg-slate-800 px-2.5 py-0.5 text-xs tabular-nums text-slate-300">
                    {routerCount(s.id)} {t('routers')}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                {(s.city || s.country) && (
                  <p className="text-slate-400">{[s.city, s.country].filter(Boolean).join(' — ')}</p>
                )}
                {s.notes && <p className="line-clamp-2 text-xs text-slate-500">{s.notes}</p>}
                <p className="text-[11px] text-slate-600">{formatDateTime(s.createdAt, locale)}</p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setDialog({ mode: 'edit', site: s })}>
                    {tCommon('edit')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(s)} className="text-red-300">
                    {tCommon('delete')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </QueryState>

      <Dialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog?.mode === 'edit' ? t('edit') : t('add')}
      >
        {dialog && (
          <SiteForm
            initial={
              dialog.mode === 'edit'
                ? {
                    name: dialog.site.name,
                    address: dialog.site.address ?? undefined,
                    city: dialog.site.city ?? undefined,
                    country: dialog.site.country,
                    notes: dialog.site.notes ?? undefined,
                  }
                : emptyForm
            }
            onSubmit={save}
            busy={createM.isPending || updateM.isPending}
          />
        )}
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (deleting) await deleteM.mutateAsync(deleting.id);
          setDeleting(null);
        }}
        title={t('deleteTitle')}
        message={t('deleteMessage')}
        confirmLabel={tCommon('delete')}
        loading={deleteM.isPending}
      />
    </div>
  );
}
