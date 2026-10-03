import type { ReactNode } from 'react';
import { cn } from './cn';
import { Avatar, type AvatarSize, type AvatarTone } from './Badge';

export function List({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('overflow-hidden rounded-3xl border border-line bg-surface', className)}>{children}</div>;
}

export function ListRow({ cols, head, alert, className, children }: {
  cols: string; head?: boolean; alert?: boolean; className?: string; children: ReactNode;
}) {
  return (
    <div role="row" className={cn(
      'flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-4 py-3.5 lg:grid lg:gap-4 lg:px-5',
      head && 'border-t-0 py-3 text-12 font-extrabold uppercase tracking-[.05em] text-faint max-lg:hidden',
      alert && 'bg-danger-tint',
      cols, className,
    )}>
      {children}
    </div>
  );
}

export function Person({ initials, tone, size = 38, name, sub, className }: {
  initials: string; tone: AvatarTone; size?: AvatarSize; name: string; sub: ReactNode; className?: string;
}) {
  const small = size === 32;
  return (
    <div className={cn('flex min-w-0 items-center', small ? 'gap-2.5' : 'gap-3', className)}>
      <Avatar initials={initials} tone={tone} size={size} />
      <div className="min-w-0">
        <b className={small ? 'text-14' : 'text-15'}>{name}</b>
        <p className={cn('text-muted', small ? 'text-12' : 'text-13')}>{sub}</p>
      </div>
    </div>
  );
}

export function Stat({ label, value, suffix }: { label: string; value: ReactNode; suffix?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-[18px] py-4">
      <span className="text-13 text-muted">{label}</span>
      <b className="mt-0.5 block text-28 font-extrabold tracking-[-0.03em]">
        {value}{suffix && <small className="text-15 font-semibold text-faint">{suffix}</small>}
      </b>
    </div>
  );
}

export function Kpis({ items, className }: { items: { label: string; value: ReactNode; good?: boolean }[]; className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 gap-3.5 text-13 text-muted', className)}>
      {items.map(k => (
        <div key={k.label}>
          {k.label}
          <b className={cn('block text-22 leading-[22px] font-extrabold', k.good ? 'text-success-ink' : 'text-ink')}>{k.value}</b>
        </div>
      ))}
    </div>
  );
}

export function PriceRow({ label, value, total, muted, className }: {
  label: ReactNode; value: ReactNode; total?: boolean; muted?: boolean; className?: string;
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 py-1.5 text-14', total && 'border-t border-line pt-2.5', className)}>
      <span className={cn(muted && 'text-muted', total && 'font-bold')}>{label}</span>
      <b className={cn('font-semibold tabular-nums', total && 'text-18')}>{value}</b>
    </div>
  );
}

export function PageHeader({ eyebrow, title, lede, back, aside, size = 'md', className }: {
  eyebrow?: string; title: ReactNode; lede?: ReactNode; back?: ReactNode; aside?: ReactNode; size?: 'md' | 'xl'; className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-start gap-4 sm:flex-row sm:items-end', className)}>
      <div className="min-w-0 flex-1">
        {back}
        {eyebrow && <div className="mb-1 text-13 font-bold uppercase tracking-[.04em] text-faint">{eyebrow}</div>}
        <h1 className={cn('font-extrabold tracking-[-0.04em]', size === 'xl' ? 'text-32 md:text-44' : 'text-28 md:text-36')}>{title}</h1>
        {lede && <p className={cn('text-muted', size === 'xl' ? 'max-w-[620px] pt-2.5 text-16 leading-[24px] md:text-17 md:leading-[26px]' : 'pt-2 text-15 md:text-16')}>{lede}</p>}
      </div>
      {aside && <div className="flex flex-wrap items-center gap-[inherit]">{aside}</div>}
    </div>
  );
}
