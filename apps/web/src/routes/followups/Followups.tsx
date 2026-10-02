import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '@/components/Icon';

type Tab = 'today' | 'tomorrow' | 'week' | 'later';

const DATA: Record<Tab, Array<{ name: string; company: string; when: string; note: string; result: string; avatar: string; av: string; missed?: boolean }>> = {
  today: [
    { name: 'Sandra Mensah', company: 'Buildright Ltd', when: '9:00 am', note: 'Very interested in the Pro plan', result: 'Interested', avatar: 'SM', av: 'dl-av-c', missed: true },
    { name: 'James Obi', company: 'Obi Ventures', when: '10:30 am', note: 'Wants pricing details', result: 'Call back', avatar: 'JO', av: 'dl-av-a' },
    { name: 'Amara Diallo', company: 'Diallo & Co', when: '2:00 pm', note: 'Spoke to assistant, call back', result: 'Interested', avatar: 'AD', av: 'dl-av-b' },
    { name: 'Kofi Asante', company: 'GoldCoast Capital', when: '4:00 pm', note: 'Left voicemail', result: 'Call back', avatar: 'KA', av: 'dl-av-e' },
    { name: 'Yewande Bello', company: 'Bello Properties', when: '5:00 pm', note: 'Interested in Starter', result: 'Interested', avatar: 'YB', av: 'dl-av-d' },
  ],
  tomorrow: [
    { name: 'Emeka Nwosu', company: 'Nwosu Trading', when: 'Tomorrow 9:00 am', note: 'Call back next week', result: 'Call back', avatar: 'EN', av: 'dl-av-a' },
    { name: 'Fatima Hassan', company: 'Hassan Holdings', when: 'Tomorrow 11:00 am', note: 'Wants demo', result: 'Interested', avatar: 'FH', av: 'dl-av-b' },
    { name: 'Taiwo Adeyemi', company: 'Adeyemi Group', when: 'Tomorrow 3:00 pm', note: 'Sent email, awaiting reply', result: 'Call back', avatar: 'TA', av: 'dl-av-c' },
  ],
  week: [
    { name: 'Chinonso Eze', company: 'Eze Imports', when: 'Wed 10:00 am', note: 'Interested in bulk deal', result: 'Interested', avatar: 'CE', av: 'dl-av-d' },
  ],
  later: [],
};

const RESULT_PILL: Record<string, string> = {
  Interested: 'dl-pill--success',
  'Call back': 'dl-pill--brand',
  'Missed call': 'dl-pill--danger',
};

export default function Followups() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('today');

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'today', label: 'Due today', count: DATA.today.length },
    { key: 'tomorrow', label: 'Tomorrow', count: DATA.tomorrow.length },
    { key: 'week', label: 'This week', count: DATA.week.length },
    { key: 'later', label: 'Later', count: 14 },
  ];

  const rows = DATA[tab];

  return (
    <div className="dl-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="dl-title">Follow-ups</h1>
        <button className="dl-btn dl-btn--primary" onClick={() => navigate('/call/1')}>
          <Icon name="i-call" size={15} />
          Call all {DATA[tab].length} in order
        </button>
      </div>

      <div className="dl-tabs">
        {tabs.map(t => (
          <button key={t.key} aria-selected={tab === t.key} onClick={() => setTab(t.key)}>
            {t.label}
            <span className="dl-count">{t.count}</span>
          </button>
        ))}
      </div>

      <div className="dl-card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="dl-table">
          <thead>
            <tr>
              <th>LEAD</th>
              <th>WHEN</th>
              <th>LAST NOTE</th>
              <th>LAST RESULT</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.name} style={{ background: r.missed ? '#fff8f8' : undefined }}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className={`dl-avatar ${r.av}`} style={{ width: 32, height: 32, fontSize: 11 }}>{r.avatar}</span>
                    <div>
                      <div style={{ fontWeight: 600 }}>{r.name}</div>
                      <span className="sub">{r.company}</span>
                    </div>
                  </div>
                </td>
                <td className="dl-small">{r.when}</td>
                <td style={{ maxWidth: 280 }}>
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>{r.note}</span>
                </td>
                <td>
                  <span className={`dl-pill ${r.missed ? 'dl-pill--danger' : RESULT_PILL[r.result] || ''}`}>
                    {r.missed ? 'Missed call' : r.result}
                  </span>
                </td>
                <td>
                  <button className="dl-btn dl-btn--primary" style={{ height: 32, padding: '0 12px', fontSize: 13 }}
                    onClick={() => navigate('/call/1')}>
                    <Icon name="i-call" size={13} />
                    Call
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <div className="dl-empty">
                    <Icon name="i-check" size={24} />
                    <span>No follow-ups here</span>
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
