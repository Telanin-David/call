import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePlan } from '@/lib/plan';
import { CALLS, RESULT_LABEL, RESULT_PILL, type Result } from '@/lib/fake';
import { formatUsd } from '@/lib/money';
import Icon from '@/components/Icon';
import Avatar from '@/components/Avatar';

type Filter = 'all' | Exclude<Result, 'missed'>;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All calls' },
  { key: 'interested', label: 'Interested' },
  { key: 'callback', label: 'Call back' },
  { key: 'no_answer', label: 'No answer' },
  { key: 'not_interested', label: 'Not interested' },
];

export default function History() {
  const { plan } = usePlan();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const rows = CALLS.filter(c =>
    (filter === 'all' || c.result === filter) &&
    (!needle || c.lead.name.toLowerCase().includes(needle) || c.lead.company.toLowerCase().includes(needle)));

  return (
    <div className="dl-wrap dl-wrap--wide dl-wrap--tight">
      <div className="dl-pagehead">
        <h1 className="dl-h1 dl-grow">History</h1>
        <div className="dl-kpis dl-kpis--row">
          <div>This week<b>412 calls</b></div>
          <div>Talked<b>9h 40m</b></div>
          <div>Spent<b>$11.60</b></div>
        </div>
      </div>

      <div className="dl-row dl-row--12">
        <div className="dl-row">
          {FILTERS.map(f => (
            <button key={f.key} className="dl-chip dl-chip--36" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>{f.label}</button>
          ))}
        </div>
        <span className="dl-grow" />
        <div className="dl-search">
          <Icon name="i-users" size={16} />
          <input className="dl-input" placeholder="Search name or number" aria-label="Search calls" value={q} onChange={e => setQ(e.target.value)} />
        </div>
      </div>

      <div className="dl-list dl-list--history">
        <div className="dl-list-row dl-list-head"><span>When</span><span>Lead</span><span>Result</span><span>Length</span><span>Cost</span><span /></div>
        {rows.map(c => (
          <div key={c.when + c.lead.id} className="dl-list-row">
            <span className="dl-muted">{c.when}</span>
            <div className="dl-who dl-who--sm">
              <Avatar lead={c.lead} size={32} />
              <div><b>{c.lead.name}</b><p>{c.lead.company}</p></div>
            </div>
            <span className={RESULT_PILL[c.result]}>{RESULT_LABEL[c.result]}</span>
            <span className="dl-num">{c.length}</span>
            <span className="dl-num">{formatUsd(c.cost)}</span>
            {plan === 'pro'
              ? <button className="dl-link dl-locknote"><Icon name="i-play" size={14} />Play recording</button>
              : <Link to="/plans" className="dl-locknote dl-plainlink"><Icon name="i-lock" size={14} />Recording on Pro</Link>}
          </div>
        ))}
        {rows.length === 0 && <div className="dl-empty">No calls match.</div>}
      </div>
    </div>
  );
}
