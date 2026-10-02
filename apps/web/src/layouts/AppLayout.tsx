import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { usePlan } from '@/lib/plan';
import Icon from '@/components/Icon';

const NAV = [
  { to: '/', label: 'Today' },
  { to: '/leads', label: 'Leads' },
  { to: '/scripts', label: 'Scripts' },
  { to: '/followups', label: 'Follow-ups' },
  { to: '/history', label: 'History' },
];

export default function AppLayout() {
  const { plan } = usePlan();
  const navigate = useNavigate();

  const planLabel = plan === 'free' ? 'Free' : plan === 'starter' ? 'Starter' : 'Pro';

  return (
    <div className="dl" style={{ minHeight: '100vh', background: 'var(--surface-sunk)', display: 'flex', flexDirection: 'column' }}>
      <header className="dl-topbar">
        <NavLink to="/" className="dl-brand" style={{ textDecoration: 'none', color: 'var(--ink)' }}>
          <span className="dl-brand-mark" />
          Dialer
        </NavLink>
        <nav className="dl-nav">
          {NAV.map(n => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              aria-current={undefined}
              className={({ isActive }) => isActive ? 'dl-nav-link is-active' : 'dl-nav-link'}
              style={({ isActive }) => ({
                height: 36, display: 'inline-flex', alignItems: 'center', padding: '0 12px',
                borderRadius: 8, fontSize: 14, fontWeight: 500, textDecoration: 'none',
                color: isActive ? 'var(--ink)' : 'var(--muted)',
                background: isActive ? 'var(--surface-sunk)' : 'transparent',
              })}
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className={`dl-pill ${plan === 'free' ? '' : plan === 'starter' ? 'dl-pill--warn' : 'dl-pill--success'}`}>
            {planLabel}
          </span>
          <div className="dl-money">
            <b>$24.51</b>
            <span>balance</span>
          </div>
          <button className="dl-btn dl-btn--primary" style={{ height: 34, padding: '0 14px', fontSize: 13 }}
            onClick={() => navigate('/wallet')}>
            Top up
          </button>
          <button className="dl-avatar" style={{ border: 0, cursor: 'pointer' }} aria-label="Account settings"
            onClick={() => navigate('/settings')}>
            TU
          </button>
        </div>
      </header>
      <main style={{ flex: 1 }}>
        <Outlet />
      </main>
    </div>
  );
}
