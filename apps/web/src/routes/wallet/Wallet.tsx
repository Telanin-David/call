import { useState } from 'react';
import { usePlan, PLAN_LABEL } from '@/lib/plan';
import { BALANCE, ME } from '@/lib/fake';
import { formatUsd, usd } from '@/lib/money';
import { FEE_INTRO, NUMBER_MONTHLY, formatRate, minutesFor } from '@/lib/pricing';
import Icon from '@/components/Icon';

const AMOUNTS = [usd(10), usd(20), usd(50), usd(100)];
const CALLS_SPENT = usd(18, 42);

interface Entry { date: string; title: string; sub: string; amount: number }

export default function Wallet() {
  const { plan } = usePlan();
  const [amount, setAmount] = useState(usd(20));

  const fee = FEE_INTRO[plan];
  const spend = [
    { label: 'Calls', amount: CALLS_SPENT, tone: '' },
    ...(fee > 0 ? [{ label: `${PLAN_LABEL[plan]} plan`, amount: fee, tone: 'is-plan' }] : []),
    { label: 'Number', amount: NUMBER_MONTHLY, tone: 'is-number' },
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
    <div className="dl-wrap">
      <div>
        <h1 className="dl-h1">Wallet</h1>
        <p className="dl-lede">Everything is prepaid. Calls, your number and your plan come out of this balance.</p>
      </div>

      <div className="dl-wallet">
        <div className="dl-side">
          <section className="dl-hero" aria-label="Balance">
            <div className="dl-hero-eyebrow">BALANCE</div>
            <div className="dl-hero-money dl-num">{formatUsd(BALANCE)}</div>
            <div className="dl-hero-note">About {minutesFor(BALANCE, plan).toLocaleString('en-US')} minutes at {formatRate(plan)} on {PLAN_LABEL[plan]}</div>
            <div className="dl-amounts dl-amounts--dark">
              {AMOUNTS.map(a => (
                <button key={a} className="dl-chip" aria-pressed={amount === a} onClick={() => setAmount(a)}>{formatUsd(a).replace('.00', '')}</button>
              ))}
            </div>
            <button className="dl-btn dl-btn--primary dl-btn--lg dl-btn--block">Add {formatUsd(amount)} by card</button>
            <div className="dl-hero-fine">Name on card must be {ME.name}.</div>
          </section>
          <div className="dl-notecard dl-notecard--14">
            <span className="dl-tile t-lemon"><Icon name="i-wallet" size={17} /></span>
            <div><b>Low balance alert</b>Email and on-screen alert when you drop below <b>$5.00</b>.</div>
          </div>
        </div>

        <div className="dl-side">
          <section className="dl-panel">
            <div className="dl-panel-head dl-panel-head--16"><b>Spent in October</b><b className="dl-num">{formatUsd(total)}</b></div>
            <div className="dl-bars">
              {spend.map(s => (
                <div key={s.label} className="dl-barrow">
                  <div><span>{s.label}</span><b className="dl-num">{formatUsd(s.amount)}</b></div>
                  <div className="dl-bar8b"><i className={s.tone} style={{ width: `${Math.round((s.amount / total) * 100)}%` }} /></div>
                </div>
              ))}
            </div>
          </section>
          <section className="dl-panel">
            <div className="dl-panel-head dl-panel-head--4"><b>Activity</b><a className="dl-link" href="#">Download statement</a></div>
            {ledger.map((e, i) => (
              <div key={i} className="dl-ledger-row">
                <span>{e.date}</span>
                <div><b>{e.title}</b><p>{e.sub}</p></div>
                <b className={`dl-num${e.amount > 0 ? ' is-credit' : ''}`}>{e.amount > 0 ? '+' : '−'}{formatUsd(Math.abs(e.amount))}</b>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
