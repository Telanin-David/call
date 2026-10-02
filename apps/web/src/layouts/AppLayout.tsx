import { Link, Outlet, useMatches } from 'react-router-dom';
import { usePlan, PLAN_LABEL, type Plan } from '@/lib/plan';
import { useDeviceStore, useCallStore } from '@/lib/store';
import { formatUsd } from '@/lib/money';
import { BALANCE, ME } from '@/lib/fake';
import Icon from '@/components/Icon';

export type Section = 'today' | 'calling' | 'followups' | 'leads' | 'history';

export interface ShellHandle {
  section?: Section;
  onboarding?: boolean;
  device?: boolean;
  balance?: number;
  white?: boolean;
}

const NAV: { key: Section; to: string; label: string }[] = [
  { key: 'today', to: '/', label: 'Today' },
  { key: 'calling', to: '/call', label: 'Calling' },
  { key: 'followups', to: '/followups', label: 'Follow-ups' },
  { key: 'leads', to: '/leads', label: 'Leads' },
  { key: 'history', to: '/history', label: 'History' },
];

const PILL: Record<Plan, string> = { free: 'dl-pill', starter: 'dl-pill dl-pill--brand', pro: 'dl-pill dl-pill--lemon' };

function useShellHandle(): ShellHandle {
  const matches = useMatches();
  for (let i = matches.length - 1; i >= 0; i--) {
    const h = matches[i]?.handle;
    if (h && typeof h === 'object') return h as ShellHandle;
  }
  return {};
}

function DeviceChip({ plan }: { plan: Plan }) {
  const { talkVia: chosen, phoneLinked } = useDeviceStore();
  const talkVia = plan === 'free' ? 'computer' : chosen;
  const live = useCallStore(s => s.status === 'answered');
  if (talkVia === 'computer') {
    return (
      <button className="dl-device" type="button">
        <span className="ico"><Icon name="i-headset" size={16} /></span>
        {live
          ? <span>Talking on this laptop<small>Headset in the jack</small></span>
          : <span>Laptop sound ready<small>Mic and speaker</small></span>}
      </button>
    );
  }
  if (talkVia === 'phone' && phoneLinked) {
    return (
      <button className="dl-device" type="button" aria-label="Talking on your phone, Pixel 6a. Good signal">
        <span className="ico"><Icon name="i-phone" size={16} /></span>
        <span>Talking on your phone<small>Pixel 6a · good signal</small></span>
        <span className="dl-signal dl-signal--good"><i /><i /><i /></span>
      </button>
    );
  }
  return (
    <button className="dl-device dl-device--off" type="button" aria-label="No sound device yet. Choose how to talk">
      <span className="ico"><Icon name="i-phone" size={16} /></span>
      <span>Not connected<small>Choose how to talk</small></span>
    </button>
  );
}

export default function AppLayout() {
  const { plan } = usePlan();
  const handle = useShellHandle();
  const onboarding = handle.onboarding === true;

  return (
    <div className="dl-shell">
      <header className="dl-topbar">
        <Link to="/" className="dl-brand"><span className="dl-brand-mark" />Dialer</Link>
        {!onboarding && (
          <nav className="dl-nav" aria-label="Main">
            {NAV.map(n => (
              <Link key={n.key} to={n.to} aria-current={handle.section === n.key ? 'page' : undefined}>{n.label}</Link>
            ))}
          </nav>
        )}
        <span className="dl-grow" />
        {handle.device && <DeviceChip plan={plan} />}
        <span className={PILL[plan]}>{plan === 'free' ? 'Free plan' : PLAN_LABEL[plan]}</span>
        <div className="dl-money"><b>{formatUsd(handle.balance ?? BALANCE)}</b><span>Balance</span></div>
        {!onboarding && <Link to="/wallet" className="dl-btn dl-btn--outline">Top up</Link>}
        <Link to="/settings" className="dl-avatar" aria-label="Settings">{ME.initials}</Link>
      </header>
      <main className={`dl-shell-main${handle.white ? ' dl-shell-main--white' : ''}`}>
        <Outlet />
      </main>
    </div>
  );
}
