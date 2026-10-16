'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { PageHeader, Tabs } from '@/components/ui/page';
import { EmptyState, QueryState } from '@/components/ui/states';
import { Table, TBody, THead, Th, Tr, Td, Mono } from '@/components/ui/table';
import {
  hotspotServersApi,
  serverProfilesApi,
  userProfilesApi,
  useBulkImportHotspotUsers,
  useCreateHotspotUser,
  useCreateWalledGarden,
  useCreateWalledGardenIp,
  useDeleteHotspotUser,
  useDeleteWalledGarden,
  useDeleteWalledGardenIp,
  useHotspotUsers,
  useRouters,
  useToggleHotspotUser,
  useUpdateHotspotUser,
  useWalledGarden,
  useWalledGardenIp,
} from '@/lib/queries';
import { formatBytes, formatUptime } from '@/lib/format';
import { RouterSelect, useRouterPicker } from '@/components/router-picker';
import type { HotspotProfileInput, HotspotUserInput, HotspotUserProfileInput } from '@/lib/api-client';
import type { HotspotProfile, HotspotServer, HotspotUser, HotspotUserProfile } from '@/lib/types';

type TabKey = 'servers' | 'serverProfiles' | 'users' | 'userProfiles' | 'walledGarden' | 'walledGardenIp' | 'import';

// ---------------------------------------------------------------- servers
function ServersTab({ routerId, canEdit }: { routerId: string; canEdit: boolean }) {
  const t = useTranslations('hotspot.server');
  const tCommon = useTranslations('common');
  const api = hotspotServersApi;
  const q = api.useList(routerId);
  const createM = api.useCreate(routerId);
  const updateM = api.useUpdate(routerId);
  const deleteM = api.useDelete(routerId);

  const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'edit'; row: HotspotServer } | null>(null);
  const [deleting, setDeleting] = useState<HotspotServer | null>(null);
  const [form, setForm] = useState({ name: '', interface: '', profile: '' });

  const rows = q.data ?? [];
  return (
    <div className="flex flex-col gap-4">
      {canEdit && (
        <div>
          <Button onClick={() => { setForm({ name: '', interface: '', profile: '' }); setDialog({ mode: 'create' }); }}>
            + {t('add')}
          </Button>
        </div>
      )}
      <QueryState
        isLoading={q.isLoading} isError={q.isError} error={q.error} refetch={() => q.refetch()}
        isEmpty={rows.length === 0}
        empty={<EmptyState title={t('add')} hint={t('interface')} />}
      >
        <Table>
          <THead><Th>{t('name')}</Th><Th>{t('interface')}</Th><Th>{t('profile')}</Th><Th>{tCommon('status')}</Th>{canEdit && <Th>{tCommon('actions')}</Th>}</THead>
          <TBody>
            {rows.map((s) => (
              <Tr key={s.id}>
                <Td><Mono>{s.name}</Mono></Td>
                <Td><Mono>{s.interface}</Mono></Td>
                <Td><Mono>{s.profile ?? '—'}</Mono></Td>
                <Td>
                  {canEdit ? (
                    <Switch
                      checked={!s.disabled}
                      onChange={(v) => updateM.mutate({ id: s.id, input: { disabled: !v } })}
                      label={s.name}
                    />
                  ) : (
                    <span className="text-xs text-slate-400">{s.disabled ? tCommon('disabled') : tCommon('enabled')}</span>
                  )}
                </Td>
                {canEdit && (
                  <Td>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setForm({ name: s.name, interface: s.interface, profile: s.profile ?? '' }); setDialog({ mode: 'edit', row: s }); }}>
                        {tCommon('edit')}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-red-300" onClick={() => setDeleting(s)}>
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

      <Dialog open={dialog !== null} onClose={() => setDialog(null)} title={dialog?.mode === 'edit' ? t('edit') : t('add')}>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (dialog?.mode === 'edit') await updateM.mutateAsync({ id: dialog.row.id, input: { name: form.name, interface: form.interface, profile: form.profile || undefined } });
            else await createM.mutateAsync({ name: form.name, interface: form.interface, profile: form.profile || undefined });
            setDialog(null);
          }}
        >
          <Field label={t('name')}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required dir="ltr" /></Field>
          <Field label={t('interface')}><Input value={form.interface} onChange={(e) => setForm({ ...form, interface: e.target.value })} required dir="ltr" placeholder="bridge-hotspot" /></Field>
          <Field label={t('profile')}><Input value={form.profile} onChange={(e) => setForm({ ...form, profile: e.target.value })} dir="ltr" /></Field>
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

// ---------------------------------------------------------------- server profiles
// Canonical HotspotProfile (server profile): hotspotAddress / dnsName / loginBy.
function ServerProfilesTab({ routerId, canEdit }: { routerId: string; canEdit: boolean }) {
  const t = useTranslations('hotspot.profile');
  const tCommon = useTranslations('common');
  const q = serverProfilesApi.useList(routerId);
  const createM = serverProfilesApi.useCreate(routerId);
  const updateM = serverProfilesApi.useUpdate(routerId);
  const deleteM = serverProfilesApi.useDelete(routerId);

  const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'edit'; row: HotspotProfile } | null>(null);
  const [deleting, setDeleting] = useState<HotspotProfile | null>(null);
  const [form, setForm] = useState<HotspotProfileInput>({ name: '' });
  const F = (k: keyof HotspotProfileInput) => ({
    value: form[k] ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value === '' ? undefined : e.target.value })),
  });

  const rows = q.data ?? [];
  return (
    <div className="flex flex-col gap-4">
      {canEdit && (
        <div>
          <Button onClick={() => { setForm({ name: '' }); setDialog({ mode: 'create' }); }}>+ {t('add')}</Button>
        </div>
      )}
      <QueryState
        isLoading={q.isLoading} isError={q.isError} error={q.error} refetch={() => q.refetch()}
        isEmpty={rows.length === 0}
        empty={<EmptyState title={t('add')} />}
      >
        <Table>
          <THead><Th>{t('name')}</Th><Th>{t('hotspotAddress')}</Th><Th>{t('dnsName')}</Th><Th>{t('loginBy')}</Th><Th>{t('rateLimit')}</Th>{canEdit && <Th>{tCommon('actions')}</Th>}</THead>
          <TBody>
            {rows.map((p) => (
              <Tr key={p.id}>
                <Td><Mono>{p.name}</Mono></Td>
                <Td><Mono>{p.hotspotAddress ?? '—'}</Mono></Td>
                <Td><Mono>{p.dnsName ?? '—'}</Mono></Td>
                <Td className="text-slate-400">{p.loginBy ?? '—'}</Td>
                <Td><Mono>{p.rateLimit ?? '—'}</Mono></Td>
                {canEdit && (
                  <Td>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setForm({ name: p.name, hotspotAddress: p.hotspotAddress ?? undefined, dnsName: p.dnsName ?? undefined, loginBy: p.loginBy ?? undefined, rateLimit: p.rateLimit ?? undefined }); setDialog({ mode: 'edit', row: p }); }}>
                        {tCommon('edit')}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-red-300" onClick={() => setDeleting(p)}>
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
          <Field label={t('name')} className="sm:col-span-2"><Input {...F('name')} required dir="ltr" /></Field>
          <Field label={t('hotspotAddress')}><Input {...F('hotspotAddress')} dir="ltr" placeholder="192.168.88.1" /></Field>
          <Field label={t('dnsName')}><Input {...F('dnsName')} dir="ltr" placeholder="login.cafe.local" /></Field>
          <Field label={t('loginBy')}><Input {...F('loginBy')} dir="ltr" placeholder="http-chap,https" /></Field>
          <Field label={t('rateLimit')}><Input {...F('rateLimit')} dir="ltr" placeholder="10M/10M" /></Field>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={createM.isPending || updateM.isPending}>{tCommon('save')}</Button>
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

// ---------------------------------------------------------------- user profiles (plans)
// Canonical HotspotUserProfile: rateLimit / sessionTimeout / idleTimeout / sharedUsers.
function UserProfilesTab({ routerId, canEdit }: { routerId: string; canEdit: boolean }) {
  const t = useTranslations('hotspot.profile');
  const tCommon = useTranslations('common');
  const q = userProfilesApi.useList(routerId);
  const createM = userProfilesApi.useCreate(routerId);
  const updateM = userProfilesApi.useUpdate(routerId);
  const deleteM = userProfilesApi.useDelete(routerId);

  const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'edit'; row: HotspotUserProfile } | null>(null);
  const [deleting, setDeleting] = useState<HotspotUserProfile | null>(null);
  const [form, setForm] = useState<HotspotUserProfileInput>({ name: '' });
  const F = (k: keyof HotspotUserProfileInput) => ({
    value: (form[k] as string | number | undefined) ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value === '' ? undefined : k === 'sharedUsers' ? Number(e.target.value) : e.target.value })),
  });

  const rows = q.data ?? [];
  return (
    <div className="flex flex-col gap-4">
      {canEdit && (
        <div>
          <Button onClick={() => { setForm({ name: '' }); setDialog({ mode: 'create' }); }}>+ {t('add')}</Button>
        </div>
      )}
      <QueryState
        isLoading={q.isLoading} isError={q.isError} error={q.error} refetch={() => q.refetch()}
        isEmpty={rows.length === 0}
        empty={<EmptyState title={t('add')} />}
      >
        <Table>
          <THead><Th>{t('name')}</Th><Th>{t('rateLimit')}</Th><Th>{t('sessionTimeout')}</Th><Th>{t('idleTimeout')}</Th><Th>{t('sharedUsers')}</Th>{canEdit && <Th>{tCommon('actions')}</Th>}</THead>
          <TBody>
            {rows.map((p) => (
              <Tr key={p.id}>
                <Td><Mono>{p.name}</Mono></Td>
                <Td><Mono>{p.rateLimit ?? '—'}</Mono></Td>
                <Td className="text-slate-400">{p.sessionTimeout ?? '—'}</Td>
                <Td className="text-slate-400">{p.idleTimeout ?? '—'}</Td>
                <Td className="tabular-nums">{p.sharedUsers ?? '—'}</Td>
                {canEdit && (
                  <Td>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setForm({ name: p.name, rateLimit: p.rateLimit ?? undefined, sessionTimeout: p.sessionTimeout ?? undefined, idleTimeout: p.idleTimeout ?? undefined, sharedUsers: p.sharedUsers ?? undefined }); setDialog({ mode: 'edit', row: p }); }}>
                        {tCommon('edit')}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-red-300" onClick={() => setDeleting(p)}>
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
          <Field label={t('name')} className="sm:col-span-2"><Input {...F('name')} required dir="ltr" /></Field>
          <Field label={t('rateLimit')}><Input {...F('rateLimit')} dir="ltr" placeholder="10M/10M" /></Field>
          <Field label={t('sessionTimeout')}><Input {...F('sessionTimeout')} dir="ltr" placeholder="04:00:00" /></Field>
          <Field label={t('idleTimeout')}><Input {...F('idleTimeout')} dir="ltr" placeholder="00:15:00" /></Field>
          <Field label={t('sharedUsers')}><Input {...F('sharedUsers')} dir="ltr" type="number" min={1} /></Field>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={createM.isPending || updateM.isPending}>{tCommon('save')}</Button>
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

// ---------------------------------------------------------------- users
function UsersTab({ routerId, canEdit }: { routerId: string; canEdit: boolean }) {
  const t = useTranslations('hotspot.user');
  const tCommon = useTranslations('common');
  const q = useHotspotUsers(routerId);
  const profilesQ = userProfilesApi.useList(routerId);
  const createM = useCreateHotspotUser(routerId);
  const updateM = useUpdateHotspotUser(routerId);
  const toggleM = useToggleHotspotUser(routerId);
  const deleteM = useDeleteHotspotUser(routerId);

  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'edit'; row: HotspotUser } | null>(null);
  const [deleting, setDeleting] = useState<HotspotUser | null>(null);
  const [form, setForm] = useState<HotspotUserInput>({ name: '', profileName: '' });

  const rows = useMemo(() => {
    const all = q.data ?? [];
    if (!search.trim()) return all;
    const s = search.trim().toLowerCase();
    return all.filter((u) => u.name.toLowerCase().includes(s));
  }, [q.data, search]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('searchPlaceholder')} />
        </div>
        {canEdit && (
          <Button onClick={() => { setForm({ name: '', profileName: (profilesQ.data ?? [])[0]?.name ?? '' }); setDialog({ mode: 'create' }); }}>
            + {t('add')}
          </Button>
        )}
      </div>

      <QueryState
        isLoading={q.isLoading} isError={q.isError} error={q.error} refetch={() => q.refetch()}
        isEmpty={rows.length === 0}
        empty={<EmptyState title={t('empty')} hint={t('emptyHint')} />}
      >
        <Table>
          <THead>
            <Th>{t('name')}</Th><Th>{t('profile')}</Th><Th>{t('uptime')}</Th><Th>{t('traffic')}</Th><Th>{tCommon('status')}</Th>
            {canEdit && <Th>{tCommon('actions')}</Th>}
          </THead>
          <TBody>
            {rows.map((u) => (
              <Tr key={u.id} className={u.disabled ? 'opacity-60' : undefined}>
                <Td><Mono>{u.name}</Mono></Td>
                <Td><Mono>{u.profileName ?? '—'}</Mono></Td>
                <Td className="tabular-nums text-slate-400">{u.uptimeUsedS !== '0' ? formatUptime(Number(u.uptimeUsedS)) : '—'}</Td>
                <Td className="tabular-nums text-slate-400">
                  {u.bytesIn !== '0' || u.bytesOut !== '0' ? `↓ ${formatBytes(Number(u.bytesIn))} ↑ ${formatBytes(Number(u.bytesOut))}` : '—'}
                </Td>
                <Td>
                  {canEdit ? (
                    <Switch checked={!u.disabled} onChange={(v) => toggleM.mutate({ id: u.id, disabled: !v })} label={u.name} />
                  ) : (
                    <span className="text-xs text-slate-400">{u.disabled ? t('disable') : t('enable')}</span>
                  )}
                </Td>
                {canEdit && (
                  <Td>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setForm({ name: u.name, profileName: u.profileName ?? '', comment: u.comment ?? '' }); setDialog({ mode: 'edit', row: u }); }}>
                        {tCommon('edit')}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-red-300" onClick={() => setDeleting(u)}>
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

      <Dialog open={dialog !== null} onClose={() => setDialog(null)} title={dialog?.mode === 'edit' ? t('edit') : t('add')}>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (dialog?.mode === 'edit') await updateM.mutateAsync({ id: dialog.row.id, input: { profileName: form.profileName, comment: form.comment } });
            else await createM.mutateAsync(form);
            setDialog(null);
          }}
        >
          <Field label={t('name')}>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required={dialog?.mode === 'create'} disabled={dialog?.mode === 'edit'} dir="ltr" />
          </Field>
          {dialog?.mode === 'create' && (
            <Field label={t('password')} hint={t('passwordHint')}>
              <Input value={form.password ?? ''} onChange={(e) => setForm({ ...form, password: e.target.value })} dir="ltr" />
            </Field>
          )}
          <Field label={t('profile')}>
            <Select value={form.profileName ?? ''} onChange={(e) => setForm({ ...form, profileName: e.target.value })} required>
              <option value="">{t('profile')}…</option>
              {(profilesQ.data ?? []).map((p) => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('comment')}>
            <Input value={form.comment ?? ''} onChange={(e) => setForm({ ...form, comment: e.target.value })} />
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

// ---------------------------------------------------------------- walled garden (host & ip share UI)
function WalledGardenTab({
  routerId, canEdit, kind,
}: {
  routerId: string;
  canEdit: boolean;
  kind: 'host' | 'ip';
}) {
  const t = useTranslations(kind === 'host' ? 'hotspot.walledGarden' : 'hotspot.walledGardenIp');
  const tCommon = useTranslations('common');

  // Both hooks run unconditionally (rules of hooks); we pick the active set below.
  const hostQ = useWalledGarden(routerId);
  const ipQ = useWalledGardenIp(routerId);
  const createHostM = useCreateWalledGarden(routerId);
  const createIpM = useCreateWalledGardenIp(routerId);
  const deleteHostM = useDeleteWalledGarden(routerId);
  const deleteIpM = useDeleteWalledGardenIp(routerId);
  const q = kind === 'host' ? hostQ : ipQ;
  const pending = createHostM.isPending || createIpM.isPending;

  const [value, setValue] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const rows = (q.data ?? []) as Array<{ id: string; dstHost?: string; dstAddress?: string; disabled: boolean; comment?: string }>;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-slate-500">{kind === 'host' ? t('hint') : ''}</p>
      {canEdit && (
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!value.trim()) return;
            if (kind === 'host') await createHostM.mutateAsync({ dstHost: value.trim() });
            else await createIpM.mutateAsync({ dstAddress: value.trim() });
            setValue('');
          }}
        >
          <Input
            value={value} onChange={(e) => setValue(e.target.value)} dir="ltr"
            placeholder={kind === 'host' ? '*.whatsapp.com' : '8.8.8.8'} className="flex-1"
          />
          <Button type="submit" disabled={pending}>+ {t('add')}</Button>
        </form>
      )}
      <QueryState
        isLoading={q.isLoading} isError={q.isError} error={q.error} refetch={() => q.refetch()}
        isEmpty={rows.length === 0}
        empty={<EmptyState title={t('empty')} />}
      >
        <Table>
          <THead><Th>{kind === 'host' ? t('dstHost') : t('dstAddress')}</Th><Th>{tCommon('status')}</Th>{canEdit && <Th>{tCommon('actions')}</Th>}</THead>
          <TBody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td><Mono>{kind === 'host' ? r.dstHost : r.dstAddress}</Mono></Td>
                <Td><span className="text-xs text-slate-400">{r.disabled ? tCommon('disabled') : tCommon('enabled')}</span></Td>
                {canEdit && (
                  <Td>
                    <Button size="sm" variant="ghost" className="text-red-300" onClick={() => setDeleting(r.id)}>
                      {tCommon('delete')}
                    </Button>
                  </Td>
                )}
              </Tr>
            ))}
          </TBody>
        </Table>
      </QueryState>
      <ConfirmDialog
        open={deleting !== null} onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          if (kind === 'host') await deleteHostM.mutateAsync(deleting);
          else await deleteIpM.mutateAsync(deleting);
          setDeleting(null);
        }}
        title={t('deleteTitle')} message={t('deleteMessage')} confirmLabel={tCommon('delete')}
      />
    </div>
  );
}

// ---------------------------------------------------------------- bulk import
function ImportTab({ routerId }: { routerId: string }) {
  const t = useTranslations('hotspot.import');
  const tCommon = useTranslations('common');
  const profilesQ = userProfilesApi.useList(routerId);
  const importM = useBulkImportHotspotUsers(routerId);
  const [csv, setCsv] = useState('');
  const [profile, setProfile] = useState('');

  const result = importM.data;

  return (
    <Card>
      <CardHeader><CardTitle>{t('title')}</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-slate-400">{t('description')}</p>
        <Field label={t('csvLabel')}>
          <Textarea rows={8} dir="ltr" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={t('csvPlaceholder')} className="font-mono text-[13px]" />
        </Field>
        <Field label={t('profileLabel')}>
          <Select value={profile} onChange={(e) => setProfile(e.target.value)}>
            <option value="">{t('profileLabel')}…</option>
            {(profilesQ.data ?? []).map((p) => (
              <option key={p.id} value={p.name}>{p.name}</option>
            ))}
          </Select>
        </Field>
        {result && (
          <div className="rounded-xl bg-slate-800/60 p-4 text-sm">
            <p className="font-medium text-emerald-300">
              {t('result', { created: result.created, failed: result.failed })}
            </p>
            {result.errors.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 text-xs text-red-300">
                {result.errors.slice(0, 10).map((e, i) => (
                  <li key={i} dir="ltr">{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div>
          <Button
            size="lg"
            disabled={!csv.trim() || !profile || importM.isPending}
            onClick={() => importM.mutate({ csv, profile })}
          >
            {importM.isPending ? t('importing') : t('importBtn')}
          </Button>
        </div>
        {importM.isError && <p className="text-sm text-red-300">{tCommon('error')}</p>}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- page
export default function HotspotPage() {
  const t = useTranslations('hotspot');
  const tCommon = useTranslations('common');
  const tMon = useTranslations('monitoring');
  const { routers, selected, setSelected, isLoading } = useRouterPicker();
  const [tab, setTab] = useState<TabKey>('users');

  // Hotspot user/service management is the technicians' daily work, so every
  // authenticated role may edit here; firewall/queues stay admin+operator (ARCH §6).
  const canEdit = true;

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'users', label: t('tabs.users') },
    { key: 'servers', label: t('tabs.servers') },
    { key: 'serverProfiles', label: t('tabs.serverProfiles') },
    { key: 'userProfiles', label: t('tabs.userProfiles') },
    { key: 'walledGarden', label: t('tabs.walledGarden') },
    { key: 'walledGardenIp', label: t('tabs.walledGardenIp') },
    { key: 'import', label: t('tabs.import') },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={<RouterSelect routers={routers} selected={selected} onChange={setSelected} />}
      />

      {isLoading ? (
        <Card><CardContent className="py-12 text-center text-sm text-slate-400">{tCommon('loading')}</CardContent></Card>
      ) : !selected ? (
        <EmptyState title={tMon('selectRouter')} />
      ) : (
        <>
          <Tabs tabs={tabs} active={tab} onChange={setTab} />
          {tab === 'servers' && <ServersTab routerId={selected} canEdit={canEdit} />}
          {tab === 'serverProfiles' && <ServerProfilesTab routerId={selected} canEdit={canEdit} />}
          {tab === 'users' && <UsersTab routerId={selected} canEdit={canEdit} />}
          {tab === 'userProfiles' && <UserProfilesTab routerId={selected} canEdit={canEdit} />}
          {tab === 'walledGarden' && <WalledGardenTab routerId={selected} canEdit={canEdit} kind="host" />}
          {tab === 'walledGardenIp' && <WalledGardenTab routerId={selected} canEdit={canEdit} kind="ip" />}
          {tab === 'import' && canEdit && <ImportTab routerId={selected} />}
        </>
      )}
    </div>
  );
}
