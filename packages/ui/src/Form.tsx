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

/** A labelled control. `error` replaces the hint and is announced. */
export function Field({ label, htmlFor, hint, error, end, className, children }: {
  label: string; htmlFor?: string; hint?: ReactNode; error?: string; end?: ReactNode; className?: string; children: ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between">
        <label htmlFor={htmlFor} className="text-13 font-medium text-ink">{label}</label>
        {end}
      </div>
      {children}
      {error
        ? <span role="alert" className="text-13 font-medium text-danger-ink">{error}</span>
        : hint && <span className="text-13 text-muted">{hint}</span>}
    </div>
  );
}

export function PasswordInput({ defaultValue = '', ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input type={shown ? 'text' : 'password'} defaultValue={defaultValue} {...rest} />
      <button type="button" className={cn(linkClass, 'absolute right-3 top-3 text-13')} onClick={() => setShown(s => !s)}>
        {shown ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

/** Six boxes showing a code. `decorative` hides them from screen readers when a real input speaks for them. */
export function CodeBoxes({ digits, size = 'lg', decorative }: { digits: string; size?: 'md' | 'lg'; decorative?: boolean }) {
  return (
    <div className="flex gap-2 sm:gap-2.5" {...(decorative ? { 'aria-hidden': true } : { 'aria-label': '6-digit code' })}>
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className={cn(
          'flex min-w-0 max-w-[54px] flex-1 items-center justify-center rounded-md border border-transparent bg-sunk font-mono font-semibold text-ink',
          size === 'lg' ? 'h-14 text-24 sm:h-16 sm:text-[26px]' : 'h-[52px] text-22 sm:h-[60px] sm:text-24',
          i === digits.length && 'border-2 border-brand bg-surface',
        )}>
          {digits[i] ?? ''}
        </span>
      ))}
    </div>
  );
}

/**
 * Six digit boxes you can type into. A real (invisible) input sits on top,
 * so paste, the phone's one-time-code suggestion and screen readers work.
 */
export function CodeInput({ value, onChange, size = 'lg', id, label = '6-digit code', autoFocus }: {
  value: string; onChange: (code: string) => void; size?: 'md' | 'lg'; id?: string; label?: string; autoFocus?: boolean;
}) {
  return (
    <div className="relative">
      <CodeBoxes digits={value} size={size} decorative />
      <input id={id} name="code" aria-label={label} autoFocus={autoFocus} value={value}
        inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6}
        onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        className="absolute inset-0 size-full cursor-text opacity-0" />
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
    <div role="tablist" className="flex gap-1.5 max-sm:-mx-4 max-sm:overflow-x-auto max-sm:px-4 max-sm:py-px max-sm:[scrollbar-width:none]">
      {tabs.map(t => (
        <button key={t.value} role="tab" type="button" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className="group inline-flex h-[38px] flex-none cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3.5 text-14 font-semibold text-ink-2 aria-selected:border-night aria-selected:bg-night aria-selected:font-bold aria-selected:text-white">
          {t.label}
          <i className="rounded-[8px] bg-well px-[7px] py-px text-12 not-italic leading-4 text-muted group-aria-selected:bg-tangerine group-aria-selected:text-night">{t.count}</i>
        </button>
      ))}
    </div>
  );
}
