import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Chip, Icon, Input, Kpis, List, ListRow, PageHeader, Person, Pill, cn, linkClass } from '@dialer/ui';
import { Page } from '@/components/Page';
import { usePlan } from '@/lib/plan';
import { isLive } from '@/lib/backend';
import { errorText } from '@/lib/api';
import { OUTCOME_LABEL, OUTCOME_TONE, callCost, callLength, initialsOf, isOutcome, talkTime, toneOf, useHistory, whenLabel } from '@/lib/activity';
import { prettyNumber } from '@/lib/numbers';
import { CALLS, RESULT_LABEL, RESULT_TONE, type Result } from '@/lib/fake';
import { formatUsd } from '@/lib/money';

type Filter = 'all' | Exclude<Result, 'missed'>;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All calls' },
  { key: 'interested', label: 'Interested' },
  { key: 'callback', label: 'Call back' },
  { key: 'no_answer', label: 'No answer' },
  { key: 'not_interested', label: 'Not interested' },
];

const COLS = 'grid-cols-[150px_260px_150px_90px_90px_minmax(0,1fr)] py-3 text-14';

/** The search box waits until typing stops before asking the server. */
function useSettled(value: string, ms = 300): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

export default function History() {
  const live = isLive();
  const { plan } = usePlan();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const search = useSettled(q.trim());
  const history = useHistory(filter === 'all' ? '' : filter, search);
  const pages = history.data?.pages ?? [];
  const liveRows = pages.flatMap(p => p.calls);
  const week = pages[0]?.week;
  const rows = CALLS.filter(c =>
    (filter === 'all' || c.result === filter) &&
    (!needle || c.lead.name.toLowerCase().includes(needle) || c.lead.company.toLowerCase().includes(needle)));

  return (
    <Page width={1200} className="gap-[18px]">
      <PageHeader title="History" aside={
        <Kpis className="flex gap-5 sm:gap-7" items={live ? [
          { label: 'This week', value: `${week?.calls ?? 0} calls` }, { label: 'Talked', value: talkTime(week?.talk_seconds ?? 0) },
          { label: 'Spent', value: formatUsd(week?.spent_microdollars ?? 0) },
        ] : [
          { label: 'This week', value: '412 calls' }, { label: 'Talked', value: '9h 40m' }, { label: 'Spent', value: '$11.60' },
        ]} />
      } />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex gap-2 max-lg:-mx-4 max-lg:overflow-x-auto max-lg:px-4 max-lg:py-px max-lg:[scrollbar-width:none] sm:max-lg:mx-0 sm:max-lg:px-0">
          {FILTERS.map(f => <Chip key={f.key} pressed={filter === f.key} className="h-9 flex-none" onClick={() => setFilter(f.key)}>{f.label}</Chip>)}
        </div>
        <span className="flex-1 max-lg:hidden" />
        <div className="relative lg:w-[260px]">
          <Icon name="users" size={16} className="absolute left-3 top-3 text-faint" />
          <Input placeholder="Search name or number" aria-label="Search calls" value={q} onChange={e => setQ(e.target.value)} className="h-10 pl-[38px]" />
        </div>
      </div>

      <List>
        <ListRow cols={COLS} head><span>When</span><span>Lead</span><span>Result</span><span>Length</span><span>Cost</span><span /></ListRow>
        {live ? liveRows.map(c => (
          <ListRow key={c.id} cols={COLS}>
            <span className="text-muted max-lg:order-3 max-lg:text-13">{whenLabel(c.started_at)}</span>
            <Person initials={initialsOf(c.lead?.name ?? '#')} tone={toneOf(c.lead?.id ?? c.id)} size={32}
              name={c.lead?.name ?? prettyNumber(c.to)} sub={[c.incoming && 'Called you', c.lead?.company || prettyNumber(c.to)].filter(Boolean).join(' · ')}
              className="max-lg:order-1 max-lg:flex-1" />
            {c.incoming && !c.answered
              ? <Pill tone="danger" className="max-lg:order-3">Missed call</Pill>
              : isOutcome(c.outcome)
                ? <Pill tone={OUTCOME_TONE[c.outcome]} className="max-lg:order-3">{OUTCOME_LABEL[c.outcome]}</Pill>
                : <Pill tone="neutral" className="max-lg:order-3">No result</Pill>}
            <span className="tabular-nums max-lg:order-3 max-lg:text-13 max-lg:text-muted">{callLength(c.seconds)}</span>
            <span className="tabular-nums max-lg:order-2 max-lg:font-semibold">{callCost(c.cost_microdollars)}</span>
            <span aria-hidden="true" className="order-2 basis-full lg:hidden" />
            {plan === 'pro'
              ? <span className="flex items-center gap-1.5 text-13 text-faint max-lg:order-3 max-lg:ml-auto"><Icon name="play" size={14} /><span className="max-sm:sr-only">No recording yet</span></span>
              : <Link to="/plans" className="flex items-center gap-1.5 text-13 text-faint no-underline max-lg:order-3 max-lg:ml-auto"><Icon name="lock" size={14} /><span className="max-sm:sr-only">Recording on Pro</span></Link>}
          </ListRow>
        )) : rows.map(c => (
          <ListRow key={c.when + c.lead.id} cols={COLS}>
            <span className="text-muted max-lg:order-3 max-lg:text-13">{c.when}</span>
            <Person initials={c.lead.initials} tone={c.lead.tone} size={32} name={c.lead.name} sub={c.lead.company} className="max-lg:order-1 max-lg:flex-1" />
            <Pill tone={RESULT_TONE[c.result]} className="max-lg:order-3">{RESULT_LABEL[c.result]}</Pill>
            <span className="tabular-nums max-lg:order-3 max-lg:text-13 max-lg:text-muted">{c.length}</span>
            <span className="tabular-nums max-lg:order-2 max-lg:font-semibold">{formatUsd(c.cost)}</span>
            <span aria-hidden="true" className="order-2 basis-full lg:hidden" />
            {plan === 'pro'
              ? <Link to={`/history/${c.lead.id}`} className={cn(linkClass, 'flex items-center gap-1.5 text-13 max-lg:order-3 max-lg:ml-auto')}><Icon name="play" size={14} /><span className="max-sm:sr-only">Play recording</span></Link>
              : <Link to="/plans" className="flex items-center gap-1.5 text-13 text-faint no-underline max-lg:order-3 max-lg:ml-auto"><Icon name="lock" size={14} /><span className="max-sm:sr-only">Recording on Pro</span></Link>}
          </ListRow>
        ))}
        {live && history.isPending && <p className="px-6 py-12 text-center text-muted">Loading…</p>}
        {live && history.isError && <p role="alert" className="px-6 py-12 text-center text-danger-ink">{errorText(history.error)}</p>}
        {(live ? history.isSuccess && liveRows.length === 0 : rows.length === 0) && (
          <p className="px-6 py-12 text-center text-muted">{live && filter === 'all' && !search ? 'No calls yet. They show up here after you call.' : 'No calls match.'}</p>
        )}
      </List>

      {live && history.hasNextPage && (
        <Button variant="outline" className="self-center" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>
          {history.isFetchingNextPage ? 'Loading…' : 'Show more calls'}
        </Button>
      )}
    </Page>
  );
}
