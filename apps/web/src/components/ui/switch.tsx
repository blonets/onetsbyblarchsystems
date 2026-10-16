'use client';

import { cn } from '@/lib/utils';

/** iOS-style toggle. Big touch target for technicians. */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-8 w-14 shrink-0 rounded-full transition-colors',
        checked ? 'bg-emerald-500' : 'bg-slate-700',
        disabled && 'opacity-50',
      )}
    >
      <span
        className={cn(
          'absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all',
          // RTL-aware: knob travels to the inline-start side when on
          checked ? 'start-1' : 'end-1',
        )}
      />
    </button>
  );
}
