import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '@/components/Icon';

const AMOUNTS = [5, 10, 20, 50];

export default function Setup() {
  const navigate = useNavigate();
  const [amount, setAmount] = useState(10);

  const steps = [
    { label: 'Confirm email and phone', done: true },
    { label: 'Agree to the rules', done: true },
    { label: 'Add money to your balance', active: true },
    { label: 'Get a US or Canada number' },
    { label: 'Upload a list of leads' },
    { label: 'Add a calling script' },
  ];

  return (
    <div className="dl" style={{ minHeight: '100vh', background: 'var(--surface-sunk)' }}>
      {/* Minimal topbar */}
      <header className="dl-topbar">
        <span className="dl-brand" style={{ color: 'var(--ink)' }}>
          <span className="dl-brand-mark" />
          Dialer
        </span>
        <span className="dl-pill" style={{ marginLeft: 'auto' }}>Free plan</span>
        <button className="dl-avatar" style={{ border: 0, background: 'var(--warn-soft)', color: 'var(--warn-ink)', cursor: 'pointer' }}>TU</button>
      </header>

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '40px 28px', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 28 }}>
        {/* Left: checklist */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div>
            <h1 className="dl-title">Set up your account</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <div className="dl-progress" style={{ flex: 1 }}>
                <span style={{ width: '33%' }} />
              </div>
              <span className="dl-small dl-muted">2 of 6 done · about 4 minutes left</span>
            </div>
          </div>

          <div className="dl-steps">
            {steps.map((s, i) => (
              <div key={i} className={`dl-step ${s.done ? 'is-done' : (s as any).active ? 'is-now' : 'is-todo'}`}>
                <i>
                  {s.done
                    ? <Icon name="i-check" size={13} />
                    : i + 1}
                </i>
                <span style={{ fontWeight: (s as any).active ? 600 : undefined }}>{s.label}</span>
              </div>
            ))}
          </div>

          {/* Step 3 expanded */}
          <div className="dl-card">
            <h3 className="dl-heading" style={{ marginBottom: 16 }}>Add money to your balance</h3>
            <div className="dl-amounts" style={{ marginBottom: 16 }}>
              {AMOUNTS.map(a => (
                <button key={a} className={`dl-chip ${amount === a ? '' : ''}`}
                  aria-pressed={amount === a}
                  onClick={() => setAmount(a)}
                  style={{ height: 48, justifyContent: 'center', borderRadius: 10, fontSize: 15 }}>
                  ${a}
                </button>
              ))}
            </div>
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="dl-price"><span>Balance top-up</span><b>${amount.toFixed(2)}</b></div>
              <div className="dl-price"><span>Card fee (3.5%)</span><b>${(amount * 0.035).toFixed(2)}</b></div>
              <div className="dl-price" style={{ fontWeight: 600 }}><span>Total charged</span><b>${(amount * 1.035).toFixed(2)}</b></div>
            </div>
            <button className="dl-btn dl-btn--primary dl-btn--lg dl-btn--block" style={{ marginTop: 16 }}
              onClick={() => navigate('/numbers')}>
              Add ${(amount * 1.035).toFixed(2)} by card
            </button>
          </div>
        </div>

        {/* Right: plan card */}
        <div style={{ position: 'sticky', top: 24 }}>
          <div className="dl-plan">
            <div>
              <div className="dl-label">Free plan</div>
              <div className="dl-plan-price">$0 <span style={{ fontSize: 16, fontWeight: 400, letterSpacing: 0 }}>/mo</span></div>
            </div>
            <ul>
              <li><span className="dl-tick"><Icon name="i-check" size={11} /></span>30 dials per day</li>
              <li><span className="dl-tick"><Icon name="i-check" size={11} /></span>Tap to call each lead</li>
              <li><span className="dl-tick"><Icon name="i-check" size={11} /></span>Script on screen (first 2 months)</li>
              <li><span className="dl-tick"><Icon name="i-check" size={11} /></span>US and Canada numbers</li>
            </ul>
            <div className="dl-plan-later">
              Upgrade to Starter: <b>$10/mo</b> for 3 months, then $15.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
