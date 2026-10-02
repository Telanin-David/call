import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLeft } from '@/layouts/AuthLayout';

export default function Signup() {
  const navigate = useNavigate();
  const [show, setShow] = useState(false);

  return (
    <>
      <AuthLeft
        headline="Create an account. Start calling in minutes."
        bullets={['Free plan — no card needed', 'US and Canada numbers from $1.50/mo', 'Auto-dial on Starter and Pro']}
        step={1}
        steps={3}
      />
      <main style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48 }}>
        <div style={{ width: 420, display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div>
            <h1 className="dl-title">Create your account</h1>
            <p className="dl-muted" style={{ marginTop: 6 }}>Free to start. No card needed.</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="dl-field">
              <label>Full name</label>
              <input className="dl-input" placeholder="Tunde Okafor" />
              <span className="dl-hint">Use the name on your ID</span>
            </div>
            <div className="dl-field">
              <label>Email</label>
              <input className="dl-input" type="email" placeholder="you@example.com" />
            </div>
            <div className="dl-field">
              <label>Phone</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <select className="dl-select" style={{ width: 100, flex: 'none' }}>
                  <option>🇳🇬 +234</option>
                  <option>🇬🇭 +233</option>
                  <option>🇰🇪 +254</option>
                  <option>🇺🇸 +1</option>
                </select>
                <input className="dl-input" type="tel" placeholder="801 234 5678" />
              </div>
            </div>
            <div className="dl-field">
              <label>Password</label>
              <div style={{ position: 'relative' }}>
                <input className="dl-input" type={show ? 'text' : 'password'} placeholder="At least 10 characters" style={{ paddingRight: 80 }} />
                <button
                  type="button"
                  onClick={() => setShow(s => !s)}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 0, cursor: 'pointer', fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}
                >
                  {show ? 'Hide' : 'Show'}
                </button>
              </div>
              <span className="dl-hint">10 characters minimum</span>
            </div>
          </div>
          <label className="dl-check">
            <input type="checkbox" />
            <span>I agree to the rules and terms. One account per person.</span>
          </label>
          <button className="dl-btn dl-btn--primary dl-btn--lg dl-btn--block" style={{ height: 52 }}
            onClick={() => navigate('/confirm')}>
            Create account
          </button>
          <p style={{ textAlign: 'center', fontSize: 14, color: 'var(--muted)' }}>
            Have an account? <Link to="/signin" className="dl-link">Sign in</Link>
          </p>
        </div>
      </main>
    </>
  );
}
