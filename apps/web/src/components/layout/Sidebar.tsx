'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

const items = [
  { key: 'dashboard', href: '/' },
  { key: 'routers', href: '/routers' },
  { key: 'hotspot', href: '/hotspot' },
  { key: 'firewall', href: '/firewall' },
  { key: 'backups', href: '/backups' },
] as const;

export function Sidebar() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const locale = useLocale();
  const otherLocale = locale === 'ar' ? 'en' : 'ar';

  return (
    <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-e border-slate-800 bg-slate-900/40">
      <div className="flex items-center gap-3 px-5 py-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500 font-black text-slate-950">
          M
        </div>
        <div>
          <p className="text-sm font-bold leading-tight">MikroTik Fleet</p>
          <p className="text-xs text-slate-400">CafeAndResturantsSystems</p>
        </div>
      </div>

      <nav className="flex flex-col gap-1 px-3">
        {items.map((item) => {
          const active =
            item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.key}
              href={item.href}
              className={cn(
                'rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                active
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200',
              )}
            >
              {t(item.key)}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto p-4">
        <Link
          href={pathname}
          locale={otherLocale}
          className="block rounded-lg border border-slate-800 px-3 py-2 text-center text-xs text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
        >
          {otherLocale === 'ar' ? 'العربية' : 'English'}
        </Link>
        <p className="mt-3 text-center text-[11px] text-slate-600">v0.1.0 — scaffold</p>
      </div>
    </aside>
  );
}
