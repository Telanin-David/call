import { useState } from 'react';
import { usePlan } from '@/lib/plan';
import Icon from '@/components/Icon';

type Filter = 'all' | 'interested' | 'callback' | 'no_answer' | 'not_interested';

const CALLS = [
  { when: 'Today 9:14 am', name: 'Sandra Mensah', company: 'Buildright Ltd', result: 'interested', resultLabel: 'Interested', length: '4:12', cost: '$0.08', avatar: 'SM', av: 'dl-av-c' },
  { when: 'Today 9:08 am', name: 'James Obi', company: 'Obi Ventures', result: 'no_answer', resultLabel: 'No answer', length: '0:08', cost: '$0.01', avatar: 'JO', av: 'dl-av-a' },
  { when: 'Today 9:02 am', name: 'Amara Diallo', company: 'Diallo & Co', result: 'callback', resultLabel: 'Call back', length: '2:31', cost: '$0.05', avatar: 'AD', av: 'dl-av-b' },
  { when: 'Yesterday 4:55 pm', name: 'Kofi Asante', company: 'GoldCoast Capital', result: 'not_interested', resultLabel: 'Not interested', length: '1:04', cost: '$0.02', avatar: 'KA', av: 'dl-av-e' },
  { when: 'Yesterday 4:42 pm', name: 'Yewande Bello', company: 'Bello Properties', result: 'interested', resultLabel: 'Interested', length: '6:18', cost: '$0.12', avatar: 'YB', av: 'dl-av-d' },
  { when: 'Yesterday 4:29 pm', name: 'Emeka Nwosu', company: 'Nwosu Trading', result: 'callback', resultLabel: 'Call back', length: '3:44', cost: '$0.07', avatar: 'EN', av: 'dl-av-a' },
  { when: 'Yesterday 4:15 pm', name: 'Fatima Hassan', company: 'Hassan Holdings', result: 'no_answer', resultLabel: 'No answer', length: '0:08', cost: '$0.01', avatar: 'FH', av: 'dl-av-b' },
];

const RESULT_PILL: Record<string, string> = {
  interested: 'dl-pill--success',
  callback: 'dl-pill--brand',
  no_answer: '',
  not_interested: '',
};

const FILTERS = [
  { key: 'all', label: 'All calls' },
  { key: 'interested', label: 'Interested' },
  { key: 'callback', label: 'Call back' },
  { key: 'no_answer', label: 'No answer' },
  { key: 'not_interested', label: 'Not interested' },
];

export default function History() {
  const { plan } = usePlan();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  const filtered = CALLS.filter(c => {
    if (filter !== 'all' && c.result !== filter) return false;
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !c.company.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="dl-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="dl-title">History</h1>
        <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--muted)' }}>
          <span><b style={{ color: 'var(--ink)' }}>412</b> calls this week</span>
          <span><b style={{ color: 'var(--ink)' }}>9h 40m</b> talk time</span>
          <span><b style={{ color: 'var(--ink)' }}>$11.60</b> spent</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div className="dl-chiprow">
          {FILTERS.map(f => (
            <button key={f.key} className="dl-chip" aria-pressed={filter === f.key as Filter}
              onClick={() => setFilter(f.key as Filter)}>
              {f.label}
            </button>
          ))}
        </div>
        <input className="dl-input" placeholder="Search leads…" value={search} onChange={e => setSearch(e.target.value)}
          style={{ width: 200, marginLeft: 'auto', height: 36, fontSize: 13 }} />
      </div>

      <div className="dl-card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="dl-table">
          <thead>
            <tr>
              <th>WHEN</th>
              <th>LEAD</th>
              <th>RESULT</th>
              <th className="r">LENGTH</th>
              <th className="r">COST</th>
              {plan === 'pro' && <th />}
            </tr>
          </thead>
          <tbody>
            {filtered.map((c, i) => (
              <tr key={i}>
                <td className="dl-small dl-muted dl-num" style={{ whiteSpace: 'nowrap' }}>{c.when}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className={`dl-avatar ${c.av}`} style={{ width: 30, height: 30, fontSize: 11 }}>{c.avatar}</span>
                    <div>
                      <div style={{ fontWeight: 600 }}>{c.name}</div>
                      <span className="sub">{c.company}</span>
                    </div>
                  </div>
                </td>
                <td>
                  <span className={`dl-pill ${RESULT_PILL[c.result]}`}>{c.resultLabel}</span>
                </td>
                <td className="r dl-num dl-small">{c.length}</td>
                <td className="r dl-num dl-small">{c.cost}</td>
                {plan === 'pro' && (
                  <td>
                    <button className="dl-btn" style={{ height: 28, padding: '0 10px', fontSize: 12 }}>
                      <Icon name="i-play" size={11} />
                      Play
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {plan !== 'pro' && (
              <tr>
                <td colSpan={5}>
                  <div className="dl-locked">
                    <Icon name="i-lock" size={16} />
                    Recordings and transcripts are available on Pro
                    <button className="dl-btn dl-btn--primary" style={{ height: 28, padding: '0 12px', fontSize: 12, marginLeft: 8 }}>Upgrade</button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
