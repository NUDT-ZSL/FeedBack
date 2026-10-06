import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({
  title,
  extra,
  children,
  className,
}: {
  title?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-md border border-[#8b4513]/30 bg-[#fdf9ee] shadow-sm', className)}>
      {(title || extra) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#8b4513]/20 px-4 py-2">
          {title && <h3 className="text-base font-semibold text-[#6b3a2a]">{title}</h3>}
          {extra}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

type BtnVariant = 'primary' | 'indigo' | 'ghost' | 'danger';

export function Btn({
  variant = 'primary',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  const variants: Record<BtnVariant, string> = {
    primary:
      'bg-gradient-to-b from-[#8b4513] to-[#6b3a2a] text-[#f5e6c8] hover:brightness-125 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100',
    indigo:
      'bg-[#1a5276] text-[#f5e6c8] hover:brightness-125 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100',
    ghost: 'border border-[#8b4513]/40 bg-transparent text-[#6b3a2a] hover:bg-[#ffd70022]',
    danger: 'bg-[#9c2f2f] text-white hover:brightness-110',
  };
  return (
    <button
      className={cn('rounded-md px-3 py-1.5 text-sm transition duration-200', variants[variant], className)}
      {...rest}
    />
  );
}

export type BadgeTone = 'green' | 'amber' | 'red' | 'indigo' | 'gray' | 'brown';

export function Badge({ tone = 'gray', children }: { tone?: BadgeTone; children: ReactNode }) {
  const tones: Record<BadgeTone, string> = {
    green: 'bg-green-100 text-green-800 border-green-700/30',
    amber: 'bg-amber-100 text-amber-900 border-amber-700/30',
    red: 'bg-red-100 text-red-800 border-red-700/30',
    indigo: 'bg-[#e3edf3] text-[#1a5276] border-[#1a5276]/30',
    gray: 'bg-stone-100 text-stone-600 border-stone-400/40',
    brown: 'bg-[#f5e6c8] text-[#6b3a2a] border-[#8b4513]/40',
  };
  return (
    <span className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs', tones[tone])}>
      {children}
    </span>
  );
}

export function Notice({ tone = 'amber', children }: { tone?: BadgeTone; children: ReactNode }) {
  const tones: Record<BadgeTone, string> = {
    green: 'border-green-700/30 bg-green-50 text-green-900',
    amber: 'border-amber-700/30 bg-amber-50 text-amber-900',
    red: 'border-red-700/30 bg-red-50 text-red-900',
    indigo: 'border-[#1a5276]/30 bg-[#eef4f8] text-[#1a5276]',
    gray: 'border-stone-400/40 bg-stone-50 text-stone-600',
    brown: 'border-[#8b4513]/40 bg-[#f5e6c8] text-[#6b3a2a]',
  };
  return (
    <div className={cn('rounded border px-3 py-2 text-sm', tones[tone])}>{children}</div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-[#6b3a2a]">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  'rounded border border-[#8b4513]/30 bg-white px-2 py-1 text-sm text-stone-800 outline-none focus:border-[#1a5276]';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="text" {...props} className={cn(inputCls, props.className)} />;
}

export function NumberInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="number" step="any" {...props} className={cn(inputCls, props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(inputCls, props.className)} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(inputCls, props.className)} />;
}
