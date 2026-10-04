import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Blobs, Button, Icon, Modal, Note, PageHeader, Pill, cn, useToast, type ButtonVariant, type PillTone } from '@dialer/ui';
import { UpgradeDialog } from '@/routes/calling/Upgrade';
import { isLive } from '@/lib/backend';
import { errorText } from '@/lib/api';
import { useChangePlan, useMe, usePlans, useSubscription } from '@/lib/account';
import { dayBefore, dayMonth } from '@/lib/dates';
import { BackLink, Page } from '@/components/Page';
import { usePlan, PLAN_LABEL, type Plan } from '@/lib/plan';
import { BALANCE } from '@/lib/fake';
import { formatUsd } from '@/lib/money';
import { FEE_INTRO, FEE_LATER, formatRate } from '@/lib/pricing';

const PLANS: Plan[] = ['free', 'starter', 'pro'];

const FEATURES: Record<Plan, { base?: string; items: string[] }> = {
  free: {
    items: [`Calls to US and Canada: ${formatRate('free')} a minute`, 'Upload a lead list', 'Tap Call on each lead', '30 dials a day', 'Script on screen for your first 2 months', 'Talk on your laptop or your phone'],
  },
  starter: {
    base: 'Everything in Free',
    items: [`Calls drop to ${formatRate('starter')} a minute`, 'Auto-dial your list', 'Phone and laptop together', 'Callback alerts', '120 dials a day, 500 after ID check', 'Script on screen, always'],
  },
  pro: {
    base: 'Everything in Starter',
    items: [`Calls drop to ${formatRate('pro')} a minute`, 'Every call recorded', 'Transcripts and call summaries', 'No daily limit', 'Multi-dial, after ID check'],
  },
};

type Cell = string | boolean;
const COMPARE: [string, Cell, Cell, Cell][] = [
  ['Monthly fee', '$0', '$10, then $15', '$21, then $35'],
  ['Calls to US and Canada', `${formatRate('free')} a min`, `${formatRate('starter')} a min`, `${formatRate('pro')} a min`],
  ['Dials a day', '30', '120, or 500 after ID check', 'No limit'],
  ['Lead lists', '1 at a time', 'Unlimited', 'Unlimited'],
  ['Auto-dial your list', false, true, true],
  ['Script on screen', 'First 2 months', true, true],
  ['Follow-up list', true, true, true],
  ['Talk on laptop or phone', true, true, true],
  ['Phone and laptop together', false, true, true],
  ['Callback alerts', false, true, true],
  ['Call recording', false, false, true],
  ['Transcripts and summaries', false, false, true],
  ['Multi-dial (2 lines)', false, false, 'After ID check'],
];

const CARD: Record<Plan, { card: string; check: string; base: string; note: string; pill: PillTone; pillClass: string; cta: ButtonVariant }> = {
  free: { card: 'border border-line bg-surface text-ink', check: 'text-success', base: 'text-muted', note: 'text-muted', pill: 'neutral', pillClass: 'bg-well-2 text-ink', cta: 'primary' },
  starter: { card: 'border-2 border-tangerine bg-brand-tint text-ink', check: 'text-brand-ink', base: 'text-muted', note: 'text-muted', pill: 'brand', pillClass: 'bg-tangerine text-night', cta: 'primary' },
  pro: { card: 'bg-night text-white', check: 'text-sun', base: 'text-zinc-400', note: 'text-zinc-400', pill: 'lemon', pillClass: '', cta: 'lemon' },
};

const COLS = 'grid grid-cols-[minmax(0,1fr)_112px_112px_112px] items-center lg:grid-cols-[minmax(0,1fr)_220px_220px_220px]';
const cell = 'flex justify-center px-2 text-center font-semibold';
const hl = 'self-stretch items-center bg-brand-tint';

function CellView({ value }: { value: Cell }) {
  if (value === true) return <Icon name="check" className="text-success" />;
  if (value === false) return <span className="text-off">—</span>;
  return <>{value}</>;
}

const RANK: Record<Plan, number> = { free: 0, starter: 1, pro: 2 };

export default function ComparePlans() {
  const navigate = useNavigate();
  const { plan: current, setPlan } = usePlan();
  const live = isLive();
  const me = useMe();
  const plans = usePlans();
  const sub = useSubscription();
  const change = useChangePlan();
  const toast = useToast();
  const [upgradeTo, setUpgradeTo] = useState<Exclude<Plan, 'free'> | null>(null);
  const [downTo, setDownTo] = useState<Plan | null>(null);
  const balance = live ? me.data?.balance_microdollars ?? 0 : BALANCE;
  const intro = plans.data?.intro_eligible ?? true;
  const renews = sub.data?.next_renewal;

  /** Live prices come from the api: the same numbers the ledger charges. */
  function price(p: Plan): { now: number; later: number } {
    const info = plans.data?.plans.find(x => x.id === p);
    if (!live || !info) return { now: FEE_INTRO[p], later: FEE_LATER[p] };
    return { now: intro ? info.intro_fee_microdollars : info.monthly_fee_microdollars, later: info.monthly_fee_microdollars };
  }

  function choose(p: Plan) {
    if (!live) { setPlan(p); navigate('/settings'); return; }
    if (RANK[p] > RANK[current] && p !== 'free') setUpgradeTo(p);
    else setDownTo(p);
  }

  return (
    <Page className="gap-8 pb-12 pt-6 lg:gap-10 lg:pb-16 lg:pt-11">
      <PageHeader size="xl" title="Pick your plan" back={<BackLink to="/call">Back to calling</BackLink>}
        lede="Free never ends. Every plan pays for calls from your balance, and the higher the plan, the less you pay a minute. Prices are in US dollars."
        className="gap-6"
        aside={<Note className="text-14"><Icon name="check" className="text-muted" /><span>Paid from your balance<br /><b className="tabular-nums">{formatUsd(balance)} available</b></span></Note>} />

      <div className="grid items-start gap-4 lg:grid-cols-3 lg:gap-5">
        {PLANS.map(p => {
          const f = FEATURES[p];
          const c = CARD[p];
          return (
            <section key={p} aria-label={`${PLAN_LABEL[p]} plan`} className={cn('relative flex flex-col gap-5 overflow-hidden rounded-3xl px-5 pb-6 pt-[22px] sm:px-[26px] sm:pt-[26px]', c.card)}>
              {p === 'pro' && <Blobs layout="plan" />}
              <div className="relative flex min-h-6 items-center"><Pill tone={c.pill} className={cn('font-bold', c.pillClass)}>{PLAN_LABEL[p]}</Pill></div>
              <div className="relative">
                <div className="flex items-baseline gap-2">
                  <b className="text-44 font-extrabold tracking-[-0.04em] sm:text-52">{formatUsd(price(p).now).replace('.00', '')}</b>
                  <span className={cn('text-14', c.note)}>a month</span>
                </div>
                <p className={cn('mt-1 text-14', c.note)}>
                  {p === 'free'
                    ? 'No time limit. Keep calling as long as you like.'
                    : price(p).now !== price(p).later
                      ? `For your first 3 months. Then ${formatUsd(price(p).later)} a month after that.`
                      : 'Every month. You have had the intro price before.'}
                </p>
              </div>
              <div className="relative">
                {p === current
                  ? <Button variant="current" size="lg" block disabled><Icon name="check" />Your plan</Button>
                  : live && sub.data?.pending_change === p && renews
                    ? <Button variant="current" size="lg" block disabled>Moving here on {dayMonth(renews)}</Button>
                    : <Button variant={c.cta} size="lg" block onClick={() => choose(p)}>Move to {PLAN_LABEL[p]}</Button>}
              </div>
              <ul className={cn('relative flex list-none flex-col gap-3 border-t pt-[18px]', p === 'pro' ? 'border-white/12' : 'border-night/8')}>
                {f.base && <li className="flex items-start gap-2.5 text-14"><Icon name="check" className={cn('mt-px', c.check)} /><span className={c.base}>{f.base}</span></li>}
                {f.items.map(item => <li key={item} className="flex items-start gap-2.5 text-14"><Icon name="check" className={cn('mt-px', c.check)} /><span>{item}</span></li>)}
              </ul>
            </section>
          );
        })}
      </div>

      <section>
        <h2 className="pb-4 text-24 font-extrabold tracking-[-0.03em]">Compare everything</h2>
        <div className="overflow-x-auto rounded-2xl border border-line pt-1.5">
          <div className="min-w-[560px]">
          <div className={cn(COLS, 'h-14 text-14 font-bold')}>
            <span className="pl-4 font-semibold text-muted lg:pl-5">What you get</span>
            <span className={cell}>Free</span>
            <span className={cn(cell, hl, 'rounded-t-xl text-brand-ink')}>Starter</span>
            <span className={cell}>Pro</span>
          </div>
          {COMPARE.map(([label, free, starter, pro]) => (
            <div key={label} className={cn(COLS, 'min-h-[52px] border-t border-line text-14')}>
              <span className="py-2 pl-4 text-ink-2 lg:py-0 lg:pl-5">{label}</span>
              <span className={cell}><CellView value={free} /></span>
              <span className={cn(cell, hl)}><CellView value={starter} /></span>
              <span className={cell}><CellView value={pro} /></span>
            </div>
          ))}
          <div className={cn(COLS, 'min-h-[52px] border-t border-line text-14')}>
            <span className="py-2 pl-4 text-ink-2 lg:py-0 lg:pl-5">How you pay for calls and numbers</span>
            <span className="col-span-3 text-center text-muted">From your balance, on every plan</span>
          </div>
          </div>
        </div>
      </section>

      <div className="grid gap-5 rounded-2xl bg-sunk px-5 py-5 md:grid-cols-3 md:gap-6 md:px-6 md:py-[22px]">
        {([
          ['up', 'bg-[#ffe3cc]', 'Upgrade starts now', 'You pay the difference for the rest of this month, shown before you confirm.'],
          ['callback', 'bg-[#fff3a3]', 'Downgrade at renewal', 'You keep what you paid for until your next renewal date.'],
          ['lock', 'bg-[#d1fadf]', 'New accounts have limits', 'Verify your ID to remove the new-account dial limits on any plan.'],
        ] as const).map(([icon, bg, title, body]) => (
          <div key={title} className="flex items-start gap-3 text-14">
            <span className={cn('flex size-[34px] flex-none items-center justify-center rounded-md text-night', bg)}><Icon name={icon} size={17} /></span>
            <div><b className="block font-bold">{title}</b><p className="text-muted">{body}</p></div>
          </div>
        ))}
      </div>
      {upgradeTo && <UpgradeDialog open to={upgradeTo} reason={`Move up to ${PLAN_LABEL[upgradeTo]}`} onClose={() => setUpgradeTo(null)} />}
      <Modal open={downTo !== null} onClose={() => setDownTo(null)} width="sm"
        title={downTo && renews ? `Move to ${PLAN_LABEL[downTo]} on ${dayMonth(renews)}?` : 'Move plan?'}>
        {downTo && renews && (
          <>
            <p className="mt-3 text-15 text-muted">
              You keep {PLAN_LABEL[current]} until <b className="text-ink">{dayMonth(dayBefore(renews))}</b>, because you&apos;ve paid for it.
              {downTo !== 'free' && <> Then {PLAN_LABEL[downTo]} costs {formatUsd(price(downTo).later)} a month from your balance.</>}
            </p>
            {change.error && <Note tone="danger" className="mt-3 text-14"><span role="alert">{errorText(change.error)}</span></Note>}
            <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
              <Button size="lg" onClick={() => setDownTo(null)}>Stay on {PLAN_LABEL[current]}</Button>
              <Button variant="outlineDanger" size="lg" disabled={change.isPending}
                onClick={() => change.mutate(downTo, { onSuccess: () => { toast(`You'll move to ${PLAN_LABEL[downTo]} on ${dayMonth(renews)}`); setDownTo(null); } })}>
                Move on {dayMonth(renews)}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </Page>
  );
}
