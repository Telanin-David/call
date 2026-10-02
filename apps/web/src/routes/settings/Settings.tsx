import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlan } from '@/lib/plan';
import Icon from '@/components/Icon';

type Section = 'account' | 'billing' | 'numbers' | 'calling' | 'verify' | 'rules';

const NAV: { key: Section; label: string }[] = [
  { key: 'account', label: 'Account' },
  { key: 'billing', label: 'Plan and billing' },
  { key: 'numbers', label: 'Numbers' },
  { key: 'calling', label: 'Calling' },
  { key: 'verify', label: 'Verify your ID' },
  { key: 'rules', label: 'Rules' },
];

export default function Settings() {
  const navigate = useNavigate();
  const { plan } = usePlan();
  const [section, setSection] = useState<Section>('billing');
  const [lowAlert, setLowAlert] = useState(true);

  return (
    <div className="dl-page" style={{ maxWidth: 1120 }}>
      <h1 className="dl-title">Settings</h1>
      <div style={{ display: 'grid', gridTemplateColumns: '240px minmax(0,1fr)', gap: 24 }}>
        {/* Sidebar */}
        <aside>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {NAV.map(n => (
              <button key={n.key}
                onClick={() => setSection(n.key)}
                style={{
                  textAlign: 'left', padding: '10px 14px', borderRadius: 8, border: 0, cursor: 'pointer',
                  fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: section === n.key ? 600 : 400,
                  background: section === n.key ? 'var(--brand-soft)' : 'transparent',
                  color: section === n.key ? 'var(--brand-ink)' : 'var(--ink)',
                }}>
                {n.label}
              </button>
            ))}
          </div>
        </aside>

        {/* Content */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {section === 'account' && (
            <div className="dl-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h2 className="dl-heading">Account details</h2>
              <div className="dl-field">
                <label>Full name</label>
                <input className="dl-input" defaultValue="Tunde Okafor" />
              </div>
              <div className="dl-field">
                <label>Email</label>
                <input className="dl-input" type="email" defaultValue="tunde@example.com" />
              </div>
              <div className="dl-field">
                <label>Phone</label>
                <input className="dl-input" type="tel" defaultValue="+234 801 234 5678" />
              </div>
              <button className="dl-btn dl-btn--primary" style={{ alignSelf: 'flex-start' }}>Save changes</button>
            </div>
          )}

          {section === 'billing' && (
            <>
              {/* Plan card */}
              <div style={{ background: '#111113', color: '#fff', borderRadius: 20, padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: 'rgba(255,255,255,.5)', textTransform: 'uppercase', marginBottom: 6 }}>Current plan</div>
                    <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' }}>
                      {plan === 'free' ? 'Free' : plan === 'starter' ? 'Starter' : 'Pro'}
                    </div>
                    {plan !== 'free' && (
                      <div style={{ fontSize: 14, color: 'rgba(255,255,255,.55)', marginTop: 4 }}>
                        {plan === 'starter' ? '$10/mo for first 3 months, then $15/mo' : '$21/mo for first 3 months, then $35/mo'}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="dl-btn" style={{ background: 'rgba(255,255,255,.12)', color: '#fff', height: 36 }}
                      onClick={() => navigate('/plans')}>
                      See Pro
                    </button>
                    <button className="dl-btn" style={{ background: '#ff6b1a', color: '#111113', fontWeight: 600, height: 36 }}
                      onClick={() => navigate('/plans')}>
                      Change plan
                    </button>
                  </div>
                </div>
                {plan !== 'free' && (
                  <div style={{ borderTop: '1px solid rgba(255,255,255,.1)', paddingTop: 16, display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                    <span style={{ color: 'rgba(255,255,255,.6)' }}>Next charge</span>
                    <span>$10.00 on Nov 1, 2025</span>
                  </div>
                )}
              </div>

              <div className="dl-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <h2 className="dl-heading">Billing</h2>
                <div className="dl-price"><span>Plan charges paid from</span><b>Balance</b></div>
                <label className="dl-switch">
                  <input type="checkbox" checked={lowAlert} onChange={e => setLowAlert(e.target.checked)} />
                  <span>Low balance alert at $5.00</span>
                </label>
                {plan !== 'free' && (
                  <button className="dl-link" style={{ alignSelf: 'flex-start', color: 'var(--danger-ink)', fontSize: 14 }}>
                    Move to Free plan
                  </button>
                )}
              </div>
            </>
          )}

          {section === 'numbers' && (
            <div className="dl-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 className="dl-heading">Your numbers</h2>
                <button className="dl-btn dl-btn--primary" style={{ height: 34, padding: '0 14px', fontSize: 13 }}
                  onClick={() => navigate('/numbers')}>
                  + Get another
                </button>
              </div>
              {[
                { number: '+1 (212) 555-0147', location: 'New York, NY', renews: 'Nov 1, 2025', active: true },
              ].map(n => (
                <div key={n.number} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', fontSize: 15 }}>{n.number}</div>
                    <div className="dl-small dl-muted">{n.location} · renews {n.renews}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="dl-dot dl-dot--ok" />
                    <button className="dl-link" style={{ fontSize: 13, color: 'var(--danger-ink)' }}>Release</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {section === 'calling' && (
            <div className="dl-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h2 className="dl-heading">Calling preferences</h2>
              <div className="dl-field">
                <label>Default outbound number</label>
                <select className="dl-select"><option>+1 (212) 555-0147 · New York</option></select>
              </div>
              <label className="dl-switch">
                <input type="checkbox" defaultChecked />
                <span>Show script on calling screen</span>
              </label>
              <label className="dl-switch">
                <input type="checkbox" defaultChecked />
                <span>Auto-dial the next lead after 5 seconds</span>
              </label>
              <button className="dl-btn dl-btn--primary" style={{ alignSelf: 'flex-start' }}>Save</button>
            </div>
          )}

          {section === 'verify' && (
            <div className="dl-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h2 className="dl-heading">Verify your ID</h2>
              <p className="dl-muted">Verifying your ID increases your daily dial limit from 25 to 120 on Starter and removes restrictions on Pro.</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: 'var(--surface-sunk)', borderRadius: 12 }}>
                <Icon name="i-id" size={20} />
                <div>
                  <div style={{ fontWeight: 600 }}>Government ID</div>
                  <div className="dl-small dl-muted">Passport, national ID, or driver's licence</div>
                </div>
                <button className="dl-btn dl-btn--primary" style={{ marginLeft: 'auto', height: 34, padding: '0 14px', fontSize: 13 }}>
                  Start
                </button>
              </div>
            </div>
          )}

          {section === 'rules' && (
            <div className="dl-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h2 className="dl-heading">Dialing rules</h2>
              {[
                'Each number can be called at most 3 times',
                'Premium-rate numbers (900, 976, etc.) are never dialled',
                'DNC numbers are skipped silently',
                'Calls outside US and Canada have a $3/day cap until ID is verified',
                'One account per person — the card name must match the account name',
              ].map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, paddingBottom: 10, borderBottom: '1px solid var(--line)' }}>
                  <span className="dl-tick"><Icon name="i-shield" size={11} /></span>
                  {r}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
