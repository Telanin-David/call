import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, CardHead, DarkCard, DarkEyebrow, Field, Icon, Input, LinkButton, Modal, Note, Pill, Select, cn, linkClass, useToast, type IconName } from '@dialer/ui';
import { usePlan, PLAN_LABEL } from '@/lib/plan';
import { useSimStore } from '@/lib/sim';
import { BALANCE, ME } from '@/lib/fake';
import { formatUsd } from '@/lib/money';
import { DIALS_PER_DAY, FEE_INTRO, FEE_LATER, NUMBER_MONTHLY, formatRate } from '@/lib/pricing';
import { isLive } from '@/lib/backend';
import { errorText } from '@/lib/api';
import { useChangePlan, useMe, usePlans, useSignout, useSubscription } from '@/lib/account';
import { dayBefore, dayMonth, dayMonthYear } from '@/lib/dates';
import { prettyNumber, useMyNumbers, useNumberAction, type RentedNumber } from '@/lib/numbers';
import { useVerification, type Verification } from '@/lib/verification';
import { GAPS, autodialGap, setAutodialGap } from '@/lib/calling';

type Section = 'profile' | 'billing' | 'numbers' | 'calling' | 'verify' | 'rules';

const NAV: { key: Section; label: string; icon: IconName }[] = [
  { key: 'profile', label: 'Profile', icon: 'user' },
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

function Section({ title, sub, aside, children }: { title: string; sub?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <Card as="section" aria-label={title}>
      <CardHead title={title} className="mb-0">{aside}</CardHead>
      {sub && <p className="mt-1 text-14 text-muted">{sub}</p>}
      <div className="mt-2.5">{children}</div>
    </Card>
  );
}

const VERIFY_STATUS: Record<Verification['status'], string> = {
  none: 'Not verified · new account limits apply',
  pending: "Checking your photos · usually under 10 minutes",
  review: "Checking by hand · the name on the ID doesn't match",
  approved: 'Verified · new account limits are off',
  rejected: "Last check didn't pass · new account limits apply",
};

const SECTIONS = new Set<Section>(['profile', 'billing', 'numbers', 'calling', 'verify', 'rules']);

interface Edit { label: string; value: string; options?: string[]; secret?: boolean }

const OUT_FROM = ['The number closest to the lead. If none is close, your default.', 'Always your default number'];

function NumbersPanel({ onEdit, values }: { onEdit: (e: Edit) => void; values: Record<string, string> }) {
  const live = isLive();
  const navigate = useNavigate();
  const toast = useToast();
  const mine = useMyNumbers();
  const act = useNumberAction();
  const [demoNumbers, setDemoNumbers] = useState(NUMBERS);
  const [cancel, setCancel] = useState<{ id: string; label: string; until: string } | null>(null);
  const outFrom = values['Calls go out from'] ?? OUT_FROM[0] ?? '';
  const rows = live ? mine.data?.numbers ?? [] : [];
  const count = live ? rows.length : demoNumbers.length;
  const total = live ? mine.data?.monthly_total_microdollars ?? 0 : NUMBER_MONTHLY * demoNumbers.length;

  function run(id: string, action: 'default' | 'cancel' | 'keep', done: string) {
    act.mutate({ id, action }, { onSuccess: () => toast(done) });
  }

  function detail(n: RentedNumber): string {
    const parts = [n.city || (n.country === 'CA' ? 'Canada' : 'United States')];
    if (n.is_default) parts.push('default');
    parts.push(n.cancel_on ? `yours until ${dayMonth(dayBefore(n.cancel_on))}` : `renews ${dayMonth(n.renews_on)}`);
    return `${parts.join(' · ')} · ${formatUsd(n.monthly_price_microdollars)}`;
  }

  return (
    <Section title="Numbers" sub="The US and Canada numbers your calls come from. Each is paid monthly from your balance."
      aside={<span className="text-14 text-muted">{count} number{count === 1 ? '' : 's'} · {formatUsd(total)} a month</span>}>
      {live ? (
        <>
          {mine.isPending && <p className="py-3 text-14 text-muted">Loading your numbers…</p>}
          {mine.isSuccess && rows.length === 0 && <p className="border-t border-line py-3.5 text-14 text-muted">No numbers yet. Leads see your number when you call, so get one before you start.</p>}
          {act.isError && <Note tone="danger" className="my-2 text-14"><Icon name="wrong" size={16} /><span role="alert">{errorText(act.error)}</span></Note>}
          {rows.map(n => (
            <div key={n.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line py-3.5 text-14">
              <span className="w-full flex-none font-semibold tabular-nums sm:w-[200px]">{prettyNumber(n.number)}</span>
              <span className="min-w-0 flex-1 text-ink-2">{detail(n)}</span>
              <span className="flex gap-4">
                {!n.is_default && !n.cancel_on && <LinkButton className="text-14" onClick={() => run(n.id, 'default', `${prettyNumber(n.number)} is your default now`)}>Make default</LinkButton>}
                {n.cancel_on
                  ? <LinkButton className="text-14" onClick={() => run(n.id, 'keep', `You're keeping ${prettyNumber(n.number)}`)}>Keep it</LinkButton>
                  : <LinkButton className="text-14" onClick={() => setCancel({ id: n.id, label: prettyNumber(n.number), until: dayMonth(dayBefore(n.renews_on)) })}>Cancel</LinkButton>}
              </span>
              {n.renewal_failed_at && !n.cancel_on && (
                <Note tone="danger" className="mt-1 w-full text-13"><Icon name="wallet" size={15} />
                  <span>This month couldn't be paid. Add money within 3 days or the number is released. <Link to="/wallet" className={linkClass}>Top up</Link></span>
                </Note>
              )}
            </div>
          ))}
        </>
      ) : (
        demoNumbers.map(n => <Kv key={n.number} label={n.number} action="Cancel" onAction={() => setCancel({ id: n.number, label: n.number, until: '' })}>{n.detail} · {formatUsd(NUMBER_MONTHLY)}</Kv>)
      )}
      <Kv label="Calls go out from" action="Change" onAction={() => onEdit({ label: 'Calls go out from', value: outFrom, options: OUT_FROM })}>{outFrom}</Kv>
      <Button variant="outline" className="mt-3" onClick={() => navigate('/numbers?from=settings')}>{live && rows.length === 0 ? 'Get a number' : 'Get another number'}</Button>
      <Modal open={cancel !== null} onClose={() => setCancel(null)} title={`Cancel ${cancel?.label ?? ''}?`} width="sm">
        <p className="mt-2 text-15 text-muted">
          {cancel?.until ? `You keep it until ${cancel.until}, the end of the month you paid for.` : 'You keep it until the end of the month you paid for.'} Leads who call it after that won't reach you.
        </p>
        <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
          <Button size="lg" onClick={() => setCancel(null)}>Keep it</Button>
          <Button variant="outlineDanger" size="lg" onClick={() => {
            if (!cancel) return;
            if (live) run(cancel.id, 'cancel', `${cancel.label} cancelled. It's yours until ${cancel.until}.`);
            else { setDemoNumbers(ns => ns.filter(x => x.number !== cancel.id)); toast(`${cancel.label} cancelled`); }
            setCancel(null);
          }}>Cancel number</Button>
        </div>
      </Modal>
    </Section>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const { plan } = usePlan();
  // The open section lives in the address (?tab=billing), so a refresh or a
  // link from another screen lands on the right one. Profile is the default.
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') as Section | null;
  const section: Section = tab && SECTIONS.has(tab) ? tab : 'profile';
  const setSection = useCallback((next: Section) => setParams(next === 'profile' ? {} : { tab: next }, { replace: true }), [setParams]);
  const [askFree, setAskFree] = useState(false);
  const { sim, setSim } = useSimStore();
  useEffect(() => {
    if (sim !== 'movefree') return;
    setSection('billing');
    if (plan !== 'free') setAskFree(true);
    setSim(null);
  }, [sim, setSim, plan, setSection]);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const toast = useToast();
  const v = (label: string, fallback: string) => values[label] ?? fallback;
  const change = (label: string, fallback: string, extra?: Partial<Edit>) => () => setEdit({ label, value: v(label, fallback), ...extra });
  const [demoMovingToFree, setDemoMovingToFree] = useState(false);
  const paid = PLAN_LABEL[plan];
  const live = isLive();
  const me = useMe();
  const sub = useSubscription();
  const plans = usePlans();
  const changePlan = useChangePlan();
  const signout = useSignout();
  const verification = useVerification();
  const gapLabel = `${autodialGap()} seconds after you pick a result`;
  const s = sub.data;
  const movingToFree = live ? s?.pending_change === 'free' : demoMovingToFree;
  const renews = live ? s?.next_renewal ?? '' : '2026-11-01';
  const renewDay = renews ? dayMonth(renews) : '';
  const lastPaidDay = renews ? dayMonth(dayBefore(renews)) : '';
  const planInfo = plans.data?.plans.find(x => x.id === plan);
  const fullFee = live ? planInfo?.monthly_fee_microdollars ?? FEE_LATER[plan] : FEE_LATER[plan];
  const introFee = live ? planInfo?.intro_fee_microdollars ?? FEE_INTRO[plan] : FEE_INTRO[plan];
  const balance = live ? me.data?.balance_microdollars ?? 0 : BALANCE;
  const planLine = !live
    ? `${formatUsd(FEE_INTRO[plan])} a month · month 1 of 3 · then ${formatUsd(FEE_LATER[plan])} from 1 Jan 2027`
    : s?.intro_ends_on
      ? `${formatUsd(introFee)} a month until ${dayMonthYear(s.intro_ends_on)} · then ${formatUsd(fullFee)}`
      : `${formatUsd(fullFee)} a month`;
  function setMoveToFree(on: boolean) {
    if (!live) { setDemoMovingToFree(on); return; }
    changePlan.mutate(on ? 'free' : plan, {
      onSuccess: () => toast(on ? `You'll move to Free on ${renewDay}` : `You're staying on ${paid}`),
      onError: err => toast(errorText(err)),
    });
  }
  const profile = live && me.data
    ? { name: me.data.name, email: me.data.email, phone: me.data.phone }
    : { name: ME.name, email: ME.email, phone: '+234 803 123 4567' };

  function signOut() {
    if (!live) { navigate('/signin'); return; }
    signout.mutate(undefined, { onSettled: () => navigate('/signin', { replace: true }) });
  }
  const loses = [
    'Auto-dial. You tap Call on each lead',
    'Phone and laptop together',
    'Callback alerts',
    ...(plan === 'pro' ? ['Recording, transcripts and summaries', 'Dialling 2 lines at once'] : []),
    `Calls go up to ${formatRate('free')} a minute`,
    `Dials drop to ${DIALS_PER_DAY.free} a day`,
  ];

  return (
    <div className="mx-auto grid max-w-[1168px] items-start gap-4 px-4 py-5 sm:px-6 lg:grid-cols-[264px_minmax(0,1fr)] lg:gap-8 lg:py-8">
      <div className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-0">
        <h1 className="text-28 font-extrabold tracking-[-0.04em] lg:pl-3 lg:text-30">Settings</h1>
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3.5">
          <span className="flex size-11 flex-none items-center justify-center rounded-full bg-brand-tint text-brand-ink"><Icon name="user" size={22} /></span>
          <div className="min-w-0 flex-1">
            <b className="block text-16 leading-5 [overflow-wrap:anywhere]">{profile.name}</b>
            <span className="block truncate text-13 text-muted" title={profile.email}>{profile.email}</span>
            <Pill tone={plan === 'pro' ? 'lemon' : plan === 'starter' ? 'brand' : 'neutral'} className="mt-1.5">{PLAN_LABEL[plan]} plan</Pill>
          </div>
        </div>
        <nav aria-label="Settings" className="flex gap-1 max-lg:-mx-4 max-lg:overflow-x-auto max-lg:px-4 max-lg:pb-1 max-lg:[scrollbar-width:none] sm:max-lg:mx-0 sm:max-lg:px-0 lg:flex-col">
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
        </nav>
        <button type="button" onClick={signOut} disabled={signout.isPending}
          className="flex cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-3 py-2.5 text-left text-15 font-medium text-danger-ink hover:bg-danger-soft max-lg:hidden">
          <Icon name="left" size={17} />Sign out
        </button>
      </div>

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
                      : planLine}
                  </div>
                </div>
                {plan !== 'pro' && <Button variant="lemon" size="lg" onClick={() => navigate('/plans')}>See {plan === 'free' ? 'Starter' : 'Pro'}</Button>}
                <Button variant="glass" size="lg" onClick={() => navigate('/plans')}>Change plan</Button>
              </div>
            </DarkCard>
            {live && s?.grace_ends_at && (
              <Note tone="danger" className="text-14">
                <span role="alert">Your {paid} renewal couldn&apos;t be paid. Add money by <b>{dayMonth(s.grace_ends_at)}</b> to keep it, or you move to Free.</span>
              </Note>
            )}
            <Section title="Billing" sub="Your plan, calls and numbers are all paid from your balance.">
              {plan !== 'free' && !movingToFree && (
                <Kv label="Next plan charge">
                  {live ? `${dayMonthYear(renews)} · ${formatUsd(s?.next_charge_microdollars ?? 0)}${s?.pending_change ? ` for ${PLAN_LABEL[s.pending_change as 'free' | 'starter' | 'pro']}` : ''}` : `1 Nov 2026 · ${formatUsd(FEE_INTRO[plan])}`}
                </Kv>
              )}
              <Kv label="Paid from">Your balance · {formatUsd(balance)}</Kv>
              <Kv label="Low balance alert" action="Change" onAction={change('Low balance alert', 'Below $5.00', { options: ['Below $2.00', 'Below $5.00', 'Below $10.00', 'Off'] })}>{v('Low balance alert', 'Below $5.00')}</Kv>
              {plan !== 'free' && (movingToFree
                ? <Kv label="Moving to Free" action="Stay on plan" onAction={() => setMoveToFree(false)}>On {renewDay}. You keep {paid} until {lastPaidDay}.</Kv>
                : <Kv label="Move to Free" action="Move to Free" onAction={() => setAskFree(true)}>Starts at your next renewal, {renewDay}. You keep {paid} until then.</Kv>)}
            </Section>
          </>
        )}

        {section === 'numbers' && <NumbersPanel onEdit={setEdit} values={values} />}

        {section === 'profile' && (
          <Section title="Profile" sub="Your name must match your ID and the name on your card.">
            {live && me.data ? (
              <>
                <Kv label="Name">{me.data.name}</Kv>
                <Kv label="Email">{me.data.email}</Kv>
                <Kv label="Phone">{me.data.phone}</Kv>
                <Kv label="Password" action="Change" onAction={() => navigate('/forgot')}>Change it with a code sent to your phone</Kv>
              </>
            ) : (
              <>
                <Kv label="Name" action="Change" onAction={change('Name', ME.name)}>{v('Name', ME.name)}</Kv>
                <Kv label="Email" action="Change" onAction={change('Email', ME.email)}>{v('Email', ME.email)}</Kv>
                <Kv label="Phone" action="Change" onAction={change('Phone', '+234 803 123 4567')}>{v('Phone', '+234 803 123 4567')}</Kv>
                <Kv label="Password" action="Change" onAction={() => setEdit({ label: 'Password', value: '', secret: true })}>{v('Password', 'Last changed 12 Sep')}</Kv>
              </>
            )}
            <Button variant="outlineDanger" className="mt-3 lg:hidden" disabled={signout.isPending} onClick={signOut}>Sign out</Button>
          </Section>
        )}

        {section === 'calling' && (
          <Section title="Calling" sub="How you talk to leads and how the dialer paces your calls.">
            <Kv label="How you talk" action="Change" onAction={change('How you talk', 'Your phone, Pixel 6a', { options: ['Your phone, Pixel 6a', 'This laptop'] })}>{v('How you talk', 'Your phone, Pixel 6a')}</Kv>
            <Kv label="Script text size" action="Change" onAction={change('Script text size', 'Large', { options: ['Medium', 'Large', 'Extra large'] })}>{v('Script text size', 'Large')}</Kv>
            {plan === 'free'
              ? <Kv label="Auto-dial gap">Tap to call on Free</Kv>
              : <Kv label="Auto-dial gap" action="Change" onAction={change('Auto-dial gap', gapLabel, { options: GAPS.map(g => `${g} seconds after you pick a result`) })}>{v('Auto-dial gap', gapLabel)}</Kv>}
          </Section>
        )}

        {section === 'verify' && (
          <Section title="Verify your ID" sub="A quick photo of your ID and your face. It lifts the new-account limits.">
            <Kv label="Status">{live ? VERIFY_STATUS[verification.data?.status ?? 'none'] : 'Not verified · new account limits apply'}</Kv>
            <Kv label="What it changes">Removes new-account dial limits and the $3 a day cap on calls outside the US and Canada. On Starter, raises your limit from 120 to 500 dials a day.</Kv>
            {!(live && verification.data?.status === 'approved') && (
              <Button variant="primary" className="mt-3" onClick={() => navigate('/verify')}>
                {live && (verification.data?.status === 'pending' || verification.data?.status === 'review') ? 'See the check' : 'Verify my ID'}
              </Button>
            )}
          </Section>
        )}

        {section === 'rules' && (
          <Section title="Rules" sub="Short and fair. They keep your numbers working.">
            <Kv label="One account">One account per person. The card name must match your account name.</Kv>
            <Kv label="Same number">Each phone number can be called at most 3 times.</Kv>
            <Kv label="Do not call">Numbers on the do-not-call list are skipped and never charged.</Kv>
            <Kv label="Premium numbers">900, 976 and other premium-rate numbers are never dialled.</Kv>
            <Button variant="outline" className="mt-3" onClick={() => navigate('/rules')}>Read all the rules</Button>
          </Section>
        )}
      </div>

      <Modal open={edit !== null} onClose={() => setEdit(null)} title={`Change ${edit?.label.toLowerCase() ?? ''}`} width="sm">
        {edit && (
          <form className="mt-4 flex flex-col gap-4" onSubmit={e => {
            e.preventDefault();
            const value = String(new FormData(e.currentTarget).get('value') ?? '').trim();
            if (!value) return;
            if (edit.label === 'Auto-dial gap') setAutodialGap(Number.parseInt(value, 10));
            setValues(vs => ({ ...vs, [edit.label]: edit.secret ? 'Changed just now' : value }));
            toast(`${edit.label} updated`);
            setEdit(null);
          }}>
            <Field label={edit.secret ? 'New password' : edit.label} htmlFor="edit-value">
              {edit.options
                ? <Select id="edit-value" name="value" defaultValue={edit.value}>{edit.options.map(o => <option key={o}>{o}</option>)}</Select>
                : <Input id="edit-value" name="value" type={edit.secret ? 'password' : 'text'} defaultValue={edit.value} autoFocus minLength={edit.secret ? 10 : undefined} />}
            </Field>
            <Button type="submit" variant="primary" size="lg" block>Save</Button>
          </form>
        )}
      </Modal>

      <Modal open={askFree} onClose={() => setAskFree(false)} title={`Move to Free on ${renewDay}?`}>
        <p className="mt-3 text-15 text-muted">You keep {paid} until <b className="text-ink">{lastPaidDay}</b>, because you've paid for it. On {renewDay} you lose:</p>
        <ul className="mt-4 flex list-none flex-col gap-3 rounded-2xl bg-danger-tint px-[18px] py-4 text-14">
          {loses.map(l => <li key={l} className="flex items-start gap-2.5"><Icon name="x" size={16} className="mt-0.5 text-danger" />{l}</li>)}
        </ul>
        <p className="mt-4 text-13 text-muted">
          Your leads, follow-ups, history and number stay. Your intro price ends, so coming back later costs {formatUsd(fullFee).replace('.00', '')} a month.
        </p>
        <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
          <Button size="lg" onClick={() => setAskFree(false)}>Stay on {paid}</Button>
          <Button variant="outlineDanger" size="lg" disabled={changePlan.isPending} onClick={() => { setMoveToFree(true); setAskFree(false); }}>Move to Free on {renewDay}</Button>
        </div>
      </Modal>
    </div>
  );
}
