import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLeft } from '@/layouts/AuthLayout';

type Step = 'email' | 'code' | 'password';

export default function Forgot() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('email');
  const [show, setShow] = useState(false);

  return (
    <>
      <AuthLeft
        headline="Locked out? Back in two minutes."
        bullets={['Enter email or phone', 'Get a 6-digit code', 'Set a new password']}
      />
      <main style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48 }}>
        <div style={{ width: 420, display: 'flex', flexDirection: 'column', gap: 22 }}>
          {step === 'email' && (
            <>
              <div>
                <h1 className="dl-title">Reset your password</h1>
                <p className="dl-muted" style={{ marginTop: 6 }}>We'll send a 6-digit code to your phone.</p>
              </div>
              <div className="dl-field">
                <label>Email or phone</label>
                <input className="dl-input" placeholder="you@example.com or +234…" />
              </div>
              <button className="dl-btn dl-btn--primary dl-btn--lg dl-btn--block" style={{ height: 52 }}
                onClick={() => setStep('code')}>
                Send code
              </button>
            </>
          )}
          {step === 'code' && (
            <>
              <div>
                <h1 className="dl-title">Enter code</h1>
                <p className="dl-muted" style={{ marginTop: 6 }}>Sent to +234 801 234 5678</p>
              </div>
              <div className="dl-codein" style={{ justifyContent: 'center' }}>
                {[0,1,2,3,4,5].map(i => (
                  <span key={i} className={i === 0 ? 'is-active' : ''}>·</span>
                ))}
              </div>
              <button className="dl-btn dl-btn--primary dl-btn--lg dl-btn--block" style={{ height: 52 }}
                onClick={() => setStep('password')}>
                Verify
              </button>
              <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
                Send again in 0:42
              </p>
            </>
          )}
          {step === 'password' && (
            <>
              <div>
                <h1 className="dl-title">New password</h1>
                <p className="dl-muted" style={{ marginTop: 6 }}>Make it at least 10 characters.</p>
              </div>
              <div className="dl-field">
                <label>New password</label>
                <div style={{ position: 'relative' }}>
                  <input className="dl-input" type={show ? 'text' : 'password'} placeholder="At least 10 characters" style={{ paddingRight: 80 }} />
                  <button type="button" onClick={() => setShow(s => !s)}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 0, cursor: 'pointer', fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}>
                    {show ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              <button className="dl-btn dl-btn--primary dl-btn--lg dl-btn--block" style={{ height: 52 }}
                onClick={() => navigate('/signin')}>
                Save and sign in
              </button>
            </>
          )}
          <p style={{ textAlign: 'center', fontSize: 14, color: 'var(--muted)' }}>
            <Link to="/signin" className="dl-link">← Back to sign in</Link>
          </p>
        </div>
      </main>
    </>
  );
}
