import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '@/components/Icon';

type Step = 1 | 2 | 3;

const COLUMNS = [
  { yours: 'First Name', sample: 'James', saveas: 'First name' },
  { yours: 'Last Name', sample: 'Obi', saveas: 'Last name' },
  { yours: 'Company', sample: 'Obi Ventures', saveas: 'Company' },
  { yours: 'Job Title', sample: 'CEO', saveas: 'Job title' },
  { yours: 'Phone', sample: '+234 801 234 5678', saveas: 'Phone' },
  { yours: 'Email', sample: 'james@obiventures.ng', saveas: 'Email' },
  { yours: 'Website', sample: 'obiventures.ng', saveas: 'Website' },
  { yours: 'City', sample: 'Lagos', saveas: 'Skip column' },
];

const FIELDS = ['First name', 'Last name', 'Phone', 'Email', 'Company', 'Job title', 'Website', 'Location', 'Skip column'];

export default function UploadLeads() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [dragging, setDragging] = useState(false);

  return (
    <div className="dl-page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="dl-link" onClick={() => step > 1 ? setStep(s => (s - 1) as Step) : navigate('/leads')}>
          <Icon name="i-left" size={14} />
          {step === 1 ? 'Back to leads' : 'Back'}
        </button>
      </div>

      {/* Steps */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {(['Upload file', 'Match columns', 'Check and add'] as const).map((label, i) => {
          const n = (i + 1) as Step;
          const done = n < step;
          const active = n === step;
          return (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 22, height: 22, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 600,
                  background: done ? 'var(--success)' : active ? 'var(--brand)' : 'var(--surface-sunk)',
                  color: done ? '#fff' : active ? 'var(--on-brand)' : 'var(--muted)',
                }}>
                  {done ? <Icon name="i-check" size={12} /> : n}
                </span>
                <span style={{ fontSize: 13, fontWeight: active ? 600 : 400, color: active ? 'var(--ink)' : 'var(--muted)' }}>{label}</span>
              </div>
              {i < 2 && <span style={{ width: 32, height: 1, background: 'var(--line)', marginLeft: 4 }} />}
            </div>
          );
        })}
      </div>

      {step === 1 && (
        <div
          className="dl-drop"
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={() => { setDragging(false); setStep(2); }}
          style={{ borderColor: dragging ? 'var(--brand)' : undefined }}
        >
          <span style={{ width: 48, height: 48, borderRadius: 16, background: 'var(--brand-soft)', color: 'var(--brand-ink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="i-upload" size={22} />
          </span>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Drop a CSV or Excel file here</div>
            <div className="dl-small dl-muted">or click to browse · max 50 MB</div>
          </div>
          <button className="dl-btn dl-btn--outline" onClick={() => setStep(2)}>Browse files</button>
          <div className="dl-small dl-muted" style={{ marginTop: 8 }}>
            Need a template? <button className="dl-link" style={{ fontSize: 13 }}>Download sample CSV</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 280px', gap: 20 }}>
          <div>
            <div className="dl-card" style={{ padding: 0, overflow: 'hidden' }}>
              <table className="dl-table">
                <thead>
                  <tr>
                    <th>YOUR COLUMN</th>
                    <th>FIRST ROW</th>
                    <th />
                    <th>SAVE AS</th>
                  </tr>
                </thead>
                <tbody>
                  {COLUMNS.map(c => (
                    <tr key={c.yours}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{c.yours}</td>
                      <td style={{ color: 'var(--muted)', fontSize: 13 }}>{c.sample}</td>
                      <td style={{ color: 'var(--faint)' }}>→</td>
                      <td>
                        <select className="dl-select" style={{ height: 36, fontSize: 13, width: 160 }}
                          defaultValue={c.saveas}>
                          {FIELDS.map(f => <option key={f}>{f}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="dl-btn dl-btn--primary dl-btn--lg" style={{ marginTop: 16 }}
              onClick={() => setStep(3)}>
              <Icon name="i-right" size={16} />
              Continue
            </button>
          </div>
          <div className="dl-card" style={{ alignSelf: 'start' }}>
            <h3 className="dl-heading" style={{ marginBottom: 12 }}>Summary</h3>
            <div className="dl-price"><span>Total rows</span><b>1,245</b></div>
            <div className="dl-price"><span>With phone</span><b>1,198</b></div>
            <div className="dl-price"><span>Duplicates</span><b>12</b></div>
            <div className="dl-price"><span>DNC matches</span><b>4</b></div>
            <hr className="dl-divider" style={{ margin: '12px 0' }} />
            <div className="dl-price" style={{ fontWeight: 600 }}><span>Will be added</span><b>1,182</b></div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="dl-card">
            <h3 className="dl-heading" style={{ marginBottom: 12 }}>Ready to add 1,182 leads</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
              {[
                { label: 'Total leads', value: '1,182' },
                { label: 'With phone', value: '1,182' },
                { label: 'DNC skipped', value: '4' },
                { label: 'Duplicates removed', value: '12' },
              ].map(s => (
                <div key={s.label} className="dl-card dl-card--sunk" style={{ padding: 16 }}>
                  <div className="dl-small dl-muted">{s.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 4 }}>{s.value}</div>
                </div>
              ))}
            </div>
            <div className="dl-field" style={{ marginBottom: 16 }}>
              <label>List name</label>
              <input className="dl-input" defaultValue="Lagos CEOs Q4" />
            </div>
            <button className="dl-btn dl-btn--primary dl-btn--lg" onClick={() => navigate('/leads')}>
              <Icon name="i-check" size={16} />
              Add 1,182 leads
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
