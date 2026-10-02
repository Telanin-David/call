import { useNavigate } from 'react-router-dom';
import { usePlan } from '@/lib/plan';
import Icon from '@/components/Icon';

const followups = [
  { name: 'Sandra Mensah', role: 'Operations Director', company: 'Buildright Ltd', time: '9:00 am', outcome: 'Interested', avatar: 'SM', av: 'dl-av-c' },
  { name: 'James Obi', role: 'CEO', company: 'Obi Ventures', time: '10:30 am', outcome: 'Call back', avatar: 'JO', av: 'dl-av-a' },
  { name: 'Amara Diallo', role: 'Procurement Lead', company: 'Diallo & Co', time: '2:00 pm', outcome: 'Interested', avatar: 'AD', av: 'dl-av-b' },
  { name: 'Kofi Asante', role: 'Finance Manager', company: 'GoldCoast Capital', time: '4:00 pm', outcome: 'Call back', avatar: 'KA', av: 'dl-av-e' },
];

export default function Today() {
  const navigate = useNavigate();
  const { plan } = usePlan();

  const maxDials = plan === 'free' ? 30 : plan === 'starter' ? 120 : '∞';

  return (
    <div className="dl-page">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="dl-small dl-muted">Friday, 3 October 2025</div>
          <h1 className="dl-display" style={{ marginTop: 4 }}>Good morning, Tunde</h1>
          <div className="dl-small dl-muted" style={{ marginTop: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
            <Icon name="i-clock" size={13} />
            Your time 9:14 am · New York 3:14 am
          </div>
        </div>
      </div>

      {/* Top 2-col grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16 }}>
        {/* Ready to call dark card */}
        <div style={{ background: '#111113', color: '#fff', borderRadius: 20, padding: 28, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <span style={{ position: 'absolute', right: -60, top: -60, width: 260, height: 260, borderRadius: '50%', background: '#ff6b1a', opacity: .18 }} />
          <span style={{ position: 'absolute', right: 130, top: 40, width: 42, height: 42, borderRadius: '50%', background: '#ffd60a', opacity: .3 }} />
          <div style={{ position: 'relative' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: 'rgba(255,255,255,.5)', textTransform: 'uppercase', marginBottom: 10 }}>Ready to call</div>
            <div style={{ fontSize: 28, lineHeight: '34px', fontWeight: 700, letterSpacing: '-0.025em' }}>0 of {maxDials} dials today</div>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,.6)', marginTop: 6 }}>New York is 3:14 am — calls start at 8 am their time</div>
          </div>
          <div style={{ position: 'relative', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="dl-btn" style={{ background: '#ff6b1a', color: '#111113', fontWeight: 600, height: 44, borderRadius: 10 }}
              onClick={() => navigate('/call/1')}>
              <Icon name="i-call" size={16} />
              Start calling
            </button>
            <button className="dl-btn" style={{ background: 'rgba(255,255,255,.12)', color: '#fff', height: 44, borderRadius: 10 }}>
              <Icon name="i-list" size={16} />
              Pick a list
            </button>
          </div>
        </div>

        {/* Stats 2×2 grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {[
            { label: 'Dials', value: `0/${maxDials}`, sub: 'today' },
            { label: 'Talk time', value: '0m', sub: 'today' },
            { label: 'Spent', value: '$0.00', sub: 'today' },
            { label: 'Follow-ups due', value: '4', sub: 'today', highlight: true },
          ].map(s => (
            <div key={s.label} className="dl-card" style={{ background: s.highlight ? 'var(--brand-soft)' : undefined }}>
              <div className="dl-small dl-muted">{s.label}</div>
              <div style={{ fontSize: 28, lineHeight: '34px', fontWeight: 700, letterSpacing: '-0.025em', marginTop: 4, color: s.highlight ? 'var(--brand-ink)' : undefined }}>
                {s.value}
              </div>
              <div className="dl-small" style={{ color: s.highlight ? 'var(--brand-ink)' : 'var(--muted)', opacity: .75 }}>{s.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom 2-col grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Follow-ups due */}
        <div className="dl-card" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 className="dl-heading">Follow-ups due today</h2>
            <button className="dl-btn" style={{ height: 32, padding: '0 12px', fontSize: 13 }}
              onClick={() => navigate('/followups')}>
              See all
            </button>
          </div>
          {followups.map(f => (
            <div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
              <span className={`dl-avatar ${f.av}`} style={{ width: 36, height: 36, fontSize: 12 }}>{f.avatar}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{f.name}</div>
                <div className="dl-small dl-muted">{f.role} · {f.company}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={`dl-pill ${f.outcome === 'Interested' ? 'dl-pill--success' : 'dl-pill--brand'}`}>{f.outcome}</span>
                <button className="dl-btn dl-btn--primary" style={{ height: 32, padding: '0 12px', fontSize: 13 }}
                  onClick={() => navigate('/call/1')}>
                  <Icon name="i-call" size={14} />
                  Call
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Yesterday */}
          <div className="dl-card">
            <h2 className="dl-heading" style={{ marginBottom: 14 }}>Yesterday</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
              {[
                { label: 'Dials', value: '87' },
                { label: 'Talk time', value: '1h 24m' },
                { label: 'Spent', value: '$2.10' },
              ].map(s => (
                <div key={s.label}>
                  <div className="dl-small dl-muted">{s.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 2 }}>{s.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Numbers */}
          <div className="dl-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 className="dl-heading">Numbers</h2>
              <button className="dl-link" style={{ fontSize: 13 }}
                onClick={() => navigate('/numbers')}>
                Get another
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>+1 (212) 555-0147</div>
                  <div className="dl-small dl-muted">New York · renews Dec 1</div>
                </div>
                <span className="dl-dot dl-dot--ok" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
