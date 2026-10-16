'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export function Header() {
  const t = useTranslations('nav');
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-950/80 px-6 py-4 backdrop-blur">
      <div className="text-sm text-slate-400">
        <span className="font-semibold text-slate-200">{t('dashboard')}</span>
        <span className="mx-2 text-slate-600">/</span>
        <span>fleet</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden text-xs text-slate-500 sm:block">demo operator</span>
        <Button size="sm" variant="outline">
          +
        </Button>
      </div>
    </header>
  );
}
