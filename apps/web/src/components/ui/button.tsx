import { cn } from '@/lib/utils';

type ButtonVariant = 'default' | 'outline' | 'ghost' | 'destructive';
type ButtonSize = 'sm' | 'md' | 'lg';

const variants: Record<ButtonVariant, string> = {
  default: 'bg-emerald-500 text-slate-950 hover:bg-emerald-400 font-semibold',
  outline: 'border border-slate-700 bg-transparent hover:bg-slate-800 text-slate-200',
  ghost: 'bg-transparent hover:bg-slate-800 text-slate-300',
  destructive: 'bg-red-500/90 text-white hover:bg-red-500 font-semibold',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** shadcn-style button (hand-rolled for the scaffold; extend via the shadcn CLI later). */
export function Button({ variant = 'default', size = 'md', className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400',
        'disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
