'use client';

import { useTranslations } from 'next-intl';
import { Button } from './button';
import { Card, CardContent } from './card';

export function LoadingState({ label }: { label?: string }) {
  const t = useTranslations('common');
  return (
    <Card>
      <CardContent className="flex items-center justify-center gap-3 py-12">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-emerald-400" />
        <span className="text-sm text-slate-400">{label ?? t('loading')}</span>
      </CardContent>
    </Card>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const t = useTranslations('common');
  return (
    <Card className="border-red-500/30">
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <p className="text-sm text-red-300">{message ?? t('error')}</p>
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            {t('retry')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800 text-xl text-slate-500">
          ○
        </div>
        <p className="mt-2 text-sm font-medium text-slate-300">{title}</p>
        {hint && <p className="max-w-sm text-xs text-slate-500">{hint}</p>}
        {action && <div className="mt-3">{action}</div>}
      </CardContent>
    </Card>
  );
}

/** Generic query-state wrapper: loading → error → empty → content. */
export function QueryState({
  isLoading,
  isError,
  error,
  refetch,
  isEmpty,
  empty,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  refetch: () => void;
  isEmpty: boolean;
  empty: React.ReactNode;
  children: React.ReactNode;
}) {
  if (isLoading) return <LoadingState />;
  if (isError)
    return (
      <ErrorState
        message={error instanceof Error ? error.message : undefined}
        onRetry={refetch}
      />
    );
  if (isEmpty) return <>{empty}</>;
  return <>{children}</>;
}
