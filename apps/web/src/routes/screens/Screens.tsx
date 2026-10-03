import { useNavigate } from 'react-router-dom';
import { Brand, Icon, Pill } from '@dialer/ui';
import { PLAN_LABEL, usePlan, type Plan } from '@/lib/plan';
import { useSimStore, type Sim } from '@/lib/sim';

interface Entry { name: string; to: string; plan?: Plan; sim?: Sim; note?: string }

const GROUPS: { title: string; items: Entry[] }[] = [
  {
    title: 'Sign up and get started',
    items: [
      { name: 'Sign in', to: '/signin' },
      { name: 'Create account', to: '/signup' },
      { name: 'Check your email', to: '/check-email' },
      { name: 'Confirm email and phone', to: '/confirm' },
      { name: 'Reset password', to: '/forgot' },
      { name: 'Setup checklist and add money', to: '/setup' },
      { name: 'Get a number', to: '/numbers' },
      { name: 'Upload leads', to: '/leads/upload?from=setup' },
      { name: 'Match columns', to: '/leads/upload?from=setup&step=match' },
      { name: 'Write your script', to: '/scripts?from=setup' },
      { name: 'The rules', to: '/rules' },
    ],
  },
  {
    title: 'Every day',
    items: [
      { name: 'Today', to: '/' },
      { name: 'Follow-ups', to: '/followups' },
      { name: 'Leads', to: '/leads' },
      { name: 'History', to: '/history' },
      { name: 'Call recording and transcript', to: '/history/ada', plan: 'pro' },
      { name: 'Wallet', to: '/wallet' },
      { name: 'Settings', to: '/settings' },
      { name: 'Compare plans', to: '/plans' },
      { name: 'Verify your ID', to: '/verify', note: 'Click through: photo, face check, done' },
    ],
  },
  {
    title: 'Calling',
    items: [
      { name: 'Ready to call on Free', to: '/call', plan: 'free' },
      { name: 'Ready to call on Starter', to: '/call', plan: 'starter' },
      { name: 'Ready to call on Pro', to: '/call', plan: 'pro' },
      { name: 'On a call (Starter)', to: '/call', plan: 'starter', sim: 'oncall' },
      { name: 'On a call (Pro, recorded)', to: '/call', plan: 'pro', sim: 'oncall' },
      { name: 'After a call: How did it go?', to: '/call', plan: 'pro', sim: 'wrapup', note: 'Phone layout: open on a phone or make the window narrow' },
      { name: 'Scan with your phone', to: '/call', plan: 'starter', sim: 'pairing' },
      { name: 'Upgrade to Starter', to: '/call', plan: 'free', sim: 'upgrade' },
      { name: 'Upgrade to Pro', to: '/call', plan: 'starter', sim: 'upgrade' },
      { name: 'Script locked after free months', to: '/call', plan: 'free', sim: 'script' },
      { name: 'Lead calls you back', to: '/call', plan: 'starter', sim: 'callback' },
      { name: 'Move to Free', to: '/settings', plan: 'starter', sim: 'movefree' },
    ],
  },
  {
    title: 'Blocked before a call',
    items: [
      { name: 'Daily limit hit', to: '/call', plan: 'starter', sim: 'limit' },
      { name: 'Balance too low', to: '/call', plan: 'starter', sim: 'balance' },
      { name: 'Same number, 3 tries', to: '/call', plan: 'starter', sim: 'tries' },
      { name: 'Do-not-call number', to: '/call', plan: 'starter', sim: 'dnc' },
    ],
  },
  {
    title: 'Problems during a call',
    items: [
      { name: 'Internet dropped', to: '/call', plan: 'starter', sim: 'internet' },
      { name: 'Phone dropped', to: '/call', plan: 'starter', sim: 'phone' },
      { name: 'Mic blocked', to: '/call', plan: 'starter', sim: 'mic' },
      { name: 'Weak connection', to: '/call', plan: 'starter', sim: 'weak' },
    ],
  },
  {
    title: 'On the phone, linked to a laptop',
    items: [
      { name: 'Use with laptop (phone side)', to: '/link', note: 'Click through: scan, allow mic, linked, test call' },
    ],
  },
];

/** Dev page: every screen and state in one list, one click each. */
export default function Screens() {
  const navigate = useNavigate();
  const { setPlan } = usePlan();
  const setSim = useSimStore(s => s.setSim);

  function open(e: Entry) {
    if (e.plan) setPlan(e.plan);
    setSim(e.sim ?? null);
    navigate(e.to);
  }

  return (
    <div className="min-h-dvh bg-sunk">
      <div className="mx-auto flex max-w-[960px] flex-col gap-6 px-4 pb-16 pt-[max(24px,env(safe-area-inset-top))] sm:px-6">
        <div className="flex items-center gap-3">
          <Brand />
          <Pill>Preview</Pill>
        </div>
        <div>
          <h1 className="text-28 font-extrabold tracking-[-0.03em] sm:text-36">All screens</h1>
          <p className="mt-1 text-15 text-muted">
            Click any screen to open it. The Dev button at the top of every page switches plan and brings you back here.
            Fake data only: nothing is charged and no one is called.
          </p>
        </div>
        {GROUPS.map(g => (
          <section key={g.title} aria-label={g.title}>
            <h2 className="mb-2 text-12 font-extrabold uppercase tracking-[.06em] text-faint">{g.title}</h2>
            <ul className="grid list-none gap-2 sm:grid-cols-2">
              {g.items.map(e => (
                <li key={`${e.name}-${e.plan ?? ''}`}>
                  <button type="button" onClick={() => open(e)}
                    className="flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left text-ink hover:border-brand">
                    <span className="min-w-0 flex-1">
                      <b className="block text-15">{e.name}</b>
                      {e.note && <span className="block text-13 text-muted">{e.note}</span>}
                    </span>
                    {e.plan && <Pill tone={e.plan === 'pro' ? 'lemon' : e.plan === 'starter' ? 'brand' : 'neutral'}>{PLAN_LABEL[e.plan]}</Pill>}
                    <Icon name="right" size={16} className="text-faint" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
