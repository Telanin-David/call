import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Icon, Modal, Note, Pill, PriceRow, Tile, cn, linkClass, useToast, type IconName, type TileTone } from '@dialer/ui';
import { PLAN_LABEL, usePlan, type Plan } from '@/lib/plan';
import { BALANCE } from '@/lib/fake';
import { formatUsd } from '@/lib/money';
import { DIALS_PER_DAY, FEE_INTRO, FEE_LATER, formatRate } from '@/lib/pricing';
import { isLive } from '@/lib/backend';
import { errorText } from '@/lib/api';
import { useChangePlan, useMe, usePlans, useQuote } from '@/lib/account';
import { dayMonth, dayMonthYear } from '@/lib/dates';

type Paid = Exclude<Plan, 'free'>;

const PITCH: Record<Paid, { icon: IconName; tone: TileTone; title: string; body: string }[]> = {
  starter: [
    { icon: 'phone', tone: 'brand', title: 'Phone and laptop together', body: 'Script on the laptop, talk on the phone' },
    { icon: 'call', tone: 'lemon', title: `${DIALS_PER_DAY.starter} dials a day`, body: `500 after your ID check. Free stays at ${DIALS_PER_DAY.free}` },
    { icon: 'globe', tone: 'brand', title: 'Cheaper calls', body: `${formatRate('starter')} a minute to the US and Canada, down from ${formatRate('free')}` },
    { icon: 'callback', tone: 'mint', title: 'Callback alerts', body: 'Know when a lead calls you back' },
    { icon: 'list', tone: 'grey', title: 'Auto-dial your list', body: 'Calls one after another, plus unlimited lists' },
  ],
  pro: [
    { icon: 'mic', tone: 'red', title: 'Every call recorded', body: 'With a transcript and a short summary' },
    { icon: 'users', tone: 'brand', title: 'Dial 2 at once', body: 'After your ID check' },
    { icon: 'globe', tone: 'brand', title: 'Cheapest calls', body: `${formatRate('pro')} a minute to the US and Canada` },
    { icon: 'call', tone: 'lemon', title: 'No daily dial limit', body: 'Call as much as your balance allows' },
  ],
};

const GAINS: Record<Paid, string[]> = {
  starter: ['Auto-dial your list', 'Phone and laptop together', 'Callback alerts', `Calls drop to ${formatRate('starter')} a minute`, `${DIALS_PER_DAY.starter} dials a day, 500 after ID`, 'Script on screen, always'],
  pro: ['Every call recorded', 'Transcripts and summaries', 'Dial 2 at once', `Calls drop to ${formatRate('pro')} a minute`, 'No daily dial limit', 'Everything in Starter'],
};

/** "4 Jan 2027": when the intro price would end if the rep upgraded today. */
function introEnd(months: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + months);
  return dayMonthYear(d.toISOString().slice(0, 10));
}

/** Board 32, live: the server's quote, then the real change. */
function LiveConfirm({ open, to, close }: { open: boolean; to: Paid; close: () => void }) {
  const quote = useQuote(open ? to : null);
  const change = useChangePlan();
  const plans = usePlans();
  const toast = useToast();
  const q = quote.data;
  const full = plans.data?.plans.find(p => p.id === to)?.monthly_fee_microdollars ?? FEE_LATER[to];
  const short = q ? q.balance_after_microdollars < 0 : false;

  return (
    <Modal open={open} onClose={close} label={`Confirm your ${PLAN_LABEL[to]} upgrade`} className="sm:max-w-[580px]">
      <Pill tone="brand" className="bg-tangerine font-bold text-night">{PLAN_LABEL[to]}</Pill>
      <h2 className="mt-3 text-28 font-extrabold tracking-[-0.03em]">Confirm your upgrade</h2>
      <ul className="mt-4 grid list-none gap-x-6 gap-y-2.5 text-15 sm:grid-cols-2">
        {GAINS[to].map(g => <li key={g} className="flex items-start gap-2"><Icon name="check" size={16} className="mt-1 text-success" />{g}</li>)}
      </ul>
      {quote.isPending && <p className="mt-5 text-14 text-muted" role="status">Working out the price…</p>}
      {quote.error && <Note tone="danger" className="mt-5 text-14"><span role="alert">{errorText(quote.error)}</span></Note>}
      {q && (
        <>
          <div className="mt-5 rounded-2xl bg-sunk px-4 py-2">
            <PriceRow label={`Today, ${dayMonth(q.starts_on)}`} value={formatUsd(q.due_today_microdollars)} muted className="border-b border-line py-2.5" />
            {q.next_renewal && <PriceRow label={`${dayMonth(q.next_renewal)}, then monthly`} value={formatUsd(q.next_charge_microdollars)} muted className={cn('py-2.5', q.intro_price && 'border-b border-line')} />}
            {q.intro_price && q.from === 'free' && <PriceRow label={`From ${introEnd(3)}`} value={`${formatUsd(full)} a month`} muted className="py-2.5" />}
          </div>
          <div className="mt-4 flex items-baseline justify-between text-14 text-muted">
            <span>Balance now {formatUsd(q.balance_microdollars)}</span>
            <span>Balance after <b className={cn('text-20', short ? 'text-danger-ink' : 'text-ink')}>{formatUsd(q.balance_after_microdollars)}</b></span>
          </div>
          {short && (
            <Note tone="danger" className="mt-4 text-14">
              <span role="alert">Add {formatUsd(-q.balance_after_microdollars)} to your balance first. <Link to="/wallet" onClick={close} className={linkClass}>Top up</Link></span>
            </Note>
          )}
        </>
      )}
      {change.error && <Note tone="danger" className="mt-4 text-14"><span role="alert">{errorText(change.error)}</span></Note>}
      <Button variant="primary" size="xl" block className="mt-4" disabled={!q || short || change.isPending}
        onClick={() => change.mutate(to, { onSuccess: () => { toast(`You're on ${PLAN_LABEL[to]} now`); close(); } })}>
        {change.isPending ? 'Upgrading…' : `Pay ${formatUsd(q?.due_today_microdollars ?? 0)} and upgrade`}
      </Button>
      <p className="mt-3 text-center text-13 text-muted">Starts now. Paid from your balance. Move back to Free any time, it starts at your next renewal.</p>
    </Modal>
  );
}

/** Board 10 (why upgrade) then board 32 (confirm and pay from balance). */
export function UpgradeDialog({ open, to, reason, onClose }: { open: boolean; to: Paid; reason: string; onClose: () => void }) {
  const { setPlan } = usePlan();
  const [confirming, setConfirming] = useState(false);
  const live = isLive();
  const me = useMe();
  const plans = usePlans();
  const info = plans.data?.plans.find(p => p.id === to);
  const intro = plans.data?.intro_eligible ?? true;
  const fee = live && info ? (intro ? info.intro_fee_microdollars : info.monthly_fee_microdollars) : FEE_INTRO[to];
  const later = live && info ? info.monthly_fee_microdollars : FEE_LATER[to];
  const balance = live ? me.data?.balance_microdollars ?? 0 : BALANCE;
  const close = () => { setConfirming(false); onClose(); };

  if (confirming && live) return <LiveConfirm open={open} to={to} close={close} />;
  if (confirming) {
    return (
      <Modal open={open} onClose={close} label={`Confirm your ${PLAN_LABEL[to]} upgrade`} className="sm:max-w-[580px]">
        <Pill tone="brand" className="bg-tangerine font-bold text-night">{PLAN_LABEL[to]}</Pill>
        <h2 className="mt-3 text-28 font-extrabold tracking-[-0.03em]">Confirm your upgrade</h2>
        <ul className="mt-4 grid list-none gap-x-6 gap-y-2.5 text-15 sm:grid-cols-2">
          {GAINS[to].map(g => <li key={g} className="flex items-start gap-2"><Icon name="check" size={16} className="mt-1 text-success" />{g}</li>)}
        </ul>
        <div className="mt-5 rounded-2xl bg-sunk px-4 py-2">
          <PriceRow label="Today, 1 Oct" value={formatUsd(fee)} muted className="border-b border-line py-2.5" />
          <PriceRow label="1 Nov and 1 Dec" value={`${formatUsd(fee)} each`} muted className="border-b border-line py-2.5" />
          <PriceRow label="From 1 Jan 2027" value={`${formatUsd(FEE_LATER[to])} a month`} muted className="py-2.5" />
        </div>
        <div className="mt-4 flex items-baseline justify-between text-14 text-muted">
          <span>Balance now {formatUsd(BALANCE)}</span>
          <span>Balance after <b className="text-20 text-ink">{formatUsd(BALANCE - fee)}</b></span>
        </div>
        <Button variant="primary" size="xl" block className="mt-4" onClick={() => { setPlan(to); close(); }}>Pay {formatUsd(fee)} and upgrade</Button>
        <p className="mt-3 text-center text-13 text-muted">Starts now. Paid from your balance. Move back to Free any time, it starts at your next renewal.</p>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={close} label={`${PLAN_LABEL[to]} plan`} bare width="lg" className="grid md:grid-cols-[320px_minmax(0,1fr)]">
      <div className="relative overflow-hidden bg-night px-5 py-5 text-white md:px-8 md:py-8">
        <div className="relative">
          <Pill tone="brand">{PLAN_LABEL[to]}</Pill>
          <div className="mt-3 text-44 font-extrabold tracking-[-0.04em] md:mt-4 md:text-52">{formatUsd(fee).replace('.00', '')}</div>
          <p className="text-15 text-zinc-400">{intro ? 'a month for your first 3 months' : 'a month'}</p>
          {intro && (
            <p className="mt-3 rounded-2xl bg-white/8 px-3.5 py-2.5 text-13 md:mt-4 md:py-3 md:text-14">
              Then <b>{formatUsd(later)} a month</b> from <b>{live ? introEnd(3) : '1 Jan 2027'}</b>. We remind you a week before.
            </p>
          )}
        </div>
        <span aria-hidden="true" className="absolute -bottom-[120px] left-[170px] size-[300px] rounded-full bg-tangerine max-md:hidden" />
        <span aria-hidden="true" className="absolute bottom-[64px] left-[164px] size-9 rounded-full bg-sun max-md:hidden" />
      </div>
      <div className="relative px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-6 md:px-7 md:pb-7">
        <button type="button" aria-label="Close" onClick={close}
          className="absolute right-4 top-4 flex size-9 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-muted hover:bg-sunk hover:text-ink">
          <Icon name="x" size={18} />
        </button>
        <h2 className="pr-10 text-24 font-extrabold tracking-[-0.03em]">{reason}</h2>
        <ul className="mt-4 flex list-none flex-col gap-3.5">
          {PITCH[to].map(p => (
            <li key={p.title} className="flex gap-3">
              <Tile tone={p.tone} size={34}><Icon name={p.icon} size={16} /></Tile>
              <span><b className="block text-16">{p.title}</b><span className="text-13 text-muted">{p.body}</span></span>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex justify-between border-t border-line pt-3 text-13 text-muted">
          <span>Paid from your balance</span><b className="text-ink">{formatUsd(balance)} available</b>
        </div>
        <Button variant="primary" size="lg" block className="mt-3" onClick={() => setConfirming(true)}>{live ? `Upgrade to ${PLAN_LABEL[to]}` : `Upgrade for ${formatUsd(fee)}`}</Button>
        <Link to="/plans" onClick={close} className={cn(linkClass, 'mt-3 block text-center text-14')}>Compare all plans</Link>
      </div>
    </Modal>
  );
}
