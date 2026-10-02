import { Fragment, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { usePlan, PLAN_LABEL } from '@/lib/plan';
import Icon from '@/components/Icon';
import { MERGE_TAGS, SCRIPT_NAME, SCRIPT_PARTS, renderScript, type MergeValues, type ScriptPart } from '@/lib/script';

const SAMPLE: MergeValues = { first_name: 'Lena', company: 'Sparkle Offices', city: 'Brooklyn', her_time: '3:14 pm' };

const SCRIPTS = [
  { name: SCRIPT_NAME, note: 'In use · October leads', active: true },
  { name: 'Office cleaning v1', note: 'Old', active: false },
  { name: 'Home cleaning', note: 'Not in use', active: false },
];

export default function Scripts() {
  const { plan } = usePlan();
  const [params] = useSearchParams();
  const fromSetup = params.get('from') === 'setup';
  const [selected, setSelected] = useState(0);
  const [parts, setParts] = useState<ScriptPart[]>(SCRIPT_PARTS);
  const [editing, setEditing] = useState<number | null>(null);
  const [lastPart, setLastPart] = useState(0);

  const update = (i: number, patch: Partial<ScriptPart>) => setParts(ps => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <div className="dl-wrap dl-wrap--1240">
      <div className="dl-pagehead">
        <div className="dl-grow">
          {fromSetup
            ? <Link className="dl-link dl-back" to="/setup"><Icon name="i-left" size={16} />Setup · step 6 of 6</Link>
            : <Link className="dl-link dl-back" to="/leads"><Icon name="i-left" size={16} />Leads</Link>}
          <h1 className="dl-h1">Your script</h1>
          <p className="dl-lede">Write it once. It shows on screen while you call, with each lead's details filled in.</p>
        </div>
        <button className="dl-btn dl-btn--outline"><Icon name="i-upload" size={16} />Upload a file</button>
        <button className="dl-btn dl-btn--primary">Save script</button>
      </div>

      <div className="dl-grid-script">
        <nav className="dl-panel dl-panel--14" aria-label="Scripts">
          <div className="dl-cardlabel">Scripts</div>
          <div className="dl-scriptlist">
            {SCRIPTS.map((s, i) => (
              <button key={s.name} className="dl-scriptitem" aria-current={selected === i} onClick={() => setSelected(i)}>
                <span className={`dl-tile ${s.active ? 't-orange' : 't-grey'}`}><Icon name="i-file" size={15} /></span>
                <span className="dl-grow"><b>{s.name}</b><small>{s.note}</small></span>
              </button>
            ))}
          </div>
          <button className="dl-link dl-link--new dl-start">+ New script</button>
        </nav>

        <section className="dl-panel dl-panel--20" aria-label="Editor">
          <div className="dl-tagbar">
            <span>Add a detail:</span>
            {MERGE_TAGS.map(t => (
              <button key={t} className="dl-tag" onClick={() => update(lastPart, { body: `${parts[lastPart]?.body ?? ''} {${t}}` })}>{t}</button>
            ))}
          </div>
          <div className="dl-parts">
            {parts.map((p, i) => (
              <div key={i} className="dl-part">
                <input className="dl-input dl-part-title" aria-label="Part title" value={p.title}
                  onChange={e => update(i, { title: e.target.value })} />
                {editing === i ? (
                  <textarea className="dl-input dl-part-edit" autoFocus aria-label={`${p.title} text`} value={p.body}
                    onChange={e => update(i, { body: e.target.value })} onBlur={() => setEditing(null)} />
                ) : (
                  <button className="dl-part-body" onClick={() => { setEditing(i); setLastPart(i); }}>
                    {renderScript(p.body, t => <span className="dl-tag dl-tag--inline">{t}</span>)}
                  </button>
                )}
              </div>
            ))}
          </div>
          <button className="dl-link dl-link--add dl-start" onClick={() => setParts(ps => [...ps, { title: 'New part', body: '' }])}>+ Add a part</button>
        </section>

        <aside className="dl-side dl-side--10">
          <div className="dl-cardlabel">On a call with Lena, it looks like this</div>
          <div className="dl-paper dl-paper--preview">
            <div className="dl-sc dl-sc--sm">
              {parts.map((p, i) => (
                <Fragment key={i}>
                  <h4>{p.title}</h4>
                  <p>{renderScript(p.body, t => <span className="dl-merge">{SAMPLE[t]}</span>)}</p>
                </Fragment>
              ))}
            </div>
          </div>
          <p className="dl-sidenote">
            {plan === 'free'
              ? "On Free, the script shows on screen for your first 2 months. After that it's part of Starter."
              : `On ${PLAN_LABEL[plan]}, your script always shows on screen.`}
          </p>
        </aside>
      </div>
    </div>
  );
}
