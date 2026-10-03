import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AmountPicker, Button, DarkCard, DarkEyebrow, Icon, Note, PriceRow, Tile, cn, linkClass } from '@dialer/ui';
import { TwoCol } from '@/components/Page';
import { ME } from '@/lib/fake';
import { formatUsd, usd } from '@/lib/money';
import { RATE_PER_MIN, formatRate } from '@/lib/pricing';

const AMOUNTS = [usd(5), usd(10), usd(20), usd(50)];

type StepState = 'done' | 'now' | 'todo';

const STEPS: { title: string; body: string; state: StepState; tag?: string }[] = [
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

export default function Setup() {
  const navigate = useNavigate();
  const [amount, setAmount] = useState(usd(10));
  const done = STEPS.filter(s => s.state === 'done').length;

  return (
    <TwoCol side={300}>
      <div className="flex flex-col gap-3">
        <div className="pb-2.5">
          <h1 className="text-28 font-extrabold tracking-[-0.04em] md:text-36">Let's get you calling, {ME.first}</h1>
          <div className="mt-3.5 flex flex-wrap items-center gap-x-3.5 gap-y-2 text-14 text-muted">
            <div className="h-2 min-w-[160px] max-w-[320px] flex-1 overflow-hidden rounded-sm bg-well-2">
              <span className="block h-full rounded-sm bg-tangerine" style={{ width: `${Math.round((done / STEPS.length) * 100)}%` }} />
            </div>
            <span><b className="text-ink">{done} of {STEPS.length} done</b> · about 4 minutes left</span>
          </div>
        </div>

        {STEPS.map((s, i) => (
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
            {s.state === 'now' && (
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
