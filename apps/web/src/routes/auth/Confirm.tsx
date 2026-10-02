import { Link, useNavigate } from 'react-router-dom';
import { AuthLeft } from '@/layouts/AuthLayout';
import Icon from '@/components/Icon';

export default function Confirm() {
  const navigate = useNavigate();

  return (
    <>
      <AuthLeft
        headline="Almost done. Two quick checks."
        bullets={['Confirm email', 'Confirm phone number']}
        step={2}
        steps={3}
      />
      <main style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48 }}>
        <div style={{ width: 420, display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div>
            <h1 className="dl-title">Confirm it's you</h1>
            <p className="dl-muted" style={{ marginTop: 6 }}>Two quick checks so leads only ever hear real people.</p>
          </div>

          {/* Email confirmed */}
          <div className="dl-card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span className="dl-tile dl-tile--done">
              <Icon name="i-check" size={16} />
            </span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>Email confirmed</div>
              <div className="dl-small dl-muted">tunde@example.com</div>
            </div>
          </div>

          {/* Phone code */}
          <div className="dl-field">
            <label>Phone code</label>
            <p className="dl-hint">We sent a 6-digit code to +234 801 234 5678</p>
            <div className="dl-codein" style={{ justifyContent: 'center', marginTop: 8 }}>
              {[0,1,2,3,4,5].map(i => (
                <span key={i} className={i === 0 ? 'is-active' : ''}>·</span>
              ))}
            </div>
          </div>

          <button className="dl-btn dl-btn--primary dl-btn--lg dl-btn--block" style={{ height: 52 }}
            onClick={() => navigate('/setup')}>
            Confirm
          </button>

          <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
            Send again in 0:42 · <button className="dl-link" style={{ fontSize: 13 }}>No SMS? Send by WhatsApp</button>
          </p>
          <p style={{ textAlign: 'center', fontSize: 14, color: 'var(--muted)' }}>
            <Link to="/signup" className="dl-link">← Back</Link>
          </p>
        </div>
      </main>
    </>
  );
}
