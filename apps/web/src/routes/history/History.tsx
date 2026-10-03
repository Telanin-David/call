import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Chip, Icon, Input, Kpis, LinkButton, List, ListRow, PageHeader, Person, Pill } from '@dialer/ui';
import { Page } from '@/components/Page';
import { usePlan } from '@/lib/plan';
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

export default function History() {
  const { plan } = usePlan();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const rows = CALLS.filter(c =>
    (filter === 'all' || c.result === filter) &&
    (!needle || c.lead.name.toLowerCase().includes(needle) || c.lead.company.toLowerCase().includes(needle)));

  return (
    <Page width={1200} className="gap-[18px]">
      <PageHeader title="History" aside={
        <Kpis className="flex gap-5 sm:gap-7" items={[
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
        {rows.map(c => (
          <ListRow key={c.when + c.lead.id} cols={COLS}>
            <span className="text-muted max-lg:order-3 max-lg:text-13">{c.when}</span>
            <Person initials={c.lead.initials} tone={c.lead.tone} size={32} name={c.lead.name} sub={c.lead.company} className="max-lg:order-1 max-lg:flex-1" />
            <Pill tone={RESULT_TONE[c.result]} className="max-lg:order-3">{RESULT_LABEL[c.result]}</Pill>
            <span className="tabular-nums max-lg:order-3 max-lg:text-13 max-lg:text-muted">{c.length}</span>
            <span className="tabular-nums max-lg:order-2 max-lg:font-semibold">{formatUsd(c.cost)}</span>
            <span aria-hidden="true" className="order-2 basis-full lg:hidden" />
            {plan === 'pro'
              ? <LinkButton className="flex items-center gap-1.5 text-13 max-lg:order-3 max-lg:ml-auto"><Icon name="play" size={14} /><span className="max-sm:sr-only">Play recording</span></LinkButton>
              : <Link to="/plans" className="flex items-center gap-1.5 text-13 text-faint no-underline max-lg:order-3 max-lg:ml-auto"><Icon name="lock" size={14} /><span className="max-sm:sr-only">Recording on Pro</span></Link>}
          </ListRow>
        ))}
        {rows.length === 0 && <p className="px-6 py-12 text-center text-muted">No calls match.</p>}
      </List>
    </Page>
  );
}
