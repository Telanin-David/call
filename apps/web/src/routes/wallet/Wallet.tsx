import { useState } from 'react';
import { AmountPicker, Button, Card, CardHead, DarkCard, DarkEyebrow, Field, Icon, Input, LinkButton, Modal, PageHeader, Progress, Tile, cn, useToast, type BarTone } from '@dialer/ui';
import { Page } from '@/components/Page';
import { usePlan, PLAN_LABEL } from '@/lib/plan';
import { BALANCE, ME } from '@/lib/fake';
import { formatUsd, usd } from '@/lib/money';
import { FEE_INTRO, NUMBER_MONTHLY, formatRate, minutesFor } from '@/lib/pricing';

const AMOUNTS = [usd(10), usd(20), usd(50), usd(100)];
const CALLS_SPENT = usd(18, 42);

interface Entry { date: string; title: string; sub: string; amount: number }

/** Builds the activity list as a CSV file and hands it to the browser. */
function downloadStatement(entries: Entry[]) {
  const rows = [['Date', 'Item', 'Detail', 'Amount (USD)'], ...entries.map(e => [e.date, e.title, e.sub, (e.amount / 1_000_000).toFixed(2)])];
  const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'dialer-statement-october-2026.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export default function Wallet() {
  const { plan } = usePlan();
  const [amount, setAmount] = useState(usd(20));
  const [added, setAdded] = useState(0);
  const [paying, setPaying] = useState(false);
  const toast = useToast();
  const balance = BALANCE + added;

  const fee = FEE_INTRO[plan];
  const spend: { label: string; amount: number; tone: BarTone }[] = [
    { label: 'Calls', amount: CALLS_SPENT, tone: 'brand' },
    ...(fee > 0 ? [{ label: `${PLAN_LABEL[plan]} plan`, amount: fee, tone: 'lemon' as const }] : []),
    { label: 'Number', amount: NUMBER_MONTHLY, tone: 'ok' },
  ];
  const total = spend.reduce((s, x) => s + x.amount, 0);

  const ledger: Entry[] = [
    { date: 'Today', title: 'Calls', sub: '86 calls · 112 min', amount: -usd(2, 24) },
    ...(fee > 0 ? [{ date: '1 Oct', title: `${PLAN_LABEL[plan]} plan`, sub: `Month 1 of 3 at ${formatUsd(fee).replace('.00', '')}`, amount: -fee }] : []),
    { date: '1 Oct', title: 'Top-up', sub: 'Card ending 4321', amount: usd(30) },
    { date: '30 Sep', title: 'Calls', sub: '64 calls · 81 min', amount: -usd(2, 3) },
    { date: '2 Sep', title: 'Number +1 (646) 555-0142', sub: 'Monthly rent', amount: -NUMBER_MONTHLY },
  ];

  return (
    <Page>
      <PageHeader title="Wallet" lede="Everything is prepaid. Calls, your number and your plan come out of this balance." />

      <div className="grid items-start gap-3.5 lg:grid-cols-[420px_minmax(0,1fr)] lg:gap-[18px]">
        <div className="flex flex-col gap-3.5">
          <DarkCard as="section" aria-label="Balance">
            <DarkEyebrow>BALANCE</DarkEyebrow>
            <div className="mt-1.5 text-44 leading-[50px] font-extrabold sm:text-52 sm:leading-[58px] tracking-[-0.04em] tabular-nums">{formatUsd(balance)}</div>
            <div className="text-14 text-zinc-400">About {minutesFor(balance, plan).toLocaleString('en-US')} minutes at {formatRate(plan)} on {PLAN_LABEL[plan]}</div>
            <div className="mt-[22px]">
              <AmountPicker dark amounts={AMOUNTS} value={amount} onChange={setAmount} format={a => formatUsd(a).replace('.00', '')} />
            </div>
            <Button variant="primary" size="lg" block className="mt-3" onClick={() => setPaying(true)}>Add {formatUsd(amount)} by card</Button>
            <div className="mt-2.5 text-12 text-zinc-400">Name on card must be {ME.name}.</div>
          </DarkCard>
          <div className="flex gap-3 rounded-3xl border border-line bg-surface p-[18px] text-14">
            <Tile tone="lemon" size={38}><Icon name="wallet" size={17} /></Tile>
            <div><b>Low balance alert</b><p className="text-muted">Email and on-screen alert when you drop below <b className="text-ink">$5.00</b>.</p></div>
          </div>
        </div>

        <div className="flex flex-col gap-3.5">
          <Card as="section">
            <CardHead title="Spent in October" className="mb-4"><b className="text-17 tabular-nums">{formatUsd(total)}</b></CardHead>
            <div className="flex flex-col gap-3.5">
              {spend.map(s => (
                <div key={s.label} className="flex flex-col gap-1.5">
                  <div className="flex text-14"><span className="flex-1">{s.label}</span><b className="tabular-nums">{formatUsd(s.amount)}</b></div>
                  <Progress thick value={(s.amount / total) * 100} tone={s.tone} label={s.label} />
                </div>
              ))}
            </div>
          </Card>
          <Card as="section">
            <CardHead title="Activity" className="mb-1"><LinkButton className="text-14" onClick={() => downloadStatement(ledger)}>Download statement</LinkButton></CardHead>
            {ledger.map((e, i) => (
              <div key={i} className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 border-t border-line py-[13px] text-14 sm:grid-cols-[90px_minmax(0,1fr)_120px] sm:gap-3.5">
                <span className="text-muted">{e.date}</span>
                <div><b>{e.title}</b><p className="text-13 text-muted">{e.sub}</p></div>
                <b className={cn('text-right tabular-nums', e.amount > 0 && 'text-success-ink')}>{e.amount > 0 ? '+' : '−'}{formatUsd(Math.abs(e.amount))}</b>
              </div>
            ))}
          </Card>
        </div>
      </div>

      <Modal open={paying} onClose={() => setPaying(false)} title={`Add ${formatUsd(amount)}`}>
        <p className="mt-2 text-14 text-muted">The name on the card must be {ME.name}. Real card payments (Paystack and Stripe) arrive in D2; this one is pretend.</p>
        <form className="mt-4 flex flex-col gap-3" onSubmit={e => { e.preventDefault(); setAdded(a => a + amount); setPaying(false); toast(`Added ${formatUsd(amount)} to your balance`); }}>
          <Field label="Name on card" htmlFor="pay-name"><Input id="pay-name" defaultValue={ME.name} /></Field>
          <Field label="Card number" htmlFor="pay-card"><Input id="pay-card" inputMode="numeric" placeholder="1234 5678 9012 3456" /></Field>
          <Button type="submit" variant="primary" size="lg" block>Pay {formatUsd(amount)}</Button>
        </form>
      </Modal>
    </Page>
  );
}
