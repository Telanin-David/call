import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, CardHead, DarkCard, DarkEyebrow, Icon, LinkButton, Modal, cn, type IconName } from '@dialer/ui';
import { usePlan, PLAN_LABEL } from '@/lib/plan';
import { BALANCE, ME } from '@/lib/fake';
import { formatUsd } from '@/lib/money';
import { DIALS_PER_DAY, FEE_INTRO, FEE_LATER, NUMBER_MONTHLY, formatRate } from '@/lib/pricing';

type Section = 'account' | 'billing' | 'numbers' | 'calling' | 'verify' | 'rules';

const NAV: { key: Section; label: string; icon: IconName }[] = [
  { key: 'account', label: 'Account', icon: 'users' },
  { key: 'billing', label: 'Plan and billing', icon: 'wallet' },
  { key: 'numbers', label: 'Numbers', icon: 'phone' },
  { key: 'calling', label: 'Calling', icon: 'call' },
  { key: 'verify', label: 'Verify your ID', icon: 'shield' },
  { key: 'rules', label: 'Rules', icon: 'file' },
];

const NUMBERS = [
  { number: '+1 (646) 555-0142', detail: 'New York · default · renews 2 Nov' },
  { number: '+1 (312) 555-0187', detail: 'Chicago · renews 9 Nov' },
  { number: '+1 (416) 555-0123', detail: 'Toronto · renews 14 Nov' },
];

function Kv({ label, children, action, onAction }: { label: string; children: ReactNode; action?: string; onAction?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 border-t border-line py-3.5 text-14">
      <span className="w-full flex-none text-muted sm:w-[200px]">{label}</span>
      <span className="min-w-0 flex-1 font-semibold">{children}</span>
      {action && <LinkButton className="text-14" onClick={onAction}>{action}</LinkButton>}
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <Card as="section">
      <CardHead title={title} className="mb-0">{aside}</CardHead>
      <div className="mt-2.5">{children}</div>
    </Card>
  );
}

function NumbersPanel() {
  return (
    <Section title="Numbers" aside={<span className="text-14 text-muted">{NUMBERS.length} numbers · {formatUsd(NUMBER_MONTHLY * NUMBERS.length)} a month</span>}>
      {NUMBERS.map(n => <Kv key={n.number} label={n.number} action="Cancel">{n.detail} · {formatUsd(NUMBER_MONTHLY)}</Kv>)}
      <Kv label="Calls go out from" action="Change">The number closest to the lead. If none is close, your default.</Kv>
      <Button variant="outline" className="mt-3">Get another number</Button>
    </Section>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const { plan } = usePlan();
  const [section, setSection] = useState<Section>('billing');
  const [askFree, setAskFree] = useState(false);
  const [movingToFree, setMovingToFree] = useState(false);
  const paid = PLAN_LABEL[plan];
  const loses = [
    'Auto-dial. You tap Call on each lead',
    'Phone and laptop together',
    'Callback alerts',
    ...(plan === 'pro' ? ['Recording, transcripts and summaries', 'Dialling 2 lines at once'] : []),
    `Calls go up to ${formatRate('free')} a minute`,
    `Dials drop to ${DIALS_PER_DAY.free} a day`,
  ];

  return (
    <div className="mx-auto grid max-w-[1168px] items-start gap-4 px-4 py-5 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-8 lg:py-8">
      <nav className="flex min-w-0 flex-col gap-1" aria-label="Settings">
        <h1 className="pb-2 text-28 font-extrabold tracking-[-0.04em] lg:pb-4 lg:pl-3 lg:text-30">Settings</h1>
        <div className="flex gap-1 max-lg:-mx-4 max-lg:overflow-x-auto max-lg:px-4 max-lg:pb-1 max-lg:[scrollbar-width:none] sm:max-lg:mx-0 sm:max-lg:px-0 lg:flex-col">
        {NAV.map(n => {
          const current = section === n.key;
          return (
            <button key={n.key} type="button" aria-current={current ? 'page' : undefined} onClick={() => setSection(n.key)}
              className={cn('flex flex-none cursor-pointer items-center gap-2.5 whitespace-nowrap rounded-lg border-0 bg-transparent px-3 py-2.5 text-left text-15 font-medium text-ink',
                current && 'bg-surface font-bold shadow-[0_1px_3px_rgba(0,0,0,.06)]')}>
              <Icon name={n.icon} size={17} className={current ? 'text-brand-ink' : 'text-faint'} />{n.label}
            </button>
          );
        })}
        </div>
      </nav>

      <div className="flex flex-col gap-4">
        {section === 'billing' && (
          <>
            <DarkCard as="section" aria-label="Your plan">
              <div className="flex flex-wrap items-end gap-3 sm:gap-5">
                <div className="flex-1 max-sm:basis-full">
                  <DarkEyebrow>YOUR PLAN</DarkEyebrow>
                  <div className="mt-1 text-32 font-extrabold tracking-[-0.03em]">{PLAN_LABEL[plan]}</div>
                  <div className="mt-0.5 text-14 text-zinc-300">
                    {plan === 'free'
                      ? 'Call by hand, 30 dials a day. No monthly fee.'
                      : `${formatUsd(FEE_INTRO[plan])} a month · month 1 of 3 · then ${formatUsd(FEE_LATER[plan])} from 1 Jan 2027`}
                  </div>
                </div>
                {plan !== 'pro' && <Button variant="lemon" size="lg" onClick={() => navigate('/plans')}>See {plan === 'free' ? 'Starter' : 'Pro'}</Button>}
                <Button variant="glass" size="lg" onClick={() => navigate('/plans')}>Change plan</Button>
              </div>
            </DarkCard>
            <Section title="Billing">
              {plan !== 'free' && <Kv label="Next plan charge">1 Nov 2026 · {formatUsd(FEE_INTRO[plan])}</Kv>}
              <Kv label="Paid from">Your balance · {formatUsd(BALANCE)}</Kv>
              <Kv label="Low balance alert" action="Change">Below $5.00</Kv>
              {plan !== 'free' && (movingToFree
                ? <Kv label="Moving to Free" action="Stay on plan" onAction={() => setMovingToFree(false)}>On 1 Nov. You keep {paid} until 31 Oct.</Kv>
                : <Kv label="Move to Free" action="Move to Free" onAction={() => setAskFree(true)}>Starts at your next renewal, 1 Nov. You keep {paid} until then.</Kv>)}
            </Section>
            <NumbersPanel />
          </>
        )}

        {section === 'numbers' && <NumbersPanel />}

        {section === 'account' && (
          <Section title="Account">
            <Kv label="Name" action="Change">{ME.name}</Kv>
            <Kv label="Email" action="Change">{ME.email}</Kv>
            <Kv label="Phone" action="Change">+234 803 123 4567</Kv>
            <Kv label="Password" action="Change">Last changed 12 Sep</Kv>
          </Section>
        )}

        {section === 'calling' && (
          <Section title="Calling">
            <Kv label="How you talk" action="Change">Your phone, Pixel 6a</Kv>
            <Kv label="Script text size" action="Change">Large</Kv>
            <Kv label="Auto-dial gap" action="Change">{plan === 'free' ? 'Tap to call on Free' : '5 seconds after you pick a result'}</Kv>
          </Section>
        )}

        {section === 'verify' && (
          <Section title="Verify your ID">
            <Kv label="Status">Not verified · new account limits apply</Kv>
            <Kv label="What it changes">Removes new-account dial limits and the $3 a day cap on calls outside the US and Canada. On Starter, raises your limit from 120 to 500 dials a day.</Kv>
            <Button variant="primary" className="mt-3" onClick={() => navigate('/verify')}>Verify my ID</Button>
          </Section>
        )}

        {section === 'rules' && (
          <Section title="Rules">
            <Kv label="One account">One account per person. The card name must match your account name.</Kv>
            <Kv label="Same number">Each phone number can be called at most 3 times.</Kv>
            <Kv label="Do not call">Numbers on the do-not-call list are skipped and never charged.</Kv>
            <Kv label="Premium numbers">900, 976 and other premium-rate numbers are never dialled.</Kv>
            <Button variant="outline" className="mt-3" onClick={() => navigate('/rules')}>Read all the rules</Button>
          </Section>
        )}
      </div>

      <Modal open={askFree} onClose={() => setAskFree(false)} title="Move to Free on 1 Nov?">
        <p className="mt-3 text-15 text-muted">You keep {paid} until <b className="text-ink">31 Oct</b>, because you've paid for it. On 1 Nov you lose:</p>
        <ul className="mt-4 flex list-none flex-col gap-3 rounded-2xl bg-danger-tint px-[18px] py-4 text-14">
          {loses.map(l => <li key={l} className="flex items-start gap-2.5"><Icon name="x" size={16} className="mt-0.5 text-danger" />{l}</li>)}
        </ul>
        <p className="mt-4 text-13 text-muted">
          Your leads, follow-ups, history and number stay. Your intro price ends, so coming back later costs {formatUsd(FEE_LATER[plan]).replace('.00', '')} a month.
        </p>
        <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
          <Button size="lg" onClick={() => setAskFree(false)}>Stay on {paid}</Button>
          <Button variant="outlineDanger" size="lg" onClick={() => { setMovingToFree(true); setAskFree(false); }}>Move to Free on 1 Nov</Button>
        </div>
      </Modal>
    </div>
  );
}
