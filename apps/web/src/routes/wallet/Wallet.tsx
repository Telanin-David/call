import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AmountPicker, Button, Card, CardHead, DarkCard, DarkEyebrow, Field, Icon, Input, LinkButton, Modal, Note, PageHeader, Progress, Tile, cn, linkClass, useToast, type BarTone } from '@dialer/ui';
import { Page } from '@/components/Page';
import { api, errorText } from '@/lib/api';
import { apiBase, isLive } from '@/lib/backend';
import { useMe, useRefreshMoney, useWallet, type Entry as LedgerEntry, type TopUp } from '@/lib/account';
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

const TITLE: Record<string, string> = { topup: 'Top-up', call: 'Call', plan: 'Plan', number: 'Number', refund: 'Refund' };

/** "Today", or "4 Oct", in the rep's own clock. */
function shortDate(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (d.toDateString() === now.toDateString()) return 'Today';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function toEntry(e: LedgerEntry): Entry {
  const title = TITLE[e.type] ?? e.type;
  // "Top-up, card ending 4242" under the title "Top-up" reads "Card ending 4242".
  const sub = e.description.startsWith(`${title}, `) ? e.description.slice(title.length + 2) : e.description;
  return { date: shortDate(e.created_at), title, sub: sub.charAt(0).toUpperCase() + sub.slice(1), amount: e.amount_microdollars };
}

/** A fake provider's checkout page only exists in development. */
function isDevCheckout(url: string): boolean {
  return url.startsWith('https://pay.fake.test/');
}

/**
 * After paying, the provider sends the rep back with ?topup=<reference>.
 * The money only counts once the provider's webhook has confirmed it, so
 * this asks every two seconds, for up to a minute.
 */
function useReturnFromCheckout() {
  const [params, setParams] = useSearchParams();
  const ref = params.get('topup');
  const cancelled = params.get('cancelled') === '1';
  const toast = useToast();
  const refresh = useRefreshMoney();
  const [tries, setTries] = useState(0);
  const status = useQuery({
    queryKey: ['topup', ref],
    queryFn: () => api.get<{ status: string; amount_microdollars: number }>(`/wallet/topups/${ref}`),
    enabled: isLive() && Boolean(ref) && !cancelled,
    refetchInterval: q => (q.state.data?.status === 'pending' && tries < 30 ? 2000 : false),
  });
  useEffect(() => { if (status.data?.status === 'pending') setTries(t => t + 1); }, [status.dataUpdatedAt, status.data?.status]);
  useEffect(() => {
    if (!ref) return;
    const done = (msg: string) => { toast(msg); setParams({}, { replace: true }); void refresh(); };
    if (cancelled) done('Top-up cancelled. Nothing was charged.');
    else if (status.data?.status === 'succeeded') done(`Added ${formatUsd(status.data.amount_microdollars)} to your balance`);
    else if (status.data?.status === 'failed') done("That payment didn't go through. Nothing was added.");
    // refresh, toast and setParams are stable enough; only the outcome matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, cancelled, status.data?.status]);
  return ref && !cancelled && status.data?.status !== 'succeeded' && status.data?.status !== 'failed'
    ? (tries >= 30 ? 'Your payment is taking a while. It will show here as soon as the card company confirms it.' : 'Adding your payment…')
    : null;
}

export default function Wallet() {
  const live = isLive();
  const { plan } = usePlan();
  const [amount, setAmount] = useState(usd(20));
  const [added, setAdded] = useState(0);
  const [paying, setPaying] = useState(false);
  const toast = useToast();
  const me = useMe();
  const wallet = useWallet();
  const refresh = useRefreshMoney();
  const waiting = useReturnFromCheckout();
  const name = live ? me.data?.name ?? '' : ME.name;
  const w = wallet.data;
  const balance = live ? w?.balance_microdollars ?? 0 : BALANCE + added;

  const startTopUp = useMutation({
    mutationFn: () => api.post<TopUp>('/wallet/topups', { amount_microdollars: amount }),
    onSuccess: async t => {
      if (isDevCheckout(t.payment_url)) {
        // Development without real keys: play the "paid" webhook instead.
        await api.post<void>(`/dev/topups/${t.reference}/pay`);
        await refresh();
        setPaying(false);
        toast(`Added ${formatUsd(t.amount_microdollars)} to your balance (test payment)`);
        return;
      }
      window.location.assign(t.payment_url);
    },
  });

  const fee = FEE_INTRO[plan];
  const spend: { label: string; amount: number; tone: BarTone }[] = live
    ? [
      { label: 'Calls', amount: w?.spent_this_month.calls ?? 0, tone: 'brand' as const },
      { label: 'Plan', amount: w?.spent_this_month.plan ?? 0, tone: 'lemon' as const },
      { label: 'Numbers', amount: w?.spent_this_month.numbers ?? 0, tone: 'ok' as const },
    ].filter(x => x.amount > 0)
    : [
      { label: 'Calls', amount: CALLS_SPENT, tone: 'brand' },
      ...(fee > 0 ? [{ label: `${PLAN_LABEL[plan]} plan`, amount: fee, tone: 'lemon' as const }] : []),
      { label: 'Number', amount: NUMBER_MONTHLY, tone: 'ok' },
    ];
  const total = spend.reduce((s, x) => s + x.amount, 0);
  const month = new Date().toLocaleDateString('en-GB', { month: 'long' });

  const ledger: Entry[] = live ? (w?.activity ?? []).map(toEntry) : [
    { date: 'Today', title: 'Calls', sub: '86 calls · 112 min', amount: -usd(2, 24) },
    ...(fee > 0 ? [{ date: '1 Oct', title: `${PLAN_LABEL[plan]} plan`, sub: `Month 1 of 3 at ${formatUsd(fee).replace('.00', '')}`, amount: -fee }] : []),
    { date: '1 Oct', title: 'Top-up', sub: 'Card ending 4321', amount: usd(30) },
    { date: '30 Sep', title: 'Calls', sub: '64 calls · 81 min', amount: -usd(2, 3) },
    { date: '2 Sep', title: 'Number +1 (646) 555-0142', sub: 'Monthly rent', amount: -NUMBER_MONTHLY },
  ];
  const provider = w?.topup_provider === 'paystack' ? 'Paystack' : 'Stripe';

  return (
    <Page>
      <PageHeader title="Wallet" lede="Everything is prepaid. Calls, your number and your plan come out of this balance." />
      {waiting && <Note tone="lemon" className="text-14"><span role="status">{waiting}</span></Note>}
      {live && wallet.error && <Note tone="danger" className="text-14"><span role="alert">{errorText(wallet.error)}</span></Note>}

      <div className="grid items-start gap-3.5 lg:grid-cols-[420px_minmax(0,1fr)] lg:gap-[18px]">
        <div className="flex flex-col gap-3.5">
          <DarkCard as="section" aria-label="Balance">
            <DarkEyebrow>BALANCE</DarkEyebrow>
            <div className="mt-1.5 text-44 leading-[50px] font-extrabold sm:text-52 sm:leading-[58px] tracking-[-0.04em] tabular-nums">{formatUsd(balance)}</div>
            <div className="text-14 text-zinc-400">About {minutesFor(balance, plan).toLocaleString('en-US')} minutes at {formatRate(plan)} on {PLAN_LABEL[plan]}</div>
            {live && (w?.held_microdollars ?? 0) > 0 && <div className="text-13 text-zinc-400">{formatUsd(w?.held_microdollars ?? 0)} held for a call in progress</div>}
            <div className="mt-[22px]">
              <AmountPicker dark amounts={AMOUNTS} value={amount} onChange={setAmount} format={a => formatUsd(a).replace('.00', '')} />
            </div>
            <Button variant="primary" size="lg" block className="mt-3" onClick={() => setPaying(true)}>Add {formatUsd(amount)} by card</Button>
            <div className="mt-2.5 text-12 text-zinc-400">Name on card must be {name}.</div>
          </DarkCard>
          <div className="flex gap-3 rounded-3xl border border-line bg-surface p-[18px] text-14">
            <Tile tone="lemon" size={38}><Icon name="wallet" size={17} /></Tile>
            <div><b>Low balance alert</b><p className="text-muted">Email and on-screen alert when you drop below <b className="text-ink">$5.00</b>.</p></div>
          </div>
        </div>

        <div className="flex flex-col gap-3.5">
          <Card as="section">
            <CardHead title={`Spent in ${live ? month : 'October'}`} className="mb-4"><b className="text-17 tabular-nums">{formatUsd(total)}</b></CardHead>
            {spend.length === 0 && <p className="text-14 text-muted">Nothing spent yet this month.</p>}
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
            <CardHead title="Activity" className="mb-1">
              {live
                ? <a className={cn(linkClass, 'text-14')} href={`${apiBase() ?? ''}/wallet/statement`} download>Download statement</a>
                : <LinkButton className="text-14" onClick={() => downloadStatement(ledger)}>Download statement</LinkButton>}
            </CardHead>
            {live && w && ledger.length === 0 && <p className="border-t border-line py-[13px] text-14 text-muted">No activity yet. Add money to get started.</p>}
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
        {live ? (
          <div className="mt-2 flex flex-col gap-3">
            <p className="text-14 text-muted">You pay on {provider}&apos;s secure page, then come straight back here. We never see your card number. The name on the card must be {name}.</p>
            {startTopUp.error && <Note tone="danger" className="text-14"><span role="alert">{errorText(startTopUp.error)}</span></Note>}
            <Button variant="primary" size="lg" block disabled={startTopUp.isPending} onClick={() => startTopUp.mutate()}>
              {startTopUp.isPending ? 'Opening the card page…' : `Pay ${formatUsd(amount)} with ${provider}`}
            </Button>
          </div>
        ) : (
          <>
            <p className="mt-2 text-14 text-muted">The name on the card must be {ME.name}. This preview has no payments; nothing is charged.</p>
            <form className="mt-4 flex flex-col gap-3" onSubmit={e => { e.preventDefault(); setAdded(a => a + amount); setPaying(false); toast(`Added ${formatUsd(amount)} to your balance`); }}>
              <Field label="Name on card" htmlFor="pay-name"><Input id="pay-name" defaultValue={ME.name} /></Field>
              <Field label="Card number" htmlFor="pay-card"><Input id="pay-card" inputMode="numeric" placeholder="1234 5678 9012 3456" /></Field>
              <Button type="submit" variant="primary" size="lg" block>Pay {formatUsd(amount)}</Button>
            </form>
          </>
        )}
      </Modal>
    </Page>
  );
}
