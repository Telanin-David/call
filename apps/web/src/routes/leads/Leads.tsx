import { useNavigate } from 'react-router-dom';
import Icon from '@/components/Icon';

const LISTS = [
  { name: 'Lagos CEOs Q4', script: 'Main pitch', total: 250, done: 87, status: 'active' },
  { name: 'Abuja Finance Leads', script: 'Finance pitch', total: 180, done: 180, status: 'done' },
  { name: 'Accra Import-Export', script: 'Trade pitch', total: 320, done: 0, status: 'new' },
  { name: 'Nairobi Tech Startups', script: 'Tech pitch', total: 95, done: 12, status: 'active' },
  { name: 'US Real Estate PMs', script: 'RE pitch', total: 400, done: 67, status: 'active' },
];

const STATUS_PILL: Record<string, string> = {
  active: 'dl-pill--brand',
  done: '',
  new: 'dl-pill--warn',
};
const STATUS_LABEL: Record<string, string> = {
  active: 'In use',
  done: 'Done',
  new: 'Not started',
};

export default function Leads() {
  const navigate = useNavigate();

  return (
    <div className="dl-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="dl-title">Leads</h1>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="dl-btn dl-btn--outline" onClick={() => navigate('/scripts')}>
            <Icon name="i-note" size={15} />
            Edit scripts
          </button>
          <button className="dl-btn dl-btn--primary" onClick={() => navigate('/leads/upload')}>
            <Icon name="i-upload" size={15} />
            Upload a list
          </button>
        </div>
      </div>

      <div className="dl-card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="dl-table">
          <thead>
            <tr>
              <th>LIST</th>
              <th>SCRIPT</th>
              <th>PROGRESS</th>
              <th>STATUS</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {LISTS.map(l => {
              const pct = Math.round((l.done / l.total) * 100);
              return (
                <tr key={l.name}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{l.name}</div>
                    <span className="sub">{l.total.toLocaleString()} leads</span>
                  </td>
                  <td>{l.script}</td>
                  <td style={{ width: 200 }}>
                    <div style={{ marginBottom: 4, display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--muted)' }}>
                      <span>{l.done} / {l.total}</span>
                      <span>{pct}%</span>
                    </div>
                    <div className="dl-progress">
                      <span style={{ width: `${pct}%` }} />
                    </div>
                  </td>
                  <td>
                    <span className={`dl-pill ${STATUS_PILL[l.status]}`}>{STATUS_LABEL[l.status]}</span>
                  </td>
                  <td>
                    <button className="dl-btn" style={{ height: 32, padding: '0 12px', fontSize: 13 }}
                      onClick={() => navigate('/call/1')}>
                      <Icon name="i-call" size={13} />
                      Call
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line)' }}>
          <span className="dl-small dl-muted">
            Numbers on the DNC list are skipped automatically. Your leads see "Skipped (DNC)".
          </span>
        </div>
      </div>
    </div>
  );
}
