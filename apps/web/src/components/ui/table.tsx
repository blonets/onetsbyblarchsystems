import { cn } from '@/lib/utils';

/** Shared table shell: sticky header, row hover, RTL text alignment. */
export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto rounded-xl border border-slate-800', className)}>
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-slate-800 bg-slate-900/80 text-start text-xs uppercase tracking-wider text-slate-500">
        {children}
      </tr>
    </thead>
  );
}

export function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={cn('px-3 py-2.5 text-start font-medium whitespace-nowrap', className)}>{children}</th>
  );
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function Tr({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <tr className={cn('border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30', className)}>
      {children}
    </tr>
  );
}

export function Td({ children, className, ...rest }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn('px-3 py-3 align-middle', className)} {...rest}>
      {children}
    </td>
  );
}

export function Mono({ children, className, ...rest }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn('font-mono text-[13px] text-slate-300', className)} {...rest}>
      {children}
    </span>
  );
}
