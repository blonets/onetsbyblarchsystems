'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { StatusBadge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiClient } from '@/lib/api-client';

export default function RoutersPage() {
  const t = useTranslations('routers');
  const { data: routers = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['routers'],
    queryFn: () => apiClient.listRouters(),
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-400">{t('subtitle')}</p>
        <p className="mt-2 inline-block rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
          {t('mockNotice')}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {t('title')} · {routers.length}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="py-8 text-center text-sm text-slate-400">{t('loading')}</p>}
          {isError && (
            <div className="py-8 text-center">
              <p className="text-sm text-red-300">{t('error')}</p>
              <button onClick={() => refetch()} className="mt-2 text-xs text-slate-400 underline">
                retry
              </button>
            </div>
          )}
          {!isLoading && !isError && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-start text-xs uppercase tracking-wider text-slate-500">
                    <th className="px-3 py-2 text-start font-medium">{t('identity')}</th>
                    <th className="px-3 py-2 text-start font-medium">{t('site')}</th>
                    <th className="px-3 py-2 text-start font-medium">{t('status')}</th>
                    <th className="px-3 py-2 text-start font-medium">{t('tunnelIp')}</th>
                    <th className="px-3 py-2 text-start font-medium">{t('version')}</th>
                    <th className="px-3 py-2 text-start font-medium">{t('lastSeen')}</th>
                  </tr>
                </thead>
                <tbody>
                  {routers.map((r) => (
                    <tr key={r.id} className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30">
                      <td className="px-3 py-3 font-mono text-[13px]">{r.identity}</td>
                      <td className="px-3 py-3 text-slate-300">{r.siteName}</td>
                      <td className="px-3 py-3">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-3 py-3 font-mono text-[13px] text-slate-400">{r.tunnelIp ?? '—'}</td>
                      <td className="px-3 py-3 text-slate-400">{r.rosVersion ?? '—'}</td>
                      <td className="px-3 py-3 text-slate-400">
                        {r.lastSeenAt ? new Date(r.lastSeenAt).toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
