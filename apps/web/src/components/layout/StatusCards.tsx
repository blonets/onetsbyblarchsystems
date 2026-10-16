'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api-client';

export function StatusCards() {
  const t = useTranslations('dashboard');
  const { data: routers = [] } = useQuery({
    queryKey: ['routers'],
    queryFn: () => api.listRouters(),
  });

  const online = routers.filter((r) => r.status === 'online').length;
  const offline = routers.filter((r) => r.status === 'offline').length;
  const provisioning = routers.filter((r) => r.status === 'pending').length;

  const cards = [
    { label: t('total'), value: routers.length, accent: 'text-slate-100' },
    { label: t('online'), value: online, accent: 'text-emerald-300' },
    { label: t('offline'), value: offline, accent: 'text-red-300' },
    { label: t('provisioning'), value: provisioning, accent: 'text-amber-300' },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-slate-400">{c.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-4xl font-bold tabular-nums ${c.accent}`}>{c.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
