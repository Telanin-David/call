import { useState } from 'react';
import { usePlan } from '@/lib/plan';
import Icon from '@/components/Icon';

const AMOUNTS = [10, 20, 50, 100];

const ACTIVITY = [
  { date: 'Oct 3', desc: 'Top-up by card', amount: '+$20.00', positive: true },
  { date: 'Oct 3', desc: 'Call to +1 (212) 555-0147', amount: '-$0.08', positive: false },
  { date: 'Oct 2', desc: 'Call to +1 (212) 555-0147', amount: '-$0.12', positive: false },
  { date: 'Oct 2', desc: 'Call to +1 (212) 555-0147', amount: '-$0.05', positive: false },
  { date: 'Oct 1', desc: 'Starter plan — monthly', amount: '-$10.00', positive: false },
  { date: 'Oct 1', desc: 'Number renewal: +1 (212) 555-0147', amount: '-$1.50', positive: false },
  { date: 'Sep 29', desc: 'Top-up by card', amount: '+$50.00', positive: true },
  { date: 'Sep 28', desc: 'Call to +1 (646) 555-0120', amount: '-$0.21', positive: false },
];

export default function Wallet() {
  const { plan } = usePlan();
  const [amount, setAmount] = useState(20);

  const rateLabel = plan === 'free' ? 'Free plan · ~$0.025/min' : plan === 'starter' ? 'Starter · ~$0.020/min' : 'Pro · ~$0.017/min';
  const minutesLeft = Math.floor(24510000 / (plan === 'free' ? 25 : plan === 'starter' ? 20 : 17));

  return (
    <div className="dl-page">
      <h1 className="dl-title">Wallet</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '420px minmax(0,1fr)', gap: 24, alignItems: 'start' }}>
        {/* Left */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Balance card */}
          <div style={{ background: '#111113', color: '#fff', borderRadius: 20, padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: 'rgba(255,255,255,.5)', textTransform: 'uppercase', marginBottom: 8 }}>Balance</div>
              <div style={{ fontSize: 52, lineHeight: '56px', fontWeight: 700, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums' }}>$24.51</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,.55)', marginTop: 6 }}>
                About {minutesLeft.toLocaleString()} minutes at {rateLabel}
              </div>
            </div>
            <div className="dl-amounts" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
              {AMOUNTS.map(a => (
                <button key={a}
                  onClick={() => setAmount(a)}
                  style={{
                    height: 48, borderRadius: 10, border: 0, cursor: 'pointer',
                    background: amount === a ? '#ff6b1a' : 'rgba(255,255,255,.1)',
                    color: amount === a ? '#111113' : '#fff',
                    fontWeight: 600, fontSize: 15, fontFamily: 'var(--font-sans)',
                  }}>
                  ${a}
                </button>
              ))}
            </div>
            <button style={{ background: '#ff6b1a', color: '#111113', fontWeight: 700, height: 52, borderRadius: 12, border: 0, cursor: 'pointer', fontSize: 16, fontFamily: 'var(--font-sans)' }}>
              Add ${amount.toFixed(2)} by card
            </button>
          </div>

          {/* Low balance alert */}
          <div className="dl-banner dl-banner--lemon" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Icon name="i-spark" size={16} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Low balance alert at $5.00</div>
              <div className="dl-small dl-muted">We'll email you when balance drops below $5</div>
            </div>
            <button className="dl-link" style={{ marginLeft: 'auto', fontSize: 13, whiteSpace: 'nowrap' }}>Change</button>
          </div>
        </div>

        {/* Right */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Spending chart */}
          <div className="dl-card">
            <h3 className="dl-heading" style={{ marginBottom: 16 }}>Spending this month</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { label: 'Calls', pct: 62, amount: '$8.20', color: '#ff6b1a' },
                { label: plan === 'free' ? 'Free plan' : plan === 'starter' ? 'Starter plan' : 'Pro plan', pct: 34, amount: '$4.50', color: '#ffd60a' },
                { label: 'Number', pct: 4, amount: '$1.50', color: '#12b76a' },
              ].map(s => (
                <div key={s.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                    <span>{s.label}</span>
                    <span style={{ fontWeight: 600 }}>{s.amount} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{s.pct}%</span></span>
                  </div>
                  <div className="dl-progress" style={{ height: 8 }}>
                    <span style={{ width: `${s.pct}%`, background: s.color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Activity */}
          <div className="dl-card">
            <h3 className="dl-heading" style={{ marginBottom: 12 }}>Activity</h3>
            <table className="dl-table">
              <thead>
                <tr>
                  <th>DATE</th>
                  <th>DESCRIPTION</th>
                  <th className="r">AMOUNT</th>
                </tr>
              </thead>
              <tbody>
                {ACTIVITY.map((a, i) => (
                  <tr key={i}>
                    <td className="dl-small dl-muted dl-num" style={{ whiteSpace: 'nowrap' }}>{a.date}</td>
                    <td style={{ fontSize: 14 }}>{a.desc}</td>
                    <td className="r dl-num" style={{ fontWeight: 600, color: a.positive ? 'var(--success-ink)' : 'var(--ink)' }}>
                      {a.amount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
