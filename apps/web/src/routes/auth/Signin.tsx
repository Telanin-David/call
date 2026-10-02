import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLeft } from '@/layouts/AuthLayout';

export default function Signin() {
  const navigate = useNavigate();
  const [show, setShow] = useState(false);

  return (
    <>
      <AuthLeft
        headline="Welcome back. Your leads are waiting."
        bullets={['Auto-dial your list hands-free', 'Script always on screen', 'Call from anywhere']}
      />
      <main style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48 }}>
        <div style={{ width: 420, display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div>
            <h1 className="dl-title">Sign in</h1>
            <p className="dl-muted" style={{ marginTop: 6 }}>Good to see you again.</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="dl-field">
              <label>Email or phone</label>
              <input className="dl-input" placeholder="you@example.com" />
            </div>
            <div className="dl-field">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label>Password</label>
                <Link to="/forgot" className="dl-link" style={{ fontSize: 13 }}>Forgot?</Link>
              </div>
              <div style={{ position: 'relative' }}>
                <input className="dl-input" type={show ? 'text' : 'password'} placeholder="••••••••••" style={{ paddingRight: 80 }} />
                <button
                  type="button"
                  onClick={() => setShow(s => !s)}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 0, cursor: 'pointer', fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}
                >
                  {show ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
          </div>
          <label className="dl-check">
            <input type="checkbox" defaultChecked />
            <span>Keep me signed in on this laptop</span>
          </label>
          <button className="dl-btn dl-btn--primary dl-btn--lg dl-btn--block" style={{ height: 52 }}
            onClick={() => navigate('/')}>
            Sign in
          </button>
          <p style={{ textAlign: 'center', fontSize: 14, color: 'var(--muted)' }}>
            New here? <Link to="/signup" className="dl-link">Create an account</Link>
          </p>
        </div>
      </main>
    </>
  );
}
