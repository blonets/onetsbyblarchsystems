'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/page';
import { EmptyState, QueryState } from '@/components/ui/states';
import { Table, TBody, THead, Th, Tr, Td, Mono } from '@/components/ui/table';
import { useRouters, useSites } from '@/lib/queries';
import { formatDateTime } from '@/lib/format';
import type { RouterStatus } from '@/lib/types';

const statuses: Array<RouterStatus | 'all'> = ['all', 'online', 'offline', 'pending', 'suspect', 'decommissioned'];

export default function RoutersPage() {
  const t = useTranslations('routers');
  const tCommon = useTranslations('common');
  const tStatus = useTranslations('status');
  const locale = useLocale();

  const [q, setQ] = useState('');
  const [status, setStatus] = useState<RouterStatus | 'all'>('all');
  const [siteId, setSiteId] = useState('');

  const query = useRouters({ q: q || undefined, status, siteId: siteId || undefined });
  const sitesQ = useSites();
  const routers = query.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Link href="/routers/new">
            <Button>+ {t('onboard.title')}</Button>
          </Link>
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row">
          <div className="flex-1">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('searchPlaceholder')}
            />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value as RouterStatus | 'all')} className="sm:w-48">
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? `${t('filterStatus')}: ${tCommon('all')}` : tStatus(s)}
              </option>
            ))}
          </Select>
          <Select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="sm:w-56">
            <option value="">{t('site')}: {tCommon('all')}</option>
            {(sitesQ.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </CardContent>
      </Card>

      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        refetch={() => query.refetch()}
        isEmpty={routers.length === 0}
        empty={<EmptyState title={t('empty')} hint={t('emptyHint')} action={<Link href="/routers/new"><Button>{t('onboard.title')}</Button></Link>} />}
      >
        <Card>
          <CardContent className="pt-6">
            <p className="mb-3 text-xs text-slate-500">
              {tCommon('showingOf', { shown: routers.length, total: routers.length })}
            </p>
            <Table>
              <THead>
                <Th>{t('identity')}</Th>
                <Th>{t('site')}</Th>
                <Th>{t('status')}</Th>
                <Th>{t('tunnelIp')}</Th>
                <Th>{t('version')}</Th>
                <Th>{t('lastSeen')}</Th>
              </THead>
              <TBody>
                {routers.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <Link href={`/routers/${r.id}`} className="font-mono text-[13px] text-emerald-300 hover:underline">
                        {r.identityName}
                      </Link>
                      {r.isHub && (
                        <span className="ms-2 rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-300">
                          HUB
                        </span>
                      )}
                    </Td>
                    <Td className="text-slate-300">{r.siteName ?? '—'}</Td>
                    <Td>
                      <StatusBadge status={r.status} />
                    </Td>
                    <Td>
                      <Mono>{r.tunnelIp ?? '—'}</Mono>
                    </Td>
                    <Td className="text-slate-400">{r.routerOsVersion ?? '—'}</Td>
                    <Td className="whitespace-nowrap text-slate-400">
                      {r.lastSeen ? formatDateTime(r.lastSeen, locale) : tCommon('never')}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </QueryState>
    </div>
  );
}
