import type { ReactNode } from 'react';
import { cn } from './cn';

export type PillTone = 'neutral' | 'brand' | 'lemon' | 'success' | 'warn' | 'danger';

const PILL: Record<PillTone, string> = {
  neutral: 'bg-sunk text-muted',
  brand: 'bg-brand-soft text-brand-ink',
  lemon: 'bg-lemon text-on-lemon',
  success: 'bg-success-soft text-success-ink',
  warn: 'bg-warn-soft text-warn-ink',
  danger: 'bg-danger-soft text-danger-ink',
};

export function Pill({ tone = 'neutral', className, children }: { tone?: PillTone; className?: string; children: ReactNode }) {
  return (
    <span className={cn('inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-12 font-medium', PILL[tone], className)}>
      {children}
    </span>
  );
}

export type AvatarTone = 'a' | 'b' | 'c' | 'd' | 'e' | 'brand' | 'plain';
export type AvatarSize = 32 | 36 | 38 | 52;

const AV_TONE: Record<AvatarTone, string> = {
  a: 'bg-av-a text-av-a-fg',
  b: 'bg-av-b text-av-b-fg',
  c: 'bg-av-c text-av-c-fg',
  d: 'bg-av-d text-av-d-fg',
  e: 'bg-av-e text-av-e-fg',
  brand: 'bg-brand text-on-brand',
  plain: 'bg-sunk text-muted',
};

const AV_SIZE: Record<AvatarSize, string> = {
  32: 'size-8 text-11 font-bold',
  36: 'size-9 text-12 font-bold',
  38: 'size-[38px] text-12 font-bold',
  52: 'size-[52px] text-18 font-semibold',
};

export function Avatar({ initials, tone, size, className }: { initials: string; tone: AvatarTone; size: AvatarSize; className?: string }) {
  return (
    <span aria-hidden="true" className={cn('flex flex-none items-center justify-center rounded-full', AV_TONE[tone], AV_SIZE[size], className)}>
      {initials}
    </span>
  );
}

export type TileTone = 'brand' | 'lemon' | 'mint' | 'grey' | 'red' | 'done';
export type TileSize = 30 | 34 | 36 | 38 | 40;

const TILE_TONE: Record<TileTone, string> = {
  brand: 'bg-brand-soft text-brand-ink',
  lemon: 'bg-warn-soft text-warn-ink',
  mint: 'bg-success-soft text-success-ink',
  grey: 'bg-sunk text-muted',
  red: 'bg-danger-soft text-danger-ink',
  done: 'bg-success text-white',
};

const TILE_SIZE: Record<TileSize, string> = {
  30: 'size-[30px] rounded-md',
  34: 'size-[34px] rounded-md',
  36: 'size-9 rounded-md',
  38: 'size-[38px] rounded-lg',
  40: 'size-10 rounded-lg',
};

export function Tile({ tone, size = 40, className, children }: { tone: TileTone; size?: TileSize; className?: string; children: ReactNode }) {
  return <span className={cn('flex flex-none items-center justify-center', TILE_TONE[tone], TILE_SIZE[size], className)}>{children}</span>;
}

export type DotTone = 'neutral' | 'ok' | 'brand' | 'warn' | 'danger';

const DOT: Record<DotTone, string> = { neutral: 'bg-faint', ok: 'bg-success', brand: 'bg-brand', warn: 'bg-warn', danger: 'bg-danger' };

export function Dot({ tone = 'neutral', pulse }: { tone?: DotTone; pulse?: boolean }) {
  return <span aria-hidden="true" className={cn('inline-block size-2 flex-none rounded-full', DOT[tone], pulse && 'animate-ring')} />;
}

export function Signal({ bars }: { bars: 1 | 2 | 3 }) {
  const color = bars === 3 ? 'bg-success' : bars === 2 ? 'bg-warn' : 'bg-danger';
  return (
    <span className="ml-1 inline-flex h-3 items-end gap-0.5" aria-label={`Signal ${bars} of 3`}>
      {[5, 8, 12].map((h, i) => (
        <i key={h} className={cn('block w-[3px] rounded-[1px]', i < bars ? color : 'bg-line-strong', h === 5 ? 'h-[5px]' : h === 8 ? 'h-2' : 'h-3')} />
      ))}
    </span>
  );
}

export type BarTone = 'brand' | 'lemon' | 'ok';

const BAR: Record<BarTone, string> = { brand: 'bg-tangerine', lemon: 'bg-sun', ok: 'bg-success' };

export function Progress({ value, tone = 'brand', thick, className, label }: { value: number; tone?: BarTone; thick?: boolean; className?: string; label?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
      className={cn('overflow-hidden rounded-full bg-well', thick ? 'h-2' : 'h-1.5', className)}>
      <span className={cn('block h-full rounded-full', BAR[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}
