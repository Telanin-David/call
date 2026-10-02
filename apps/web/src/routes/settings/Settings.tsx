import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlan, PLAN_LABEL } from '@/lib/plan';
import { BALANCE, ME } from '@/lib/fake';
import { formatUsd } from '@/lib/money';
import { FEE_INTRO, FEE_LATER, NUMBER_MONTHLY } from '@/lib/pricing';
import Icon, { type IconName } from '@/components/Icon';

type Section = 'account' | 'billing' | 'numbers' | 'calling' | 'verify' | 'rules';

const NAV: { key: Section; label: string; icon: IconName }[] = [
  { key: 'account', label: 'Account', icon: 'i-users' },
  { key: 'billing', label: 'Plan and billing', icon: 'i-wallet' },
  { key: 'numbers', label: 'Numbers', icon: 'i-phone' },
  { key: 'calling', label: 'Calling', icon: 'i-call' },
  { key: 'verify', label: 'Verify your ID', icon: 'i-shield' },
  { key: 'rules', label: 'Rules', icon: 'i-file' },
];

const NUMBERS = [
  { number: '+1 (646) 555-0142', detail: 'New York · default · renews 2 Nov' },
  { number: '+1 (312) 555-0187', detail: 'Chicago · renews 9 Nov' },
  { number: '+1 (416) 555-0123', detail: 'Toronto · renews 14 Nov' },
];

function Kv({ label, children, action }: { label: string; children: ReactNode; action?: string }) {
  return (
    <div className="dl-kv">
      <span>{label}</span>
      <span className="dl-kv-val">{children}</span>
      {action && <button className="dl-link dl-link--14">{action}</button>}
    </div>
  );
}

function NumbersPanel() {
  return (
    <section className="dl-panel">
      <div className="dl-panel-head"><b>Numbers</b><span className="dl-aside-note">{NUMBERS.length} numbers · {formatUsd(NUMBER_MONTHLY * NUMBERS.length)} a month</span></div>
      <div className="dl-kvs">
        {NUMBERS.map(n => <Kv key={n.number} label={n.number} action="Cancel">{n.detail} · {formatUsd(NUMBER_MONTHLY)}</Kv>)}
        <Kv label="Calls go out from" action="Change">The number closest to the lead. If none is close, your default.</Kv>
      </div>
      <button className="dl-btn dl-btn--outline">Get another number</button>
    </section>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const { plan } = usePlan();
  const [section, setSection] = useState<Section>('billing');

  return (
    <div className="dl-settings">
      <nav className="dl-snav" aria-label="Settings">
        <h1>Settings</h1>
        {NAV.map(n => (
          <button key={n.key} aria-current={section === n.key ? 'page' : undefined} onClick={() => setSection(n.key)}>
            <Icon name={n.icon} size={17} />{n.label}
          </button>
        ))}
      </nav>

      <div className="dl-col dl-col--16">
        {section === 'billing' && (
          <>
            <section className="dl-hero" aria-label="Your plan">
              <div className="dl-hero-row">
                <div className="dl-grow">
                  <div className="dl-hero-eyebrow">YOUR PLAN</div>
                  <div className="dl-hero-plan">{PLAN_LABEL[plan]}</div>
                  <div className="dl-hero-meta">
                    {plan === 'free'
                      ? 'Call by hand, 30 dials a day. No monthly fee.'
                      : `${formatUsd(FEE_INTRO[plan])} a month · month 1 of 3 · then ${formatUsd(FEE_LATER[plan])} from 1 Jan 2027`}
                  </div>
                </div>
                {plan !== 'pro' && <button className="dl-btn dl-btn--lg dl-btn--lemon" onClick={() => navigate('/plans')}>See {plan === 'free' ? 'Starter' : 'Pro'}</button>}
                <button className="dl-btn dl-btn--lg dl-btn--glass" onClick={() => navigate('/plans')}>Change plan</button>
              </div>
            </section>
            <section className="dl-panel">
              <b className="dl-heading">Billing</b>
              <div className="dl-kvs">
                {plan !== 'free' && <Kv label="Next plan charge">1 Nov 2026 · {formatUsd(FEE_INTRO[plan])}</Kv>}
                <Kv label="Paid from">Your balance · {formatUsd(BALANCE)}</Kv>
                <Kv label="Low balance alert" action="Change">Below $5.00</Kv>
                {plan !== 'free' && <Kv label="Move to Free" action="Move to Free">Starts at your next renewal, 1 Nov. You keep {PLAN_LABEL[plan]} until then.</Kv>}
              </div>
            </section>
            <NumbersPanel />
          </>
        )}

        {section === 'numbers' && <NumbersPanel />}

        {section === 'account' && (
          <section className="dl-panel">
            <b className="dl-heading">Account</b>
            <div className="dl-kvs">
              <Kv label="Name" action="Change">{ME.name}</Kv>
              <Kv label="Email" action="Change">{ME.email}</Kv>
              <Kv label="Phone" action="Change">+234 803 123 4567</Kv>
              <Kv label="Password" action="Change">Last changed 12 Sep</Kv>
            </div>
          </section>
        )}

        {section === 'calling' && (
          <section className="dl-panel">
            <b className="dl-heading">Calling</b>
            <div className="dl-kvs">
              <Kv label="How you talk" action="Change">Your phone, Pixel 6a</Kv>
              <Kv label="Script text size" action="Change">Large</Kv>
              <Kv label="Auto-dial gap" action="Change">{plan === 'free' ? 'Tap to call on Free' : '5 seconds after you pick a result'}</Kv>
            </div>
          </section>
        )}

        {section === 'verify' && (
          <section className="dl-panel">
            <b className="dl-heading">Verify your ID</b>
            <div className="dl-kvs">
              <Kv label="Status">Not verified · new account limits apply</Kv>
              <Kv label="What it changes">Removes new-account dial limits and the $3 a day cap on calls outside the US and Canada. On Starter, raises your limit from 120 to 500 dials a day.</Kv>
            </div>
            <button className="dl-btn dl-btn--primary">Verify my ID</button>
          </section>
        )}

        {section === 'rules' && (
          <section className="dl-panel">
            <b className="dl-heading">Rules</b>
            <div className="dl-kvs">
              <Kv label="One account">One account per person. The card name must match your account name.</Kv>
              <Kv label="Same number">Each phone number can be called at most 3 times.</Kv>
              <Kv label="Do not call">Numbers on the do-not-call list are skipped and never charged.</Kv>
              <Kv label="Premium numbers">900, 976 and other premium-rate numbers are never dialled.</Kv>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
