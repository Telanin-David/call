import { useNavigate } from 'react-router-dom';
import { usePlan, type Plan } from '@/lib/plan';
import Icon from '@/components/Icon';

const PLANS = [
  {
    id: 'free' as Plan,
    name: 'Free',
    price: '$0',
    period: 'forever',
    later: null,
    features: [
      '30 dials per day',
      'Tap to call each lead',
      'Script on screen (first 2 months)',
      'US and Canada numbers from $1.50/mo',
      'Calling from browser',
    ],
    unavailable: ['Auto-dial', 'Phone and laptop linked', 'Callback alerts', 'Recording + transcripts'],
  },
  {
    id: 'starter' as Plan,
    name: 'Starter',
    price: '$10',
    period: '/mo',
    later: 'then $15/mo',
    features: [
      '120 dials per day (500 after ID check)',
      'Auto-dial your list',
      'Script always on screen',
      'Phone and laptop linked',
      'Callback alerts',
      'US and Canada numbers from $1.50/mo',
    ],
    unavailable: ['Recording + transcripts', 'Multi-dial (2 lines)'],
  },
  {
    id: 'pro' as Plan,
    name: 'Pro',
    price: '$21',
    period: '/mo',
    later: 'then $35/mo',
    features: [
      'No dial limit',
      'Auto-dial your list',
      'Script always on screen',
      'Phone and laptop linked',
      'Callback alerts',
      'Recording + transcripts (90 days)',
      'Multi-dial (2 lines, after ID check + approval)',
    ],
    unavailable: [],
  },
];

export default function ComparePlans() {
  const navigate = useNavigate();
  const { plan, setPlan } = usePlan();

  return (
    <div className="dl-page" style={{ maxWidth: 1120 }}>
      <div>
        <button className="dl-link" onClick={() => navigate(-1)} style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name="i-left" size={13} />
          Back
        </button>
      </div>
      <div>
        <h1 className="dl-title">Pick your plan</h1>
        <p className="dl-muted" style={{ marginTop: 6 }}>Intro pricing for your first 3 months. Change or cancel any time.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}>
        {PLANS.map(p => {
          const isCurrent = plan === p.id;
          return (
            <div key={p.id} className="dl-plan" style={{
              borderColor: isCurrent ? 'var(--brand)' : p.id === 'starter' ? 'var(--brand)' : undefined,
              boxShadow: isCurrent ? '0 0 0 1px var(--brand)' : p.id === 'starter' && !isCurrent ? '0 0 0 1px var(--brand)' : undefined,
            }}>
              {p.id === 'starter' && !isCurrent && (
                <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', background: 'var(--brand)', color: 'var(--on-brand)', padding: '3px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
                  Most popular
                </div>
              )}
              {isCurrent && (
                <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', background: 'var(--success)', color: '#fff', padding: '3px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
                  Current plan
                </div>
              )}
              <div>
                <div className="dl-label">{p.name}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 8 }}>
                  <span className="dl-plan-price">{p.price}</span>
                  <span style={{ fontSize: 14, color: 'var(--muted)' }}>{p.period}</span>
                </div>
                {p.later && (
                  <div className="dl-plan-later" style={{ marginTop: 10 }}>{p.later}</div>
                )}
              </div>
              <ul>
                {p.features.map(f => (
                  <li key={f}><span className="dl-tick"><Icon name="i-check" size={11} /></span>{f}</li>
                ))}
                {p.unavailable.map(f => (
                  <li key={f} style={{ opacity: .4 }}>
                    <span style={{ width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none', marginTop: 1 }}>—</span>
                    {f}
                  </li>
                ))}
              </ul>
              <button
                className={isCurrent ? 'dl-btn dl-btn--outline dl-btn--block' : 'dl-btn dl-btn--primary dl-btn--block dl-btn--lg'}
                disabled={isCurrent}
                aria-disabled={isCurrent}
                onClick={() => { setPlan(p.id); navigate('/'); }}
                style={{ marginTop: 'auto' }}>
                {isCurrent ? 'Current plan' : `Switch to ${p.name}`}
              </button>
            </div>
          );
        })}
      </div>

      <div className="dl-card dl-card--sunk" style={{ textAlign: 'center', fontSize: 14, color: 'var(--muted)' }}>
        All prices in USD. Call rates: Free ~$0.025/min · Starter ~$0.020/min · Pro ~$0.017/min. <br />
        Minimum balance: $0. No hidden fees.
      </div>
    </div>
  );
}
