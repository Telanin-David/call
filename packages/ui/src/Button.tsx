import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

export type ButtonVariant = 'secondary' | 'primary' | 'outline' | 'quiet' | 'danger' | 'lemon' | 'glass' | 'current';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

const VARIANT: Record<ButtonVariant, string> = {
  secondary: 'bg-sunk text-ink hover:bg-hover',
  primary: 'bg-brand text-on-brand font-semibold hover:bg-brand-hover',
  outline: 'bg-surface text-ink border-line hover:bg-sunk',
  quiet: 'bg-transparent text-brand-ink hover:bg-brand-soft',
  danger: 'bg-danger text-on-danger font-semibold hover:bg-danger-hover',
  lemon: 'bg-sun text-night font-bold hover:bg-[#f5cc00]',
  glass: 'bg-white/10 text-white hover:bg-white/15',
  current: 'bg-well text-ink-2 cursor-default',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-14 rounded-sm',
  md: 'h-10 px-4 text-14 rounded-sm',
  lg: 'h-12 px-[22px] text-15 rounded-md',
  xl: 'h-[52px] px-[22px] text-16 rounded-md',
};

export interface ButtonStyle {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  className?: string;
}

export function buttonClass({ variant = 'secondary', size = 'md', block, className }: ButtonStyle = {}): string {
  return cn(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap border border-transparent font-medium no-underline',
    'cursor-pointer transition-colors duration-150',
    'disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40',
    'aria-pressed:bg-ink aria-pressed:text-surface',
    SIZE[size], VARIANT[variant], block && 'w-full', className,
  );
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & ButtonStyle;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, block, className, type = 'button', ...rest }, ref,
) {
  return <button ref={ref} type={type} className={buttonClass({ variant, size, block, className })} {...rest} />;
});

export function Kbd({ children, onColor }: { children: string; onColor?: boolean }) {
  return (
    <span className={cn(
      'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border px-1 font-mono text-11 leading-4',
      onColor ? 'border-current bg-transparent text-inherit opacity-75' : 'border-line bg-surface text-muted',
    )}>
      {children}
    </span>
  );
}

export function LinkButton({ className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={cn(linkClass, className)} {...rest} />;
}

export const linkClass = 'cursor-pointer border-0 bg-transparent p-0 font-medium text-brand-ink no-underline hover:underline hover:underline-offset-3';
