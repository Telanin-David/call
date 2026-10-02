import type { ReactNode } from 'react';
import Icon from '@/components/Icon';

const FEATURES = [
  { icon: 'i-phone', title: 'Your phone is the headset', body: 'Your laptop shows the script and the buttons.' },
  { icon: 'i-wallet', title: 'Pay only for what you use', body: 'Top up from $5. No contract.' },
  { icon: 'i-check', title: 'Free never ends', body: 'Call by hand on Free for as long as you like.' },
] as const;

const SIGNUP_HEADLINE = 'Your list. Your script. Your first call in five minutes.';

interface AuthShellProps {
  headline?: string;
  signupStep?: { n: 1 | 2 | 3; label: string };
  children: ReactNode;
}

export default function AuthShell({ headline, signupStep, children }: AuthShellProps) {
  return (
    <div className="dl-auth">
      <aside className="dl-auth-side">
        <span className="dl-brand"><span className="dl-brand-mark" />Dialer</span>
        {signupStep ? (
          <>
            <div className="dl-auth-copy">
              <h1 className="dl-auth-h1">{SIGNUP_HEADLINE}</h1>
              <div className="dl-auth-feats">
                {FEATURES.map(f => (
                  <div key={f.title} className="dl-auth-feat">
                    <span><Icon name={f.icon} /></span>
                    <div><b>{f.title}</b><p>{f.body}</p></div>
                  </div>
                ))}
              </div>
            </div>
            <div className="dl-auth-steps">
              <div className="dl-auth-bars">
                {[1, 2, 3].map(i => <span key={i} className={i <= signupStep.n ? 'is-on' : undefined} />)}
              </div>
              <p>Step {signupStep.n} of 3 · {signupStep.label}</p>
            </div>
          </>
        ) : (
          <h1 className="dl-auth-copy dl-auth-h1">{headline}</h1>
        )}
      </aside>
      <main className="dl-auth-main">{children}</main>
    </div>
  );
}
