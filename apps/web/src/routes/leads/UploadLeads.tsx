import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Icon, { type IconName } from '@/components/Icon';

const FIELDS = ['First name', 'Last name', 'Company', 'Phone number', 'Email', 'City (sets her time zone)', 'Notes', 'Skip this column'] as const;
type Field = (typeof FIELDS)[number];

const COLUMNS: { yours: string; sample: string; saveAs: Field }[] = [
  { yours: 'First Name', sample: 'Lena', saveAs: 'First name' },
  { yours: 'Last Name', sample: 'Park', saveAs: 'Last name' },
  { yours: 'Business', sample: 'Sparkle Offices', saveAs: 'Company' },
  { yours: 'Phone', sample: '(646) 555-0110', saveAs: 'Phone number' },
  { yours: 'Email Address', sample: 'lena@sparkleoffices.com', saveAs: 'Email' },
  { yours: 'City', sample: 'Brooklyn, NY', saveAs: 'City (sets her time zone)' },
  { yours: 'Sites', sample: '3', saveAs: 'Skip this column' },
  { yours: 'Notes', sample: 'Unhappy with Friday cleaner', saveAs: 'Notes' },
];

const LEFT_OUT: { icon: IconName; tone: string; title: string; body: string }[] = [
  { icon: 'i-globe', tone: 't-lemon', title: '2 not US or Canada', body: 'UK and Ghana numbers. Calling them costs more, so they go in a separate list.' },
  { icon: 'i-users', tone: 't-grey', title: '2 duplicates', body: 'Same phone number twice. We kept the first.' },
  { icon: 'i-ban', tone: 't-red', title: '1 on the do-not-call list', body: 'We never call it, and you are never charged.' },
];

const STEPS = ['Upload file', 'Match columns', 'Check and add'] as const;

export default function UploadLeads() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const fromSetup = params.get('from') === 'setup';
  const [step, setStep] = useState<1 | 2>(params.get('step') === 'match' ? 2 : 1);
  const [mapping, setMapping] = useState<Field[]>(COLUMNS.map(c => c.saveAs));

  return (
    <div className="dl-wrap dl-wrap--22">
      <div>
        {fromSetup
          ? <Link className="dl-link dl-back" to="/setup"><Icon name="i-left" size={16} />Setup · step 5 of 6</Link>
          : <Link className="dl-link dl-back" to="/leads"><Icon name="i-left" size={16} />Leads</Link>}
        <h1 className="dl-h1">Upload leads</h1>
      </div>

      <div className="dl-steps3" aria-label="Progress">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const state = n < step ? 'is-done' : n === step ? 'is-now' : 'is-todo';
          return (
            <span key={label} className="dl-steps3">
              {i > 0 && <span className="dl-s3-line" />}
              <span className={`dl-s3 ${state}`}>
                <i>{n < step ? <Icon name="i-check" size={14} /> : n}</i>{label}
              </span>
            </span>
          );
        })}
      </div>

      {step === 1 ? (
        <div className="dl-drop">
          <span className="dl-tile t-orange"><Icon name="i-upload" /></span>
          <b>Drop a CSV file here</b>
          <p className="dl-hint">First row should be column names. Up to 5,000 rows.</p>
          <button className="dl-btn dl-btn--primary" onClick={() => setStep(2)}>Choose file</button>
        </div>
      ) : (
        <div className="dl-split320">
          <div className="dl-list">
            <div className="dl-filehead">
              <span className="dl-tile t-mint"><Icon name="i-file" size={19} /></span>
              <div className="dl-grow"><b>october-leads.csv</b><p>42 rows · 8 columns</p></div>
              <button className="dl-link dl-link--14" onClick={() => setStep(1)}>Change file</button>
            </div>
            <div className="dl-maprow dl-maphead"><span>Your column</span><span>First row</span><span /><span>Save as</span></div>
            {COLUMNS.map((c, i) => (
              <div key={c.yours} className="dl-maprow">
                <b>{c.yours}</b>
                <span className="dl-cell">{c.sample}</span>
                <span className="dl-arrow"><Icon name="i-right" size={16} /></span>
                <span className={`dl-mapsel${mapping[i] === 'Skip this column' ? ' is-skip' : ''}`}>
                  <select aria-label={`Save ${c.yours} as`} value={mapping[i]}
                    onChange={e => setMapping(m => m.map((v, j) => (j === i ? (e.target.value as Field) : v)))}>
                    {FIELDS.map(f => <option key={f}>{f}</option>)}
                  </select>
                  <Icon name="i-right" size={14} />
                </span>
              </div>
            ))}
          </div>

          <aside className="dl-side">
            <div className="dl-hero dl-hero--24">
              <div className="dl-hero-eyebrow">READY TO ADD</div>
              <div className="dl-hero-big">37<small> of 42</small></div>
              <div className="dl-hero-meta">List name: <b>October leads</b></div>
              <button className="dl-btn dl-btn--primary dl-btn--lg dl-btn--block" onClick={() => navigate(fromSetup ? '/scripts?from=setup' : '/leads')}>Add 37 leads</button>
            </div>
            <div className="dl-panel dl-panel--20">
              <div className="dl-cardlabel">5 rows left out</div>
              <div className="dl-reasons">
                {LEFT_OUT.map(r => (
                  <div key={r.title} className="dl-reason">
                    <span className={`dl-tile ${r.tone}`}><Icon name={r.icon} size={15} /></span>
                    <span><b>{r.title}</b><p>{r.body}</p></span>
                  </div>
                ))}
                <button className="dl-link dl-link--14 dl-start">See the 5 rows</button>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
