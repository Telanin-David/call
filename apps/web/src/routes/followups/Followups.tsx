import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Icon, List, ListRow, PageHeader, Person, Pill, TabPills } from '@dialer/ui';
import { Page } from '@/components/Page';
import { isLive } from '@/lib/backend';
import { MISSED_NOTE, OUTCOME_LABEL, OUTCOME_TONE, clockIn, initialsOf, isOutcome, relative, toneOf, useFollowups, whenLabel, type FollowupTab } from '@/lib/activity';
import { FOLLOWUPS_TODAY, RESULT_LABEL, RESULT_TONE } from '@/lib/fake';

const DEMO_COUNTS: Record<FollowupTab, number> = { today: 5, tomorrow: 3, week: 9, later: 14 };
const LABELS: Record<FollowupTab, string> = { today: 'Due today', tomorrow: 'Tomorrow', week: 'This week', later: 'Later' };

const COLS = 'grid-cols-[280px_170px_minmax(0,1fr)_120px_90px]';

export default function Followups() {
  const live = isLive();
  const navigate = useNavigate();
  const [tab, setTab] = useState<FollowupTab>('today');
  const data = useFollowups(tab);
  const counts = live ? data.data?.counts : DEMO_COUNTS;
  const tabs = (Object.keys(LABELS) as FollowupTab[]).map(value => ({ value, label: LABELS[value], count: counts?.[value] ?? 0 }));
  const demoRows = tab === 'today' ? FOLLOWUPS_TODAY : [];
  const liveRows = data.data?.followups ?? [];
  const dueToday = live ? counts?.today ?? 0 : FOLLOWUPS_TODAY.length;
  const now = new Date();

  return (
    <Page width={1200}>
      <PageHeader title="Follow-ups" lede="People you said you'd call back, and people who called you."
        aside={dueToday > 0 && (
          <Button variant="primary" size="lg" onClick={() => navigate('/call?followups=1')}><Icon name="call" size={17} />Call all {dueToday} in order</Button>
        )} />

      <TabPills tabs={tabs} value={tab} onChange={setTab} />

      <List>
        <ListRow cols={COLS} head><span>Lead</span><span>When</span><span>Last note</span><span>Last result</span><span /></ListRow>
        {live ? liveRows.map(f => {
          const at = new Date(f.due_at);
          const theirs = clockIn(f.lead.her_time_zone, at);
          const late = at < now;
          return (
            <ListRow key={f.id} cols={COLS} alert={late}>
              <Person initials={initialsOf(f.lead.name)} tone={toneOf(f.lead.id)} name={f.lead.name} sub={f.lead.company || f.lead.phone} className="max-lg:order-1 max-lg:flex-1" />
              {f.missed ? (
                <div className="max-lg:order-3 max-lg:flex max-lg:items-baseline max-lg:gap-2">
                  <b className="text-14">Missed call</b>
                  <p className="text-13 text-danger-ink">{whenLabel(f.due_at, now)}</p>
                </div>
              ) : (
                <div className="max-lg:order-3 max-lg:flex max-lg:items-baseline max-lg:gap-2">
                  <b className="text-14">{theirs ? `${theirs} their time` : at.toLocaleString('en-GB', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</b>
                  <p className={late ? 'text-13 text-danger-ink' : 'text-13 text-brand-ink'}>{late ? `due ${relative(f.due_at, now)}` : relative(f.due_at, now)}</p>
                </div>
              )}
              <span className="text-14 text-ink-2 max-lg:order-4 max-lg:basis-full">{f.missed ? MISSED_NOTE : f.last_note || f.reason}</span>
              {f.missed
                ? <Pill tone="danger" className="max-lg:order-3 max-lg:ml-auto">Missed call</Pill>
                : isOutcome(f.last_outcome)
                  ? <Pill tone={OUTCOME_TONE[f.last_outcome]} className="max-lg:order-3 max-lg:ml-auto">{OUTCOME_LABEL[f.last_outcome]}</Pill>
                  : <span className="max-lg:order-3" />}
              <Button variant="primary" className="h-[38px] max-lg:order-2" onClick={() => navigate(`/call/${f.lead.id}`)}><Icon name="call" size={15} />Call</Button>
              <span aria-hidden="true" className="order-2 basis-full lg:hidden" />
            </ListRow>
          );
        }) : demoRows.map(f => {
          const missed = f.result === 'missed';
          return (
            <ListRow key={f.lead.id} cols={COLS} alert={missed}>
              <Person initials={f.lead.initials} tone={f.lead.tone} name={f.lead.name} sub={f.lead.company} className="max-lg:order-1 max-lg:flex-1" />
              <div className="max-lg:order-3 max-lg:flex max-lg:items-baseline max-lg:gap-2"><b className="text-14">{f.when}</b><p className={missed ? 'text-13 text-danger-ink' : 'text-13 text-brand-ink'}>{f.due}</p></div>
              <span className="text-14 text-ink-2 max-lg:order-4 max-lg:basis-full">{f.note}</span>
              <Pill tone={RESULT_TONE[f.result]} className="max-lg:order-3 max-lg:ml-auto">{RESULT_LABEL[f.result]}</Pill>
              <Button variant="primary" className="h-[38px] max-lg:order-2" onClick={() => navigate(`/call/${f.lead.id}`)}><Icon name="call" size={15} />Call</Button>
              <span aria-hidden="true" className="order-2 basis-full lg:hidden" />
            </ListRow>
          );
        })}
        {live && data.isPending && <p className="px-6 py-12 text-center text-muted">Loading…</p>}
        {(live ? data.isSuccess && liveRows.length === 0 : demoRows.length === 0) && (
          <p className="px-6 py-12 text-center text-muted">{live && tab === 'today' ? 'Nothing due today. Book a follow-up after a call and it shows up here.' : 'Nothing due here yet.'}</p>
        )}
      </List>

      <p className="text-13 text-muted">Missed calls come in when a lead calls your number back. On Starter and Pro you also get an alert on screen.</p>
    </Page>
  );
}
