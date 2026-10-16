'use client';

import { useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/navigation';
import { isMockSocket } from '@/lib/socket';
import { isMockMode } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';

const crumbs: Record<string, string> = {
  routers: 'routers',
  sites: 'sites',
  hotspot: 'hotspot',
  firewall: 'firewall',
  queues: 'queues',
  monitoring: 'monitoring',
  backups: 'backups',
  devices: 'devices',
  admin: 'admin',
};

export function Header() {
  const t = useTranslations('nav');
  const tCommon = useTranslations('common');
  const pathname = usePathname();
  const { user } = useAuth();

  const seg = pathname.split('/').filter(Boolean)[0];
  const section = seg && crumbs[seg] ? t(crumbs[seg]) : t('dashboard');

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/80 px-4 py-3 backdrop-blur sm:px-6">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <span className="font-semibold text-slate-200">{section}</span>
        {isMockMode && (
          <span
            className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300"
            title={tCommon('demoBanner')}
          >
            DEMO
          </span>
        )}
        {isMockSocket() && (
          <span className="hidden rounded-md bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-300 sm:inline">
            {tCommon('mockLive')}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden items-center gap-2 text-xs text-slate-500 sm:flex">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          {tCommon('live')}
        </span>
        {user && (
          <span className="rounded-full bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300">
            {user.name}
          </span>
        )}
      </div>
    </header>
  );
}
