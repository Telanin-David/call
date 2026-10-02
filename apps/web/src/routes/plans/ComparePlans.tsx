import { Link, useNavigate } from 'react-router-dom';
import { usePlan, PLAN_LABEL, type Plan } from '@/lib/plan';
import { BALANCE } from '@/lib/fake';
import { formatUsd } from '@/lib/money';
import { FEE_INTRO, FEE_LATER, formatRate } from '@/lib/pricing';
import Icon from '@/components/Icon';

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

function CellView({ value }: { value: Cell }) {
  if (value === true) return <Icon name="i-check" />;
  if (value === false) return <span className="dl-dash">—</span>;
  return <>{value}</>;
}

export default function ComparePlans() {
  const navigate = useNavigate();
  const { plan: current, setPlan } = usePlan();

  return (
    <div className="dl-wrap dl-wrap--plans">
      <div className="dl-plans-head">
        <div className="dl-grow">
          <Link className="dl-link dl-back dl-back--14" to="/call"><Icon name="i-left" size={16} />Back to calling</Link>
          <h1 className="dl-h1 dl-h1--xl">Pick your plan</h1>
          <p className="dl-lede dl-lede--lg">Free never ends. Every plan pays for calls from your balance, and the higher the plan, the less you pay a minute. Prices are in US dollars.</p>
        </div>
        <div className="dl-paidfrom"><Icon name="i-check" /><span>Paid from your balance<br /><b className="dl-num">{formatUsd(BALANCE)} available</b></span></div>
      </div>

      <div className="dl-plans">
        {PLANS.map(p => {
          const f = FEATURES[p];
          return (
            <section key={p} className={`dl-plancard dl-plancard--${p}`} aria-label={`${PLAN_LABEL[p]} plan`}>
              <div className="dl-plancard-tag"><span className="dl-pill">{PLAN_LABEL[p]}</span></div>
              <div>
                <div className="dl-plancard-price"><b>{formatUsd(FEE_INTRO[p]).replace('.00', '')}</b><span>a month</span></div>
                <p className="dl-plancard-note">
                  {p === 'free' ? 'No time limit. Keep calling as long as you like.' : `For your first 3 months. Then ${formatUsd(FEE_LATER[p])} a month after that.`}
                </p>
              </div>
              {p === current ? (
                <button className="dl-btn dl-btn--lg dl-btn--block dl-btn--current" disabled><Icon name="i-check" />Your plan</button>
              ) : (
                <button className={`dl-btn dl-btn--lg dl-btn--block ${p === 'pro' ? 'dl-btn--lemon' : 'dl-btn--primary'}`}
                  onClick={() => { setPlan(p); navigate('/settings'); }}>
                  Move to {PLAN_LABEL[p]}
                </button>
              )}
              <ul>
                {f.base && <li className="is-base"><Icon name="i-check" /><span>{f.base}</span></li>}
                {f.items.map(item => <li key={item}><Icon name="i-check" /><span>{item}</span></li>)}
              </ul>
            </section>
          );
        })}
      </div>

      <section>
        <h2 className="dl-h2">Compare everything</h2>
        <div className="dl-ctable">
          <div className="dl-crow dl-crow--head"><span>What you get</span><span>Free</span><span className="is-hl">Starter</span><span>Pro</span></div>
          {COMPARE.map(([label, free, starter, pro]) => (
            <div key={label} className="dl-crow">
              <span>{label}</span>
              <span><CellView value={free} /></span>
              <span className="is-hl"><CellView value={starter} /></span>
              <span><CellView value={pro} /></span>
            </div>
          ))}
          <div className="dl-crow"><span>How you pay for calls and numbers</span><span className="dl-span3">From your balance, on every plan</span></div>
        </div>
      </section>

      <div className="dl-howgrid">
        <div className="dl-how3"><span className="is-a"><Icon name="i-up" size={17} /></span><div><b>Upgrade starts now</b><p>You pay the difference for the rest of this month, shown before you confirm.</p></div></div>
        <div className="dl-how3"><span className="is-b"><Icon name="i-callback" size={17} /></span><div><b>Downgrade at renewal</b><p>You keep what you paid for until your next renewal date.</p></div></div>
        <div className="dl-how3"><span className="is-c"><Icon name="i-lock" size={17} /></span><div><b>New accounts have limits</b><p>Verify your ID to remove the new-account dial limits on any plan.</p></div></div>
      </div>
    </div>
  );
}
