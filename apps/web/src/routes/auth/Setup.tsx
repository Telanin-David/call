import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ME } from '@/lib/fake';
import { formatUsd, usd } from '@/lib/money';
import Icon from '@/components/Icon';

const AMOUNTS = [usd(5), usd(10), usd(20), usd(50)];
const FREE_RATE_PER_MIN = usd(0, 2.5);

type StepState = 'done' | 'now' | 'todo';

interface Step {
  title: string;
  body: string;
  state: StepState;
  tag?: string;
}

const STEPS: Step[] = [
  { title: 'Confirm email and phone', body: 'Done in the last step', state: 'done' },
  { title: 'Agree to the rules', body: 'Limits, numbers you can call, one account per person', state: 'done' },
  { title: 'Add money', body: 'Everything is prepaid. Calls and numbers come out of your balance.', state: 'now' },
  { title: 'Get a US or Canada number', body: 'The number leads see and call back. $1.50 a month.', state: 'todo', tag: 'After step 3' },
  { title: 'Upload your leads', body: 'A CSV file from your laptop', state: 'todo' },
  { title: 'Add your script', body: 'Paste it or upload a file', state: 'todo' },
];

export default function Setup() {
  const navigate = useNavigate();
  const [amount, setAmount] = useState(usd(10));
  const done = STEPS.filter(s => s.state === 'done').length;

  return (
    <div className="dl-twocol">
      <div className="dl-col">
        <div className="dl-setup-head">
          <h1 className="dl-h1">Let's get you calling, {ME.first}</h1>
          <div className="dl-progressline">
            <div className="dl-bar8"><span style={{ width: `${Math.round((done / STEPS.length) * 100)}%` }} /></div>
            <span><b>{done} of {STEPS.length} done</b> · about 4 minutes left</span>
          </div>
        </div>

        {STEPS.map((s, i) => (
          <section key={s.title} className={`dl-stepcard is-${s.state}`}>
            <div className="dl-stephead">
              <span className="dl-stepnum">{s.state === 'done' ? <Icon name="i-check" size={15} /> : i + 1}</span>
              <div className="dl-grow"><b>{s.title}</b><p>{s.body}</p></div>
              {s.state === 'done' && <span className="dl-steptag is-ok">Done</span>}
              {s.tag && <span className="dl-steptag">{s.tag}</span>}
            </div>
            {s.state === 'now' && (
              <div className="dl-stepbody">
                <div className="dl-col">
                  <div className="dl-amounts">
                    {AMOUNTS.map(a => (
                      <button key={a} className="dl-chip" aria-pressed={amount === a} onClick={() => setAmount(a)}>{formatUsd(a).replace('.00', '')}</button>
                    ))}
                  </div>
                  <div className="dl-hint-brand">
                    <Icon name="i-globe" />
                    <span>On Free, calls to the US and Canada cost <b>$0.025 a minute</b>. {formatUsd(amount)} is about <b>{Math.floor(amount / FREE_RATE_PER_MIN)} minutes</b>.</span>
                  </div>
                </div>
                <div className="dl-paybox">
                  <div className="dl-price"><span className="dl-muted">Top-up</span><b>{formatUsd(amount)}</b></div>
                  <div className="dl-price dl-price--total"><span>You pay</span><b>{formatUsd(amount)}</b></div>
                  <button className="dl-btn dl-btn--primary dl-btn--lg dl-btn--block" onClick={() => navigate('/numbers')}>Pay {formatUsd(amount)} by card</button>
                  <span className="dl-fine">The name on the card must be {ME.name}. Your bank may add a fee for paying in US dollars.</span>
                </div>
              </div>
            )}
          </section>
        ))}
      </div>

      <aside className="dl-side dl-side--sticky">
        <div className="dl-darkcard">
          <div className="dl-hero-eyebrow">YOUR PLAN</div>
          <div className="dl-darkcard-title">Free</div>
          <p className="dl-darkcard-body">Call by hand, 30 dials a day. Your script shows on screen for your first 2 months.</p>
          <Link className="dl-link" to="/plans">See all plans</Link>
        </div>
        <div className="dl-notecard">
          <span className="dl-tile t-lemon"><Icon name="i-lock" size={17} /></span>
          <div><b>New account limits</b>Verify your ID any time to remove them. You can do it later from Settings.</div>
        </div>
      </aside>
    </div>
  );
}
