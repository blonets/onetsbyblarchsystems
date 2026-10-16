'use client';

import { useTranslations } from 'next-intl';
import type { FleetResult } from '@/lib/types';

/**
 * Bulk-operation result: per-router ✓/✗ with error messages.
 * One router's failure never blocks the list — every target gets its own row.
 */
export function FleetResultView({ result }: { result: FleetResult }) {
  const t = useTranslations('routers.bulk');

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-700 bg-slate-800/40 px-4 py-3">
        <span className="text-sm font-bold text-emerald-300">✓ {result.okCount}</span>
        <span className="text-sm font-bold text-red-300">✗ {result.failCount}</span>
        <span className="ms-auto font-mono text-[11px] text-slate-500" dir="ltr">
          {result.opId}
        </span>
      </div>
      <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
        {result.results.map((r) => (
          <li
            key={r.routerId}
            className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
              r.ok ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'
            }`}
          >
            <span className={`mt-0.5 text-base font-bold ${r.ok ? 'text-emerald-300' : 'text-red-300'}`}>
              {r.ok ? '✓' : '✗'}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[13px] text-slate-200">{r.routerName}</p>
              {!r.ok && r.error && (
                <p className="mt-1 text-xs text-red-300" dir="auto">
                  {r.error}
                </p>
              )}
            </div>
            <span className="shrink-0 text-[11px] text-slate-500">
              {r.ok ? t('ok') : t('failed')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
