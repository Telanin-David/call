import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FOLLOWUPS_TODAY, RESULT_LABEL, RESULT_PILL } from '@/lib/fake';
import Icon from '@/components/Icon';
import Avatar from '@/components/Avatar';

type Tab = 'today' | 'tomorrow' | 'week' | 'later';

const TABS: { key: Tab; label: string; count: number }[] = [
  { key: 'today', label: 'Due today', count: 5 },
  { key: 'tomorrow', label: 'Tomorrow', count: 3 },
  { key: 'week', label: 'This week', count: 9 },
  { key: 'later', label: 'Later', count: 14 },
];

export default function Followups() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('today');
  const rows = tab === 'today' ? FOLLOWUPS_TODAY : [];

  return (
    <div className="dl-wrap dl-wrap--wide">
      <div className="dl-pagehead">
        <div className="dl-grow">
          <h1 className="dl-h1">Follow-ups</h1>
          <p className="dl-lede">People you said you'd call back, and people who called you.</p>
        </div>
        <button className="dl-btn dl-btn--primary dl-btn--lg" onClick={() => navigate('/call')}>
          <Icon name="i-call" size={17} />Call all {FOLLOWUPS_TODAY.length} in order
        </button>
      </div>

      <div className="dl-tabpills" role="tablist">
        {TABS.map(t => (
          <button key={t.key} role="tab" className="dl-tabpill" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>
            {t.label}<i>{t.count}</i>
          </button>
        ))}
      </div>

      <div className="dl-list dl-list--followups">
        <div className="dl-list-row dl-list-head"><span>Lead</span><span>When</span><span>Last note</span><span>Last result</span><span /></div>
        {rows.map(f => (
          <div key={f.lead.id} className={`dl-list-row${f.result === 'missed' ? ' is-alert' : ''}`}>
            <div className="dl-who">
              <Avatar lead={f.lead} size={38} />
              <div><b>{f.lead.name}</b><p>{f.lead.company}</p></div>
            </div>
            <div className="dl-when"><b>{f.when}</b><p>{f.due}</p></div>
            <span className="dl-note">{f.note}</span>
            <span className={RESULT_PILL[f.result]}>{RESULT_LABEL[f.result]}</span>
            <button className="dl-btn dl-btn--primary dl-btn--38" onClick={() => navigate(`/call/${f.lead.id}`)}>
              <Icon name="i-call" size={15} />Call
            </button>
          </div>
        ))}
        {rows.length === 0 && <div className="dl-empty">Nothing due here yet.</div>}
      </div>

      <p className="dl-foot">Missed calls come in when a lead calls your number back. On Starter and Pro you also get an alert on screen.</p>
    </div>
  );
}
