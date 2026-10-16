'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import type { Role } from '@/lib/types';

const items: Array<{ key: string; href: string; roles?: Role[] }> = [
  { key: 'dashboard', href: '/' },
  { key: 'routers', href: '/routers' },
  { key: 'sites', href: '/sites' },
  { key: 'hotspot', href: '/hotspot' },
  { key: 'firewall', href: '/firewall', roles: ['admin', 'operator'] },
  { key: 'queues', href: '/queues', roles: ['admin', 'operator'] },
  { key: 'monitoring', href: '/monitoring' },
  { key: 'backups', href: '/backups' },
  { key: 'devices', href: '/devices' },
  { key: 'provisioning', href: '/provisioning', roles: ['admin', 'operator'] },
  { key: 'admin', href: '/admin', roles: ['admin'] },
];

const icons: Record<string, string> = {
  dashboard: '◈',
  routers: '◉',
  sites: '⌂',
  hotspot: '◍',
  firewall: '⛨',
  queues: '≡',
  monitoring: '∿',
  backups: '⧉',
  devices: '▣',
  provisioning: '✦',
  admin: '⚙',
};

export function Sidebar() {
  const t = useTranslations('nav');
  const tAuth = useTranslations('auth');
  const pathname = usePathname();
  const locale = useLocale();
  const { user, logout } = useAuth();
  const otherLocale = locale === 'ar' ? 'en' : 'ar';

  const visible = items.filter((i) => !i.roles || (user && i.roles.includes(user.role)));

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-e border-slate-800 bg-slate-900/40 md:flex">
      <div className="flex items-center gap-3 px-5 py-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500 font-black text-slate-950">
          M
        </div>
        <div>
          <p className="text-sm font-bold leading-tight">MikroTik Fleet</p>
          <p className="text-xs text-slate-400">CafeAndResturantsSystems</p>
        </div>
      </div>

      <nav className="flex flex-col gap-1 overflow-y-auto px-3">
        {visible.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.key}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                active
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200',
              )}
            >
              <span className="w-5 text-center text-base leading-none">{icons[item.key]}</span>
              {t(item.key)}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-2 p-4">
        <Link
          href={pathname}
          locale={otherLocale}
          className="block rounded-lg border border-slate-800 px-3 py-2 text-center text-xs text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
        >
          {otherLocale === 'ar' ? 'العربية' : 'English'}
        </Link>
        {user && (
          <button
            onClick={() => void logout()}
            className="rounded-lg border border-slate-800 px-3 py-2 text-center text-xs text-slate-400 hover:bg-slate-800/60 hover:text-red-300"
          >
            {tAuth('logout')} · {user.name}
          </button>
        )}
        <p className="text-center text-[11px] text-slate-600">v0.2.0 — phase 1</p>
      </div>
    </aside>
  );
}
