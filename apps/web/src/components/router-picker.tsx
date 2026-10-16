'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Select } from '@/components/ui/form';
import { useRouters } from '@/lib/queries';
import type { RouterView } from '@/lib/types';

/**
 * Shared router picker: honours `?router=<id>` (deep links from the router
 * detail page), falls back to the first router, and lets the user switch.
 */
export function useRouterPicker() {
  const params = useSearchParams();
  const routersQ = useRouters();
  const routers = routersQ.data ?? [];
  const fromParam = params.get('router');
  const [override, setOverride] = useState<string | null>(null);
  const selected: string =
    override ??
    (fromParam && routers.some((r) => r.id === fromParam) ? fromParam : routers[0]?.id ?? '');
  return { routers, selected, setSelected: setOverride, isLoading: routersQ.isLoading };
}

export function RouterSelect({
  routers,
  selected,
  onChange,
}: {
  routers: RouterView[];
  selected: string;
  onChange: (id: string) => void;
}) {
  const tCommon = useTranslations('common');
  return (
    <Select value={selected} onChange={(e) => onChange(e.target.value)} className="w-full sm:w-72">
      <option value="">{tCommon('selectRouter')}…</option>
      {routers.map((r) => (
        <option key={r.id} value={r.id}>
          {r.identityName} · {r.siteName}
        </option>
      ))}
    </Select>
  );
}
