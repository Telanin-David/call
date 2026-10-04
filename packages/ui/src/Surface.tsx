import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

type DivProps = HTMLAttributes<HTMLElement> & { as?: 'div' | 'section' | 'aside' | 'nav' };

export function Card({ as: Tag = 'div', className, ...rest }: DivProps) {
  return <Tag className={cn('rounded-3xl border border-line bg-surface p-[22px] max-sm:p-[18px]', className)} {...rest} />;
}

export function CardHead({ title, children, className }: { title: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-1.5 flex items-center', className)}>
      <b className="flex-1 text-17">{title}</b>
      {children}
    </div>
  );
}

export function CardLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mb-3 text-12 font-extrabold uppercase tracking-[.06em] text-faint', className)}>{children}</div>;
}

const BLOBS = {
  hero: ['-right-[85px] -top-[120px] size-[170px]', 'right-[70px] top-3 size-4'],
  side: ['-right-[50px] -top-[60px] size-[150px]', 'right-[84px] top-[22px] size-5'],
  number: ['-right-[70px] -top-[95px] size-[150px]', 'right-[70px] top-3.5 size-[18px]'],
  plan: ['-right-[60px] -top-[70px] size-[170px]', 'right-24 top-[26px] size-6'],
} as const;

export type BlobLayout = keyof typeof BLOBS;

export function Blobs({ layout }: { layout: BlobLayout }) {
  const [big, dot] = BLOBS[layout];
  return (
    <>
      <span aria-hidden="true" className={cn('absolute rounded-full bg-tangerine', big)} />
      <span aria-hidden="true" className={cn('absolute rounded-full bg-sun', dot)} />
    </>
  );
}

export function DarkCard({ as: Tag = 'div', blobs = 'hero', className, children, ...rest }: DivProps & { blobs?: BlobLayout }) {
  return (
    <Tag className={cn('relative overflow-hidden rounded-3xl bg-night p-[26px] text-white max-sm:p-[22px]', className)} {...rest}>
      <Blobs layout={blobs} />
      <div className="relative">{children}</div>
    </Tag>
  );
}

export function DarkEyebrow({ children }: { children: ReactNode }) {
  return <div className="text-12 font-extrabold uppercase tracking-[.06em] text-zinc-400">{children}</div>;
}

type NoteTone = 'brand' | 'grey' | 'lemon' | 'success' | 'tint' | 'danger';

const NOTE: Record<NoteTone, string> = {
  brand: 'bg-brand-soft',
  grey: 'bg-sunk',
  lemon: 'bg-warn-soft',
  success: 'bg-success-soft',
  tint: 'bg-brand-tint',
  danger: 'bg-danger-soft text-danger-ink',
};

export function Note({ tone = 'grey', className, children }: { tone?: NoteTone; className?: string; children: ReactNode }) {
  return <div className={cn('flex items-center gap-3 rounded-xl px-3.5 py-3', NOTE[tone], className)}>{children}</div>;
}

export function Brand({ dark, className }: { dark?: boolean; className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5 text-16 font-semibold tracking-[-0.02em]', className)}>
      <span className="relative size-[26px] flex-none rounded-sm bg-brand">
        <span className={cn('absolute -right-[3px] -top-[3px] size-2.5 rounded-full border-2 bg-lemon', dark ? 'border-night' : 'border-surface')} />
      </span>
      Dialer
    </span>
  );
}
