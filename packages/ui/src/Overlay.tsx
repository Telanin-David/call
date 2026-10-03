import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from './cn';
import { Icon } from './icons/Icon';

/**
 * Dialog over a dimmed page. Centred on wide screens; anchored to the bottom
 * edge on phones so the actions sit under the thumb. Escape and the backdrop
 * close it; focus moves into the dialog and returns when it closes.
 */
export function Modal({ open, onClose, title, label, width = 'md', bare, className, children }: {
  open: boolean;
  onClose: () => void;
  /** Visible heading. Omit and pass `label` when the content has its own. */
  title?: ReactNode;
  label?: string;
  width?: 'sm' | 'md' | 'lg';
  /** No padding or close button: the content draws its own layout. */
  bare?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      before?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-night/45 sm:items-center sm:p-6" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panel} role="dialog" aria-modal="true" tabIndex={-1}
        aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : label}
        className={cn(
          'relative max-h-[92dvh] w-full overflow-auto rounded-t-3xl bg-surface text-ink shadow-[0_24px_60px_rgba(0,0,0,.25)] outline-none sm:rounded-3xl',
          width === 'sm' ? 'sm:max-w-[460px]' : width === 'md' ? 'sm:max-w-[540px]' : 'sm:max-w-[780px]',
          !bare && 'px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-6 sm:px-[30px] sm:pb-[30px] sm:pt-[30px]',
          className,
        )}>
        {!bare && (
          <button type="button" aria-label="Close" onClick={onClose}
            className="absolute right-4 top-4 flex size-9 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-muted hover:bg-sunk hover:text-ink sm:right-5 sm:top-5">
            <Icon name="x" size={18} />
          </button>
        )}
        {title && <h2 id={titleId} className="pr-10 text-24 font-extrabold tracking-[-0.03em] sm:text-28">{title}</h2>}
        {children}
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, className }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; className?: string;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-10 flex-none cursor-pointer items-center rounded-full border-0 bg-off p-0.5 transition-colors aria-checked:bg-tangerine',
        "after:block after:size-5 after:rounded-full after:bg-white after:shadow-[0_1px_3px_rgba(0,0,0,.2)] after:transition-transform after:content-[''] aria-checked:after:translate-x-4",
        className,
      )} />
  );
}

interface ToastCtx { show: (message: string) => void }
const ToastContext = createContext<ToastCtx>({ show: () => {} });

/** Short confirmation at the bottom of the screen ("Script saved"). One at a time, gone after 3 seconds. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 3000);
    return () => clearTimeout(t);
  }, [message, key]);
  const show = useCallback((m: string) => { setMessage(m); setKey(k => k + 1); }, []);
  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(80px+env(safe-area-inset-bottom))] z-50 flex justify-center px-4 lg:bottom-8">
        {message && (
          <span key={key} className="flex items-center gap-2 rounded-full bg-night px-4 py-2.5 text-14 font-semibold text-white shadow-[0_10px_30px_rgba(0,0,0,.25)]">
            <Icon name="check" size={16} className="text-success" />{message}
          </span>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (message: string) => void {
  return useContext(ToastContext).show;
}
