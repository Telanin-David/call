import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, CardHead, DarkCard, DarkEyebrow, Icon, Kpis, PageHeader, Person, Pill, Stat, Tile, buttonClass, cn, linkClass } from '@dialer/ui';
import { Page } from '@/components/Page';
import { usePlan } from '@/lib/plan';
import { isLive } from '@/lib/backend';
import { useMe } from '@/lib/account';
import { OUTCOME_LABEL, OUTCOME_TONE, clockIn, initialsOf, isOutcome, talkTime, toneOf, useToday, type Followup } from '@/lib/activity';
import { useMyNumbers } from '@/lib/numbers';
import { formatUsd } from '@/lib/money';
import { FOLLOWUPS_TODAY, ME, RESULT_LABEL, RESULT_TONE } from '@/lib/fake';
import { DIALS_PER_DAY } from '@/lib/pricing';

function greeting(zone: string): string {
  let h = new Date().getHours();
  try {
    h = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: zone }));
  } catch { /* the browser's own hour */ }
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function dueText(f: Followup): string {
  const her = clockIn(f.lead.her_time_zone, new Date(f.due_at));
  return her ? `${her} their time` : new Date(f.due_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
}

export default function Today() {
  const live = isLive();
  const navigate = useNavigate();
  const { plan } = usePlan();
  const me = useMe();
  const today = useToday();
  const numbers = useMyNumbers();
  const t = today.data;
  const zone = me.data?.timezone ?? 'UTC';
  const first = live ? (me.data?.name ?? '').split(' ')[0] ?? '' : ME.first;
  const limit = live ? t?.dial_limit ?? undefined : DIALS_PER_DAY[plan];
  const due = FOLLOWUPS_TODAY.filter(f => f.result !== 'missed');
  const dateLine = live
    ? new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: zone })
    : 'Wednesday 1 October';
  const clocks = live
    ? `Your time ${clockIn(zone)} · New York ${clockIn('America/New_York')}`
    : 'Your time 8:14 pm · New York 3:14 pm';
  const myNumbers = numbers.data?.numbers ?? [];
  const cities = [...new Set(myNumbers.map(n => n.city.split(',')[0]).filter(Boolean))].join(', ');

  return (
    <Page>
      <PageHeader eyebrow={dateLine} title={live ? `${greeting(zone)}${first ? `, ${first}` : ''}` : `Good evening, ${ME.first}`}
        aside={<span className="text-14 text-muted">{clocks}</span>} />

      <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:gap-[18px]">
        <DarkCard as="section" aria-label="Ready to call">
          <DarkEyebrow>READY TO CALL</DarkEyebrow>
          {live && !t?.ready_list ? (
            <>
              <div className="mt-2 text-26 font-extrabold tracking-[-0.03em] sm:text-30">{today.isPending ? '…' : 'No leads to call'}</div>
              <div className="mt-0.5 text-15 text-zinc-400">Upload a list of people to call to get started.</div>
              <div className="mt-[22px] flex flex-wrap gap-2.5">
                <Button variant="primary" size="lg" className="px-[26px]" onClick={() => navigate('/leads/upload')}><Icon name="upload" />Upload a list</Button>
              </div>
            </>
          ) : (
            <>
              <div className="mt-2 text-26 font-extrabold tracking-[-0.03em] sm:text-30">{live ? t?.ready_list?.name : 'October leads'}</div>
              <div className="mt-0.5 text-15 text-zinc-400">
                {live ? `${t?.ready_list?.left ?? 0} left · script: ${t?.ready_list?.script_name || 'none yet'}` : '37 left · script: Office cleaning v2'}
              </div>
              <div className="mt-[22px] flex flex-wrap gap-2.5">
                <Button variant="primary" size="lg" className="px-[26px]"
                  onClick={() => navigate(live && t?.ready_list ? `/call?list=${t.ready_list.id}` : '/call')}><Icon name="call" />Start calling</Button>
                <Link to="/leads" className={buttonClass({ variant: 'glass', size: 'lg' })}>Pick a list</Link>
              </div>
            </>
          )}
        </DarkCard>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Dials today" value={live ? t?.dials_today ?? 0 : '0'} suffix={limit ? `/${limit}` : undefined} />
          <Stat label="Talk time" value={live ? talkTime(t?.today.talk_seconds ?? 0) : '0m'} />
          <Stat label="Spent today" value={live ? formatUsd(t?.today.spent_microdollars ?? 0) : '$0.00'} />
          <Stat label="Follow-ups due" value={live ? t?.followups_due ?? 0 : due.length} />
        </div>
      </div>

      <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:gap-[18px]">
        <Card as="section">
          <CardHead title="Follow-ups due today"><Link className={cn(linkClass, 'text-14')} to="/followups">See all</Link></CardHead>
          {live ? (
            <>
              {(t?.due ?? []).map(f => (
                <div key={f.id} className="flex items-center gap-3 border-t border-line py-3">
                  <Person initials={initialsOf(f.lead.name)} tone={toneOf(f.lead.id)} size={36} name={f.lead.name}
                    sub={[f.lead.company, dueText(f)].filter(Boolean).join(' · ')} className="flex-1" />
                  {isOutcome(f.last_outcome) && <Pill tone={OUTCOME_TONE[f.last_outcome]}>{OUTCOME_LABEL[f.last_outcome]}</Pill>}
                  <button type="button" aria-label={`Call ${f.lead.name}`} onClick={() => navigate(`/call/${f.lead.id}`)}
                    className="flex size-9 cursor-pointer items-center justify-center rounded-full border-0 bg-brand-soft text-brand-ink hover:bg-brand hover:text-on-brand">
                    <Icon name="call" size={16} />
                  </button>
                </div>
              ))}
              {t && t.due.length === 0 && <p className="border-t border-line py-4 text-14 text-muted">Nothing due today. Follow-ups you book after calls show up here.</p>}
            </>
          ) : due.map(f => (
            <div key={f.lead.id} className="flex items-center gap-3 border-t border-line py-3">
              <Person initials={f.lead.initials} tone={f.lead.tone} size={36} name={f.lead.name} sub={`${f.lead.company} · ${f.when}`} className="flex-1" />
              <Pill tone={RESULT_TONE[f.result]}>{RESULT_LABEL[f.result]}</Pill>
              <button type="button" aria-label={`Call ${f.lead.name}`} onClick={() => navigate(`/call/${f.lead.id}`)}
                className="flex size-9 cursor-pointer items-center justify-center rounded-full border-0 bg-brand-soft text-brand-ink hover:bg-brand hover:text-on-brand">
                <Icon name="call" size={16} />
              </button>
            </div>
          ))}
        </Card>
        <div className="flex flex-col gap-3.5">
          <Card as="section">
            <b className="text-17">Yesterday</b>
            <Kpis className="mt-3.5" items={live ? [
              { label: 'Calls', value: t?.yesterday.calls ?? 0 }, { label: 'Talked', value: talkTime(t?.yesterday.talk_seconds ?? 0) },
              { label: 'Interested', value: t?.yesterday.interested ?? 0, good: (t?.yesterday.interested ?? 0) > 0 },
              { label: 'Spent', value: formatUsd(t?.yesterday.spent_microdollars ?? 0) },
            ] : [
              { label: 'Calls', value: 86 }, { label: 'Talked', value: '1h 52m' },
              { label: 'Interested', value: 6, good: true }, { label: 'Spent', value: '$2.24' },
            ]} />
          </Card>
          <Link to={live && myNumbers.length === 0 ? '/numbers?from=settings' : '/settings?tab=numbers'}
            className="flex items-center gap-3 rounded-3xl border border-line bg-surface p-[18px] text-ink no-underline">
            <Tile tone="brand"><Icon name="phone" /></Tile>
            {live ? (
              myNumbers.length === 0 ? (
                <div className="flex-1"><b className="text-15">No number yet</b><p className="text-13 text-muted">Get one so leads see a local number</p></div>
              ) : (
                <div className="flex-1">
                  <b className="text-15">{myNumbers.length} number{myNumbers.length === 1 ? '' : 's'}</b>
                  <p className="text-13 text-muted">{[cities, `${formatUsd(numbers.data?.monthly_total_microdollars ?? 0)} a month`].filter(Boolean).join(' · ')}</p>
                </div>
              )
            ) : (
              <div className="flex-1"><b className="text-15">3 numbers</b><p className="text-13 text-muted">New York, Chicago, Toronto · $4.50 a month</p></div>
            )}
          </Link>
        </div>
      </div>
    </Page>
  );
}
