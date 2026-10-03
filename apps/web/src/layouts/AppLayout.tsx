import { Link, Outlet, useMatches } from 'react-router-dom';
import { Brand, Icon, Pill, Signal, buttonClass, cn, type PillTone } from '@dialer/ui';
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

const NAV: { key: Section; to: string; label: string }[] = [
  { key: 'today', to: '/', label: 'Today' },
  { key: 'calling', to: '/call', label: 'Calling' },
  { key: 'followups', to: '/followups', label: 'Follow-ups' },
  { key: 'leads', to: '/leads', label: 'Leads' },
  { key: 'history', to: '/history', label: 'History' },
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
      className={cn('inline-flex h-[42px] cursor-pointer items-center gap-2.5 rounded-full border-0 pl-1.5 pr-4 text-left text-13 font-semibold',
        ready ? 'bg-success-soft text-success-ink' : 'bg-warn-soft text-warn-ink')}>
      <span className={cn('flex size-[30px] flex-none items-center justify-center rounded-full', ready ? 'bg-success text-white' : 'bg-lemon text-on-lemon')}>
        <Icon name={talkVia === 'computer' ? 'headset' : 'phone'} size={16} />
      </span>
      <span>{title}<small className="block text-11 leading-[14px] font-medium opacity-85">{sub}</small></span>
      {ready && talkVia === 'phone' && <Signal bars={3} />}
    </button>
  );
}

export default function AppLayout() {
  const { plan } = usePlan();
  const handle = useShellHandle();
  const onboarding = handle.onboarding === true;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-[60px] flex-none items-center gap-4 border-b border-line bg-surface px-7">
        <Link to="/" className="text-ink no-underline"><Brand /></Link>
        {!onboarding && (
          <nav className="ml-5 flex gap-0.5" aria-label="Main">
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
        <Pill tone={PLAN_PILL[plan]} className="h-7">{plan === 'free' ? 'Free plan' : PLAN_LABEL[plan]}</Pill>
        <div className="flex flex-col items-end leading-none">
          <b className="text-15 font-semibold tabular-nums">{formatUsd(handle.balance ?? BALANCE)}</b>
          <span className="mt-[3px] text-11 text-muted">Balance</span>
        </div>
        {!onboarding && <Link to="/wallet" className={buttonClass({ variant: 'outline' })}>Top up</Link>}
        <Link to="/settings" aria-label="Settings"
          className="flex size-[34px] items-center justify-center rounded-full bg-warn-soft text-13 font-semibold text-warn-ink no-underline">
          {ME.initials}
        </Link>
      </header>
      <main className={cn('min-h-0 flex-1 overflow-auto', handle.white ? 'bg-surface' : 'bg-sunk')}>
        <Outlet />
      </main>
    </div>
  );
}
