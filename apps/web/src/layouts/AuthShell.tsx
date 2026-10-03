import type { ReactNode } from 'react';
import { Brand, Icon, cn, type IconName } from '@dialer/ui';

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: 'phone', title: 'Your phone is the headset', body: 'Your laptop shows the script and the buttons.' },
  { icon: 'wallet', title: 'Pay only for what you use', body: 'Top up from $5. No contract.' },
  { icon: 'check', title: 'Free never ends', body: 'Call by hand on Free for as long as you like.' },
];

const SIGNUP_HEADLINE = 'Your list. Your script. Your first call in five minutes.';
const headline = 'text-44 font-extrabold tracking-[-0.04em]';

interface AuthShellProps {
  headline?: string;
  signupStep?: { n: 1 | 2 | 3; label: string };
  children: ReactNode;
}

export default function AuthShell({ headline: title, signupStep, children }: AuthShellProps) {
  return (
    <div className="grid min-h-screen grid-cols-[600px_minmax(0,1fr)]">
      <aside className="relative flex flex-col overflow-hidden bg-night px-14 py-12 text-white">
        <span aria-hidden="true" className="absolute -bottom-[140px] -right-[120px] size-[420px] rounded-full bg-tangerine" />
        <span aria-hidden="true" className="absolute bottom-[170px] right-60 size-[46px] rounded-full bg-sun" />
        <Brand dark className="relative text-18" />
        {signupStep ? (
          <>
            <div className="relative max-w-[440px] pt-24">
              <h1 className={headline}>{SIGNUP_HEADLINE}</h1>
              <div className="mt-10 flex flex-col gap-[22px]">
                {FEATURES.map(f => (
                  <div key={f.title} className="flex items-start gap-3.5">
                    <span className="flex size-[38px] flex-none items-center justify-center rounded-lg bg-white/8 text-glow"><Icon name={f.icon} /></span>
                    <div>
                      <b className="block text-16 font-bold">{f.title}</b>
                      <p className="text-14 text-zinc-400">{f.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="relative mt-auto max-w-[300px]">
              <div className="flex gap-1.5">
                {[1, 2, 3].map(i => <span key={i} className={cn('h-1 flex-1 rounded-sm', i <= signupStep.n ? 'bg-tangerine' : 'bg-white/14')} />)}
              </div>
              <p className="pt-2.5 text-13 text-zinc-400">Step {signupStep.n} of 3 · {signupStep.label}</p>
            </div>
          </>
        ) : (
          <h1 className={cn(headline, 'relative max-w-[440px] pt-24')}>{title}</h1>
        )}
      </aside>
      <main className="flex items-center justify-center p-12">{children}</main>
    </div>
  );
}

export function AuthForm({ wide, onSubmit, children }: { wide?: boolean; onSubmit?: () => void; children: ReactNode }) {
  return (
    <form className={cn('flex flex-col', wide ? 'w-[440px] gap-[26px]' : 'w-[420px] gap-[22px]')}
      onSubmit={e => { e.preventDefault(); onSubmit?.(); }}>
      {children}
    </form>
  );
}

export function AuthTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <h2 className="text-32 font-extrabold tracking-[-0.035em]">{title}</h2>
      <p className="pt-2 text-15 text-muted">{sub}</p>
    </div>
  );
}

export function AuthFoot({ children }: { children: ReactNode }) {
  return <p className="text-center text-14 text-muted">{children}</p>;
}
