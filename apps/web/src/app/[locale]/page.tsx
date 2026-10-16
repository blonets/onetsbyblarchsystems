import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusCards } from '@/components/layout/StatusCards';

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('dashboard');

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-400">{t('subtitle')}</p>
      </div>

      <StatusCards />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('fleetHealth')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-32 items-center justify-center rounded-xl bg-slate-800/40 text-sm text-slate-500">
              {t('noActivity')}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('recentActivity')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-32 items-center justify-center rounded-xl bg-slate-800/40 text-sm text-slate-500">
              {t('noActivity')}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
