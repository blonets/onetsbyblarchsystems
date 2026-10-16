'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { PageHeader, Tabs } from '@/components/ui/page';
import { EmptyState, QueryState } from '@/components/ui/states';
import { Table, TBody, THead, Th, Tr, Td, Mono } from '@/components/ui/table';
import {
  useAuditLog,
  useCreatePlatformUser,
  useDeletePlatformUser,
  useNotificationChannels,
  usePlatformUsers,
  useUpdateNotificationChannels,
  useUpdatePlatformUser,
} from '@/lib/queries';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import type { PlatformUserInput } from '@/lib/api-client';
import type { PlatformUser, Role } from '@/lib/types';

type TabKey = 'users' | 'audit' | 'notifications';
const roles: Role[] = ['admin', 'operator', 'technician', 'viewer'];

function UsersTab() {
  const t = useTranslations('admin.users');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const { user: me } = useAuth();
  const q = usePlatformUsers();
  const createM = useCreatePlatformUser();
  const updateM = useUpdatePlatformUser();
  const deleteM = useDeletePlatformUser();

  const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'edit'; row: PlatformUser } | null>(null);
  const [deleting, setDeleting] = useState<PlatformUser | null>(null);
  const [form, setForm] = useState<PlatformUserInput>({ email: '', name: '', role: 'viewer' });

  const rows = q.data ?? [];
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button onClick={() => { setForm({ email: '', name: '', role: 'viewer' }); setDialog({ mode: 'create' }); }}>
          + {t('add')}
        </Button>
      </div>
      <QueryState
        isLoading={q.isLoading} isError={q.isError} error={q.error} refetch={() => q.refetch()}
        isEmpty={rows.length === 0}
        empty={<EmptyState title={t('title')} />}
      >
        <Table>
          <THead><Th>{t('name')}</Th><Th>{t('email')}</Th><Th>{t('role')}</Th><Th>{t('lastLogin')}</Th><Th>{tCommon('actions')}</Th></THead>
          <TBody>
            {rows.map((u) => (
              <Tr key={u.id}>
                <Td className="font-medium">
                  {u.name}
                  {u.id === me?.id && <span className="ms-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">you</span>}
                </Td>
                <Td><Mono dir="ltr" className="text-xs">{u.email}</Mono></Td>
                <Td>
                  <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs text-slate-300">
                    {t(`roles.${u.role}`)}
                  </span>
                  <span className="ms-2 hidden text-[11px] text-slate-500 xl:inline">{t(`roleHints.${u.role}`)}</span>
                </Td>
                <Td className="whitespace-nowrap text-slate-400">{u.lastLoginAt ? formatDateTime(u.lastLoginAt, locale) : tCommon('never')}</Td>
                <Td>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => { setForm({ email: u.email, name: u.name, role: u.role }); setDialog({ mode: 'edit', row: u }); }}>
                      {tCommon('edit')}
                    </Button>
                    <Button size="sm" variant="ghost" className="text-red-300" disabled={u.id === me?.id} onClick={() => setDeleting(u)}>
                      {tCommon('delete')}
                    </Button>
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </QueryState>

      <Dialog open={dialog !== null} onClose={() => setDialog(null)} title={dialog?.mode === 'edit' ? t('edit') : t('add')}>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (dialog?.mode === 'edit') await updateM.mutateAsync({ id: dialog.row.id, input: { name: form.name, role: form.role, password: form.password || undefined } });
            else await createM.mutateAsync(form);
            setDialog(null);
          }}
        >
          <Field label={t('name')}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
          <Field label={t('email')}><Input type="email" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required={dialog?.mode === 'create'} disabled={dialog?.mode === 'edit'} /></Field>
          <Field label={t('role')}>
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {roles.map((r) => (
                <option key={r} value={r}>{t(`roles.${r}`)} — {t(`roleHints.${r}`)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('password')} hint={dialog?.mode === 'edit' ? t('passwordHint') : undefined}>
            <Input type="password" dir="ltr" value={form.password ?? ''} onChange={(e) => setForm({ ...form, password: e.target.value })} required={dialog?.mode === 'create'} autoComplete="new-password" />
          </Field>
          <Button type="submit" disabled={createM.isPending || updateM.isPending}>{tCommon('save')}</Button>
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

function AuditTab() {
  const t = useTranslations('admin.audit');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const q = useAuditLog(page);
  const items = q.data?.items ?? [];
  const total = q.data?.total ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <QueryState
        isLoading={q.isLoading} isError={q.isError} error={q.error} refetch={() => q.refetch()}
        isEmpty={items.length === 0}
        empty={<EmptyState title={t('empty')} />}
      >
        <Card>
          <CardContent className="pt-6">
            <p className="mb-3 text-xs text-slate-500">
              {t('page', { page })} · {tCommon('showingOf', { shown: items.length, total })}
            </p>
            <Table>
              <THead><Th>{t('time')}</Th><Th>{t('actor')}</Th><Th>{t('action')}</Th><Th>{t('entity')}</Th><Th>{t('details')}</Th></THead>
              <TBody>
                {items.map((a) => (
                  <Tr key={a.id}>
                    <Td className="whitespace-nowrap text-slate-400">{formatDateTime(a.createdAt, locale)}</Td>
                    <Td>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${a.actorType === 'system' ? 'bg-violet-500/15 text-violet-300' : 'bg-slate-800 text-slate-300'}`}>
                        {a.actorType === 'system' ? t('system') : a.actorId}
                      </span>
                    </Td>
                    <Td><Mono className="text-xs">{a.action}</Mono></Td>
                    <Td className="text-slate-400">{a.entityType}{a.entityId ? <span className="font-mono text-[11px] text-slate-500"> · {a.entityId.slice(0, 12)}</span> : null}</Td>
                    <Td className="max-w-64 truncate font-mono text-[11px] text-slate-500" title={JSON.stringify(a.after ?? a.before ?? {})} dir="ltr">
                      {a.after ?? a.before ? JSON.stringify(a.after ?? a.before) : '—'}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <div className="mt-4 flex items-center justify-between">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                ← {tCommon('back')}
              </Button>
              <span className="text-xs text-slate-500">{t('page', { page })}</span>
              <Button size="sm" variant="outline" disabled={items.length < 25} onClick={() => setPage((p) => p + 1)}>
                {tCommon('next')} →
              </Button>
            </div>
          </CardContent>
        </Card>
      </QueryState>
    </div>
  );
}

function NotificationsTab() {
  const t = useTranslations('admin.notifications');
  const tCommon = useTranslations('common');
  const q = useNotificationChannels();
  const updateM = useUpdateNotificationChannels();
  const [saved, setSaved] = useState(false);

  const ch = q.data;
  const [telegram, setTelegram] = useState<boolean | null>(null);
  const [email, setEmail] = useState<boolean | null>(null);

  const tg = telegram ?? ch?.telegram.enabled ?? false;
  const em = email ?? ch?.email.enabled ?? false;

  async function save() {
    await updateM.mutateAsync({ telegramEnabled: tg, emailEnabled: em });
    setTelegram(null);
    setEmail(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  if (q.isLoading) return <Card><CardContent className="py-12 text-center text-sm text-slate-400">{tCommon('loading')}</CardContent></Card>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <p className="text-xs text-slate-500">{t('subtitle')}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {([
          { key: 'telegram', label: t('telegram'), value: tg, set: setTelegram, state: ch?.telegram },
          { key: 'email', label: t('email'), value: em, set: setEmail, state: ch?.email },
        ] as const).map((row) => (
          <div key={row.key} className="flex items-start justify-between gap-4 rounded-xl border border-slate-800 p-4">
            <div>
              <p className="flex items-center gap-2 text-sm font-medium">
                {row.label}
                {row.state && !row.state.configured && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-300" title={t('needsConfigHint')}>
                    {t('needsConfig')}
                  </span>
                )}
              </p>
              {row.state && !row.state.configured && (
                <p className="mt-1 text-xs text-slate-500">{t('needsConfigHint')}</p>
              )}
            </div>
            <Switch checked={row.value} onChange={(v) => row.set(v)} label={row.label} />
          </div>
        ))}
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={updateM.isPending}>{t('save')}</Button>
          {saved && <span className="text-sm text-emerald-300">✓ {t('saved')}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminPage() {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const { hasRole } = useAuth();
  const [tab, setTab] = useState<TabKey>('users');

  if (!hasRole('admin')) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        <EmptyState title={t('title')} hint={tCommon('error')} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <Tabs
        tabs={[
          { key: 'users', label: t('tabs.users') },
          { key: 'audit', label: t('tabs.audit') },
          { key: 'notifications', label: t('tabs.notifications') },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'users' && <UsersTab />}
      {tab === 'audit' && <AuditTab />}
      {tab === 'notifications' && <NotificationsTab />}
    </div>
  );
}
