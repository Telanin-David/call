import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './icons/Icon';

export function ChoiceCard({ checked, locked, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { checked: boolean; locked?: boolean }) {
  return (
    <button type="button" role="radio" aria-checked={checked} aria-disabled={locked || undefined}
      className={cn(
        'group flex w-full cursor-pointer items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-3 text-left text-ink',
        'aria-checked:border-brand aria-checked:bg-brand-soft aria-checked:shadow-[0_0_0_1px_var(--brand)]',
        locked && 'cursor-not-allowed opacity-75',
        className,
      )}
      {...rest}>
      {children}
    </button>
  );
}

export function Radio() {
  return <span aria-hidden="true" className="ml-auto size-5 flex-none rounded-full border-[1.5px] border-line-strong group-aria-checked:border-[6px] group-aria-checked:border-brand" />;
}

export type OutcomeTone = 'mint' | 'orange' | 'grey' | 'lemon' | 'red';

const OUTCOME_TONE: Record<OutcomeTone, string> = {
  mint: 'bg-success-soft text-success-ink',
  orange: 'bg-brand-soft text-brand-ink group-aria-pressed:bg-brand group-aria-pressed:text-on-brand',
  grey: 'bg-sunk text-muted',
  lemon: 'bg-warn-soft text-warn-ink',
  red: 'bg-danger-soft text-danger-ink',
};

export function OutcomeTile({ icon, tone, pressed, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: IconName; tone: OutcomeTone; pressed: boolean;
}) {
  return (
    <button type="button" aria-pressed={pressed}
      className="group flex h-14 cursor-pointer items-center gap-2.5 rounded-xl border border-line bg-surface pl-2.5 pr-3 text-left text-14 font-medium leading-[18px] text-ink hover:bg-sunk aria-pressed:border-brand aria-pressed:bg-brand-soft aria-pressed:shadow-[0_0_0_1px_var(--brand)]"
      {...rest}>
      <span className={cn('flex size-[34px] flex-none items-center justify-center rounded-md', OUTCOME_TONE[tone])}><Icon name={icon} /></span>
      {children}
    </button>
  );
}

export function CallCard({ children }: { children: ReactNode }) {
  return <div className="relative flex flex-col gap-4 overflow-hidden rounded-3xl bg-night p-5 text-white dark:bg-[#1e1e22]">{children}</div>;
}

export function CallStatus({ live }: { live: boolean }) {
  return live ? (
    <span className="inline-flex h-[26px] items-center gap-2 rounded-[13px] bg-[rgba(18,183,106,.16)] px-2.5 text-12 font-semibold tracking-[.04em] text-[#5ee0a0]">
      <span className="size-2 animate-ring rounded-full bg-success" aria-hidden="true" />CONNECTED
    </span>
  ) : (
    <span className="inline-flex h-[26px] items-center rounded-[13px] bg-white/8 px-2.5 text-12 font-semibold tracking-[.04em] text-zinc-300">READY</span>
  );
}

export function CallTimer({ seconds, idle }: { seconds: number; idle: boolean }) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <div className={cn('text-52 font-semibold tracking-[-0.04em] tabular-nums', idle && 'text-zinc-600')}>
      {pad(Math.floor(seconds / 60))}:{pad(seconds % 60)}
    </div>
  );
}

export function CallFacts({ items }: { items: { label: string; value: ReactNode; hot?: boolean }[] }) {
  return (
    <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-white/8">
      {items.map(i => (
        <div key={i.label} className="flex flex-col gap-0.5 bg-night-2 px-3 py-2.5">
          <span className="text-11 leading-[14px] text-zinc-400">{i.label}</span>
          <b className={cn('text-16 leading-[22px] font-semibold tabular-nums', i.hot && 'text-[#ff9f5e]')}>{i.value}</b>
        </div>
      ))}
    </div>
  );
}

export function CallDevice({ icon, title, sub, battery }: { icon: IconName; title: string; sub: string; battery?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white/7 px-3 py-2.5">
      <span className="flex size-9 flex-none items-center justify-center rounded-[11px] bg-tangerine text-night"><Icon name={icon} /></span>
      <div>
        <b className="block text-14 leading-[18px] font-semibold">{title}</b>
        <span className="text-12 text-zinc-400">{sub}</span>
      </div>
      {battery && <span className="ml-auto text-12 text-zinc-300">{battery}</span>}
    </div>
  );
}

export function Facts({ items }: { items: { icon: IconName; label: string; value: ReactNode }[] }) {
  return (
    <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line">
      {items.map(f => (
        <div key={f.label} className="flex flex-col gap-0.5 bg-surface px-4 py-3">
          <span className="flex items-center gap-1.5 text-12 text-muted"><Icon name={f.icon} size={16} />{f.label}</span>
          <b className="text-14 font-medium tabular-nums">{f.value}</b>
        </div>
      ))}
    </div>
  );
}

export function Paper({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn(
      'relative overflow-hidden rounded-2xl border border-line bg-surface px-8 py-7 shadow-card',
      "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-14 after:bg-gradient-to-b after:from-transparent after:to-surface after:content-['']",
      className,
    )}>
      {children}
    </div>
  );
}

export function ScriptText({ size, className, children }: { size?: number; className?: string; children: ReactNode }) {
  const style: CSSProperties | undefined = size ? { fontSize: size, lineHeight: `${Math.round(size * 1.6)}px` } : undefined;
  return (
    <div style={style} className={cn(
      'max-w-[62ch] text-20 leading-8 tracking-[-0.005em]',
      '[&_p]:mb-3.5 [&_h4]:mb-1.5 [&_h4]:mt-[18px] [&_h4]:text-11 [&_h4]:font-semibold [&_h4]:uppercase [&_h4]:leading-4 [&_h4]:tracking-[.08em] [&_h4]:text-faint [&_h4:first-child]:mt-0',
      className,
    )}>
      {children}
    </div>
  );
}

export function Merge({ children }: { children: ReactNode }) {
  return <span className="mx-[-1px] rounded-[5px] bg-brand-soft px-[3px] font-bold text-brand-ink">{children}</span>;
}
