import { Link, Navigate, Outlet, useLocation, useMatches } from 'react-router-dom';
import { Brand, Icon, Pill, Signal, buttonClass, cn, type IconName, type PillTone } from '@dialer/ui';
import { usePlan, PLAN_LABEL, type Plan } from '@/lib/plan';
import { useDeviceStore, useCallStore } from '@/lib/store';
import { formatUsd } from '@/lib/money';
import { BALANCE, ME } from '@/lib/fake';
import { homeFor, useMe } from '@/lib/account';
import { ApiError } from '@/lib/api';
import { isLive } from '@/lib/backend';
import { IncomingCallAlert } from '@/components/IncomingCallAlert';

export type Section = 'today' | 'calling' | 'followups' | 'leads' | 'history';

export interface ShellHandle {
  section?: Section;
  onboarding?: boolean;
  device?: boolean;
  balance?: number;
  white?: boolean;
  /** Readable without an account (live mode), e.g. the rules. */
  public?: boolean;
}

const NAV: { key: Section; to: string; label: string; icon: IconName }[] = [
  { key: 'today', to: '/', label: 'Today', icon: 'sun' },
  { key: 'calling', to: '/call', label: 'Calling', icon: 'call' },
  { key: 'followups', to: '/followups', label: 'Follow-ups', icon: 'callback' },
  { key: 'leads', to: '/leads', label: 'Leads', icon: 'list' },
  { key: 'history', to: '/history', label: 'History', icon: 'history' },
];

const PLAN_PILL: Record<Plan, PillTone> = { free: 'neutral', starter: 'brand', pro: 'lemon' };

function useShellHandle(): ShellHandle {
  const matches = useMatches();
  for (let i = matches.length - 1; i >= 0; i--) {
    const h = matches[i]?.handle;
    if (h && typeof h === 'object') return h as ShellHandle;
  }
  return {};
}

function DeviceChip({ plan }: { plan: Plan }) {
  const { talkVia: chosen, phoneLinked, phoneName } = useDeviceStore();
  const talkVia = plan === 'free' ? 'computer' : chosen;
  const live = useCallStore(s => s.status === 'answered');
  const ready = talkVia === 'computer' || (talkVia === 'phone' && phoneLinked);
  const [title, sub] = talkVia === 'computer'
    ? (live ? ['Talking on this laptop', 'Headset in the jack'] : ['Laptop sound ready', 'Mic and speaker'])
    : ready ? ['Talking on your phone', isLive() ? `${phoneName || 'Your phone'} · linked` : 'Pixel 6a · good signal'] : ['Not connected', isLive() ? 'Link your phone again' : 'Choose how to talk'];

  return (
    <button type="button" aria-label={`${title}. ${sub}`}
      className={cn('inline-flex h-9 flex-none cursor-pointer items-center gap-2.5 rounded-full border-0 pl-1 pr-1 text-left text-13 font-semibold xl:pr-4',
        ready ? 'bg-success-soft text-success-ink' : 'bg-warn-soft text-warn-ink')}>
      <span className={cn('flex size-7 flex-none items-center justify-center rounded-full', ready ? 'bg-success text-white' : 'bg-lemon text-on-lemon')}>
        <Icon name={talkVia === 'computer' ? 'headset' : 'phone'} size={16} />
      </span>
      <span className="max-xl:hidden">{title}<small className="block text-11 leading-[14px] font-medium opacity-85">{sub}</small></span>
      {ready && talkVia === 'phone' && <span className="max-xl:hidden"><Signal bars={3} /></span>}
    </button>
  );
}

export default function AppLayout() {
  const { plan } = usePlan();
  const handle = useShellHandle();
  const onboarding = handle.onboarding === true;
  const me = useMe();
  const { pathname } = useLocation();

  // Live: the app is for signed-in, confirmed reps only.
  if (isLive()) {
    if (me.isPending) return <div className="flex h-dvh items-center justify-center bg-sunk text-15 text-muted" role="status">Loading…</div>;
    if (me.error instanceof ApiError && me.error.status === 401) {
      if (handle.public) {
        return (
          <div className="fixed inset-0 flex flex-col">
            <header className="flex h-[calc(3.5rem+env(safe-area-inset-top))] flex-none items-center border-b border-line bg-surface px-4 pt-[env(safe-area-inset-top)] lg:h-[60px] lg:px-7">
              <Link to="/signup" className="text-ink no-underline"><Brand /></Link>
            </header>
            <main className="relative min-h-0 flex-1 overflow-auto overscroll-contain bg-sunk"><Outlet /></main>
          </div>
        );
      }
      return <Navigate to="/signin" replace state={{ from: pathname }} />;
    }
    if (me.error) {
      return (
        <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-sunk px-4 text-center" role="alert">
          <p className="text-15 text-muted">{me.error.message}</p>
          <button type="button" className={buttonClass({ variant: 'outline' })} onClick={() => void me.refetch()}>Try again</button>
        </div>
      );
    }
    if (me.data && homeFor(me.data) !== '/') return <Navigate to={homeFor(me.data)} replace />;
  }
  const balance = me.data ? me.data.balance_microdollars : (handle.balance ?? BALANCE);
  const name = me.data ? me.data.name : ME.name;

  return (
    // Pinned to the screen: only <main> scrolls, so the header and the bottom
    // bar never move, whatever a page contains or the phone's address bar does.
    <div className="fixed inset-0 flex flex-col">
      <header className="flex h-[calc(3.5rem+env(safe-area-inset-top))] flex-none items-center gap-3 border-b border-line bg-surface px-4 pt-[env(safe-area-inset-top)] sm:gap-4 lg:h-[60px] lg:px-7">
        <Link to="/" className="text-ink no-underline"><Brand /></Link>
        {!onboarding && (
          <nav className="ml-5 flex gap-0.5 max-lg:hidden" aria-label="Main">
            {NAV.map(n => (
              <Link key={n.key} to={n.to} aria-current={handle.section === n.key ? 'page' : undefined}
                className="inline-flex h-9 items-center rounded-sm px-3 text-14 font-medium text-muted no-underline aria-[current=page]:bg-sunk aria-[current=page]:text-ink">
                {n.label}
              </Link>
            ))}
          </nav>
        )}
        <span className="flex-1" />
        {handle.device && <span className="hidden md:contents"><DeviceChip plan={plan} /></span>}
        {/* Everything on the right is one height (36px) on one centre line. */}
        <div className="flex flex-none items-center gap-2.5 sm:gap-3">
          <Pill tone={PLAN_PILL[plan]} className="h-9 px-3.5 text-13 max-sm:hidden">{plan === 'free' ? 'Free plan' : PLAN_LABEL[plan]}</Pill>
          <Link to="/wallet" aria-label={`Wallet balance ${formatUsd(balance)}`}
            className="flex h-9 flex-none items-center gap-2 rounded-full border border-line bg-sunk pl-1 pr-3.5 text-ink no-underline hover:border-brand">
            <span className="flex size-7 items-center justify-center rounded-full bg-surface text-brand-ink"><Icon name="wallet" size={18} /></span>
            <b className="text-14 font-semibold leading-none tabular-nums">{formatUsd(balance)}</b>
          </Link>
          {!onboarding && <Link to="/wallet" className={cn(buttonClass({ variant: 'outline' }), 'h-9 max-sm:hidden')}>Top up</Link>}
          <Link to="/settings" aria-label="Profile and settings" title={name}
            className="flex size-9 flex-none items-center justify-center rounded-full border border-line bg-sunk text-ink-2 no-underline hover:border-brand hover:text-brand-ink">
            <Icon name="user" size={20} />
          </Link>
        </div>
      </header>
      {/* relative: absolutely placed bits (screen-reader labels) stay inside the scroll area. */}
      <main className={cn('relative min-h-0 flex-1 overflow-auto overscroll-contain', handle.white ? 'bg-surface' : 'bg-sunk')}>
        <Outlet />
      </main>
      {isLive() && <IncomingCallAlert />}
      {!onboarding && (
        <nav aria-label="Main" className="grid flex-none grid-cols-5 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
          {NAV.map(n => (
            <Link key={n.key} to={n.to} aria-current={handle.section === n.key ? 'page' : undefined}
              className="flex h-14 flex-col items-center justify-center gap-0.5 text-11 font-semibold text-muted no-underline aria-[current=page]:text-brand-ink">
              <Icon name={n.icon} size={20} />{n.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
