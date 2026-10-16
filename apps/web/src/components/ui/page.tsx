'use client';

import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ key: T; label: string; badge?: number }>;
  active: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60 p-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            'flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
            active === t.key
              ? 'bg-emerald-500/15 text-emerald-300'
              : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200',
          )}
        >
          {t.label}
          {t.badge !== undefined && (
            <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[11px] tabular-nums">{t.badge}</span>
          )}
        </button>
      ))}
    </div>
  );
}
