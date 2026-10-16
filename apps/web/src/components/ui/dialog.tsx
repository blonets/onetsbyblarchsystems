'use client';

import { useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';

/** Minimal accessible modal. Renders nothing when closed. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl',
          wide ? 'max-w-3xl' : 'max-w-lg',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold">{title}</h2>
            {description && <p className="mt-1 text-sm text-slate-400">{description}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="close"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Destructive-action confirmation dialog. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel: string;
  loading?: boolean;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <p className="text-sm leading-relaxed text-slate-300">{message}</p>
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="outline" onClick={onClose} disabled={loading}>
          ✕
        </Button>
        <Button variant="destructive" onClick={onConfirm} disabled={loading}>
          {loading ? '…' : confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
