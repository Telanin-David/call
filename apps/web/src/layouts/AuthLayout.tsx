import { Outlet } from 'react-router-dom';

interface AuthLayoutProps {
  headline?: string;
  bullets?: string[];
  step?: number;
  steps?: number;
  children?: React.ReactNode;
}

export function AuthLeft({ headline, bullets, step, steps }: Omit<AuthLayoutProps, 'children'>) {
  return (
    <aside style={{
      position: 'relative', overflow: 'hidden', background: '#111113', color: '#fff',
      padding: '48px 56px', display: 'flex', flexDirection: 'column', gap: 24,
    }}>
      <span style={{
        position: 'absolute', right: -120, bottom: -140,
        width: 420, height: 420, borderRadius: '50%', background: '#ff6b1a',
      }} />
      <span style={{
        position: 'absolute', right: 240, bottom: 170,
        width: 46, height: 46, borderRadius: '50%', background: '#ffd60a',
      }} />
      <div className="dl-brand" style={{ position: 'relative', color: '#fff', fontSize: 18 }}>
        <span className="dl-brand-mark" style={{ '--surface': '#111113' } as React.CSSProperties} />
        Dialer
      </div>
      {headline && (
        <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 24 }}>
          <h1 style={{ fontSize: 36, lineHeight: '42px', fontWeight: 700, letterSpacing: '-0.025em', maxWidth: '14ch' }}>
            {headline}
          </h1>
          {bullets && (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {bullets.map((b, i) => (
                <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, opacity: .85 }}>
                  <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(255,255,255,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flex: 'none' }}>✓</span>
                  {b}
                </li>
              ))}
            </ul>
          )}
          {step !== undefined && steps !== undefined && (
            <div style={{ display: 'flex', gap: 6 }}>
              {Array.from({ length: steps }, (_, i) => (
                <span key={i} style={{
                  height: 3, flex: 1, borderRadius: 2,
                  background: i < step ? '#ff6b1a' : 'rgba(255,255,255,.2)',
                }} />
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

export default function AuthLayout() {
  return (
    <div className="dl" style={{ height: '100vh', display: 'grid', gridTemplateColumns: '600px minmax(0,1fr)' }}>
      <Outlet />
    </div>
  );
}
