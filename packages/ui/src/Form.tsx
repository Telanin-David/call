import { forwardRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cn } from './cn';
import { linkClass } from './Button';

const control = 'h-11 w-full rounded-sm border border-line-strong bg-surface px-3 text-15 text-ink placeholder:text-faint';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(control, className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...rest }, ref) {
  return <select ref={ref} className={cn(control, className)} {...rest} />;
});

export function Field({ label, htmlFor, hint, end, className, children }: {
  label: string; htmlFor?: string; hint?: ReactNode; end?: ReactNode; className?: string; children: ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between">
        <label htmlFor={htmlFor} className="text-13 font-medium text-ink">{label}</label>
        {end}
      </div>
      {children}
      {hint && <span className="text-13 text-muted">{hint}</span>}
    </div>
  );
}

export function PasswordInput({ id, defaultValue = '' }: { id?: string; defaultValue?: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input id={id} type={shown ? 'text' : 'password'} defaultValue={defaultValue} />
      <button type="button" className={cn(linkClass, 'absolute right-3 top-3 text-13')} onClick={() => setShown(s => !s)}>
        {shown ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

export function CodeBoxes({ digits, size = 'lg' }: { digits: string; size?: 'md' | 'lg' }) {
  return (
    <div className="flex gap-2.5" aria-label="6-digit code">
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className={cn(
          'flex w-[54px] items-center justify-center rounded-md border border-transparent bg-sunk font-mono font-semibold text-ink',
          size === 'lg' ? 'h-16 text-[26px]' : 'h-[60px] text-24',
          i === digits.length && 'border-2 border-brand bg-surface',
        )}>
          {digits[i] ?? ''}
        </span>
      ))}
    </div>
  );
}

export function Checkbox({ children, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { children: ReactNode }) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-3 text-14 leading-5 text-ink-2', className)}>
      <input type="checkbox" className="mt-px size-5 flex-none accent-brand" {...rest} />
      <span>{children}</span>
    </label>
  );
}

export function Chip({ pressed, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { pressed?: boolean }) {
  return (
    <button type="button" aria-pressed={pressed}
      className={cn(
        'inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full border border-transparent bg-sunk px-3.5 text-14 font-medium text-ink hover:bg-hover',
        'aria-pressed:border-brand aria-pressed:bg-brand-soft aria-pressed:text-brand-ink',
        className,
      )}
      {...rest}
    />
  );
}

export function AmountPicker<T extends number>({ amounts, value, onChange, format, dark }: {
  amounts: readonly T[]; value: T; onChange: (v: T) => void; format: (v: T) => string; dark?: boolean;
}) {
  return (
    <div className="grid grid-cols-4 gap-2" role="group" aria-label="Amount">
      {amounts.map(a => (
        <Chip key={a} pressed={value === a} onClick={() => onChange(a)}
          className={cn('h-12 rounded-md text-15', dark && 'bg-white/8 text-white hover:bg-white/15 aria-pressed:bg-[#fff1e6] aria-pressed:text-[#c2410c]')}>
          {format(a)}
        </Chip>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label, className }: {
  options: readonly { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string; className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn('inline-grid grid-cols-2 gap-[3px] rounded-lg bg-hover p-[3px]', className)}>
      {options.map(o => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}
          className="h-[38px] cursor-pointer rounded-[9px] border-0 bg-transparent text-14 font-semibold text-muted aria-pressed:bg-surface aria-pressed:font-bold aria-pressed:text-ink aria-pressed:shadow-[0_2px_6px_rgba(0,0,0,.08)]">
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TabPills<T extends string>({ tabs, value, onChange }: {
  tabs: readonly { value: T; label: string; count: number }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1.5">
      {tabs.map(t => (
        <button key={t.value} role="tab" type="button" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className="group inline-flex h-[38px] cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3.5 text-14 font-semibold text-ink-2 aria-selected:border-night aria-selected:bg-night aria-selected:font-bold aria-selected:text-white">
          {t.label}
          <i className="rounded-[8px] bg-well px-[7px] py-px text-12 not-italic leading-4 text-muted group-aria-selected:bg-tangerine group-aria-selected:text-night">{t.count}</i>
        </button>
      ))}
    </div>
  );
}
