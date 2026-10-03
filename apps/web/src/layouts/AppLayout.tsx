import { Link, Outlet, useMatches } from 'react-router-dom';
import { Brand, Icon, Pill, Signal, buttonClass, cn, type IconName, type PillTone } from '@dialer/ui';
import { usePlan, PLAN_LABEL, type Plan } from '@/lib/plan';
import { useDeviceStore, useCallStore } from '@/lib/store';
import { formatUsd } from '@/lib/money';
import { BALANCE, ME } from '@/lib/fake';

export type Section = 'today' | 'calling' | 'followups' | 'leads' | 'history';

export interface ShellHandle {
  section?: Section;
  onboarding?: boolean;
  device?: boolean;
  balance?: number;
  white?: boolean;
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
  const { talkVia: chosen, phoneLinked } = useDeviceStore();
  const talkVia = plan === 'free' ? 'computer' : chosen;
  const live = useCallStore(s => s.status === 'answered');
  const ready = talkVia === 'computer' || (talkVia === 'phone' && phoneLinked);
  const [title, sub] = talkVia === 'computer'
    ? (live ? ['Talking on this laptop', 'Headset in the jack'] : ['Laptop sound ready', 'Mic and speaker'])
    : ready ? ['Talking on your phone', 'Pixel 6a · good signal'] : ['Not connected', 'Choose how to talk'];

  return (
    <button type="button" aria-label={`${title}. ${sub}`}
      className={cn('inline-flex h-[42px] flex-none cursor-pointer items-center gap-2.5 rounded-full border-0 pl-1.5 pr-1.5 text-left text-13 font-semibold xl:pr-4',
        ready ? 'bg-success-soft text-success-ink' : 'bg-warn-soft text-warn-ink')}>
      <span className={cn('flex size-[30px] flex-none items-center justify-center rounded-full', ready ? 'bg-success text-white' : 'bg-lemon text-on-lemon')}>
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

  return (
    <div className="flex h-dvh flex-col">
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
        {handle.device && <DeviceChip plan={plan} />}
        <Pill tone={PLAN_PILL[plan]} className="h-7 max-sm:hidden">{plan === 'free' ? 'Free plan' : PLAN_LABEL[plan]}</Pill>
        <Link to="/wallet" aria-label="Wallet" className="flex flex-col items-end leading-none text-ink no-underline">
          <b className="text-15 font-semibold tabular-nums">{formatUsd(handle.balance ?? BALANCE)}</b>
          <span className="mt-[3px] text-11 text-muted">Balance</span>
        </Link>
        {!onboarding && <Link to="/wallet" className={cn(buttonClass({ variant: 'outline' }), 'max-sm:hidden')}>Top up</Link>}
        <Link to="/settings" aria-label="Settings"
          className="flex size-[34px] flex-none items-center justify-center rounded-full bg-warn-soft text-13 font-semibold text-warn-ink no-underline">
          {ME.initials}
        </Link>
      </header>
      <main className={cn('min-h-0 flex-1 overflow-auto', handle.white ? 'bg-surface' : 'bg-sunk')}>
        <Outlet />
      </main>
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
