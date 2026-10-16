import type { RouterStatus } from '@mtk/types';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

const styles: Record<RouterStatus, string> = {
  online: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  offline: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  provisioning: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  error: 'bg-red-500/15 text-red-300 border-red-500/30',
  unknown: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
};

export function StatusBadge({ status }: { status: RouterStatus }) {
  const t = useTranslations('status');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        styles[status],
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full bg-current', status === 'online' && 'animate-pulse')} />
      {t(status)}
    </span>
  );
}
