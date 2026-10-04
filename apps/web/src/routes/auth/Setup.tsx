import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AmountPicker, Button, DarkCard, DarkEyebrow, Icon, Note, PriceRow, Tile, cn, linkClass } from '@dialer/ui';
import { TwoCol } from '@/components/Page';
import { ME } from '@/lib/fake';
import { isLive } from '@/lib/backend';
import { useMe, useWallet } from '@/lib/account';
import { useMyNumbers } from '@/lib/numbers';
import { useLists } from '@/lib/leads';
import { useScripts } from '@/lib/scripts';
import { formatUsd, usd } from '@/lib/money';
import { RATE_PER_MIN, formatRate } from '@/lib/pricing';

const AMOUNTS = [usd(5), usd(10), usd(20), usd(50)];

type StepState = 'done' | 'now' | 'todo';

type Step = { title: string; body: string; state: StepState; tag?: string; go?: { to: string; label: string } };

const STEPS: Step[] = [
  { title: 'Confirm email and phone', body: 'Done in the last step', state: 'done' },
  { title: 'Agree to the rules', body: 'Limits, numbers you can call, one account per person', state: 'done' },
  { title: 'Add money', body: 'Everything is prepaid. Calls and numbers come out of your balance.', state: 'now' },
  { title: 'Get a US or Canada number', body: 'The number leads see and call back. $1.50 a month.', state: 'todo', tag: 'After step 3' },
  { title: 'Upload your leads', body: 'A CSV file from your laptop', state: 'todo' },
  { title: 'Add your script', body: 'Paste it or upload a file', state: 'todo' },
];

const NUM: Record<StepState, string> = {
  done: 'bg-success text-white',
  now: 'bg-tangerine text-night font-extrabold',
  todo: 'bg-well text-faint',
};

/** Live steps: done from the rep's account; the first one not done is "now". */
function useLiveSteps(): Step[] | null {
  const live = isLive();
  const me = useMe();
  const wallet = useWallet();
  const numbers = useMyNumbers();
  const lists = useLists();
  const scripts = useScripts();
  if (!live) return null;
  const loaded = me.data && wallet.data && numbers.data && lists.data && scripts.data;
  const flags = [
    Boolean(me.data?.email_confirmed && me.data.phone_confirmed),
    Boolean(me.data?.rules_accepted_at),
    (wallet.data?.balance_microdollars ?? 0) > 0 || (wallet.data?.activity ?? []).some(e => e.type === 'topup'),
    (numbers.data?.numbers.length ?? 0) > 0,
    (lists.data?.lists.length ?? 0) > 0,
    (scripts.data?.scripts.length ?? 0) > 0,
  ];
  const goes = [
    undefined,
    { to: '/rules', label: 'Read the rules' },
    { to: '/wallet', label: 'Add money' },
    { to: '/numbers', label: 'Get a number' },
    { to: '/leads/upload?from=setup', label: 'Upload leads' },
    { to: '/scripts?from=setup', label: 'Write your script' },
  ];
  const now = loaded ? flags.indexOf(false) : -1;
  return STEPS.map((s, i) => ({
    ...s,
    state: flags[i] ? 'done' : i === now ? 'now' : 'todo',
    body: i === 0 && flags[0] ? 'Done' : s.body,
    tag: undefined,
    go: goes[i],
  }));
}

export default function Setup() {
  const navigate = useNavigate();
  const [amount, setAmount] = useState(usd(10));
  const me = useMe();
  const liveSteps = useLiveSteps();
  const steps = liveSteps ?? STEPS;
  const done = steps.filter(s => s.state === 'done').length;
  const first = liveSteps ? (me.data?.name ?? '').split(' ')[0] : ME.first;

  return (
    <TwoCol side={300}>
      <div className="flex flex-col gap-3">
        <div className="pb-2.5">
          <h1 className="text-28 font-extrabold tracking-[-0.04em] md:text-36">{liveSteps && done === steps.length ? `You're ready to call, ${first}` : `Let's get you calling, ${first}`}</h1>
          <div className="mt-3.5 flex flex-wrap items-center gap-x-3.5 gap-y-2 text-14 text-muted">
            <div className="h-2 min-w-[160px] max-w-[320px] flex-1 overflow-hidden rounded-sm bg-well-2">
              <span className="block h-full rounded-sm bg-tangerine" style={{ width: `${Math.round((done / steps.length) * 100)}%` }} />
            </div>
            <span><b className="text-ink">{done} of {steps.length} done</b>{done < steps.length && ' · about 4 minutes left'}</span>
          </div>
        </div>

        {liveSteps && done === steps.length && (
          <Button variant="primary" size="lg" className="self-start" onClick={() => navigate('/')}><Icon name="call" />Start calling</Button>
        )}
        {steps.map((s, i) => (
          <section key={s.title} className={cn('flex flex-col gap-[18px] rounded-2xl border bg-surface px-4 py-[18px] sm:px-5', s.state === 'now' ? 'border-2 border-tangerine' : 'border-line')}>
            <div className="flex items-center gap-3.5">
              <span className={cn('flex size-[30px] flex-none items-center justify-center rounded-full text-14 font-bold', NUM[s.state])}>
                {s.state === 'done' ? <Icon name="check" size={15} /> : i + 1}
              </span>
              <div className="flex-1">
                <b className={cn('text-16', s.state === 'done' && 'text-faint line-through')}>{s.title}</b>
                <p className="text-13 text-muted">{s.body}</p>
              </div>
              {s.state === 'done' && <span className="text-13 font-semibold text-success-ink">Done</span>}
              {s.tag && <span className="text-13 text-faint max-sm:hidden">{s.tag}</span>}
            </div>
            {s.state === 'now' && liveSteps && s.go && (
              <div className="sm:pl-11">
                <Button variant="primary" size="lg" onClick={() => s.go && navigate(s.go.to)}>{s.go.label}</Button>
              </div>
            )}
            {s.state === 'now' && !liveSteps && (
              <div className="grid gap-4 sm:pl-11 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-6">
                <div className="flex flex-col gap-3.5">
                  <AmountPicker amounts={AMOUNTS} value={amount} onChange={setAmount} format={a => formatUsd(a).replace('.00', '')} />
                  <Note tone="tint" className="gap-2.5 text-14">
                    <Icon name="globe" className="text-brand-ink" />
                    <span>On Free, calls to the US and Canada cost <b>{formatRate('free')} a minute</b>. {formatUsd(amount)} is about <b>{Math.floor(amount / RATE_PER_MIN.free)} minutes</b>.</span>
                  </Note>
                </div>
                <div className="flex flex-col gap-1.5 rounded-xl bg-sunk p-4">
                  <PriceRow label="Top-up" value={formatUsd(amount)} muted />
                  <PriceRow label="You pay" value={formatUsd(amount)} total />
                  <Button variant="primary" size="lg" block className="mt-1.5" onClick={() => navigate('/numbers')}>Pay {formatUsd(amount)} by card</Button>
                  <span className="text-12 leading-[17px] text-muted">The name on the card must be {ME.name}. Your bank may add a fee for paying in US dollars.</span>
                </div>
              </div>
            )}
          </section>
        ))}
      </div>

      <aside className="flex flex-col gap-3.5 lg:sticky lg:top-0">
        <DarkCard blobs="side" className="rounded-2xl p-[22px]">
          <DarkEyebrow>YOUR PLAN</DarkEyebrow>
          <div className="mt-1 text-26 font-extrabold tracking-[-0.03em]">Free</div>
          <p className="pt-2.5 text-14 text-zinc-300">Call by hand, 30 dials a day. Your script shows on screen for your first 2 months.</p>
          <Link className={cn(linkClass, 'mt-3.5 inline-block text-glow')} to="/plans">See all plans</Link>
        </DarkCard>
        <div className="flex gap-3 rounded-2xl border border-line bg-surface p-[18px] text-13 leading-[19px] text-muted">
          <Tile tone="lemon" size={36}><Icon name="lock" size={17} /></Tile>
          <div><b className="block text-14 text-ink">New account limits</b>Verify your ID any time to remove them. You can do it later from Settings.</div>
        </div>
      </aside>
    </TwoCol>
  );
}
