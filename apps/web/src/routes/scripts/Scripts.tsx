import { useState } from 'react';
import Icon from '@/components/Icon';

const SCRIPTS = [
  { name: 'Main pitch', active: true },
  { name: 'Finance pitch', active: false },
  { name: 'Trade pitch', active: false },
  { name: 'Tech pitch', active: false },
  { name: 'RE pitch', active: false },
];

const DEFAULT_SCRIPT = {
  sections: [
    {
      title: 'OPENING',
      content: "Hey {FirstName}, this is Tunde calling — quick 30-second interruption. Does that work?",
    },
    {
      title: 'VALUE PROP',
      content: "I help {JobTitle}s in {City} close more deals using targeted US and Canada call lists. We've helped similar companies increase their pipeline by 3×.",
    },
    {
      title: 'CLOSE',
      content: "Do you have 15 minutes this week to see if it's a fit?",
    },
  ],
};

function renderWithMergeTags(text: string) {
  return text.split(/(\{[^}]+\})/g).map((part, i) =>
    part.startsWith('{') ? (
      <span key={i} className="dl-merge">{part.slice(1, -1)}</span>
    ) : part
  );
}

export default function Scripts() {
  const [selected, setSelected] = useState(0);
  const [sections, setSections] = useState(DEFAULT_SCRIPT.sections);

  return (
    <div className="dl" style={{ height: 'calc(100vh - 60px)', display: 'grid', gridTemplateColumns: '230px minmax(0,1fr) 340px' }}>
      {/* Scripts sidebar */}
      <aside style={{ background: 'var(--surface)', borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 12px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Scripts</span>
          <button className="dl-link" style={{ fontSize: 13 }}>+ New</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
          {SCRIPTS.map((s, i) => (
            <button key={s.name}
              onClick={() => setSelected(i)}
              style={{
                width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 8,
                border: 0, cursor: 'pointer', fontFamily: 'var(--font-sans)',
                background: selected === i ? 'var(--brand-soft)' : 'transparent',
                color: selected === i ? 'var(--brand-ink)' : 'var(--ink)',
                fontWeight: selected === i ? 600 : 400, fontSize: 14,
              }}>
              {s.name}
              {s.active && <span className="dl-dot dl-dot--ok" style={{ marginLeft: 8 }} />}
            </button>
          ))}
        </div>
      </aside>

      {/* Editor */}
      <main style={{ overflow: 'auto', padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 className="dl-title">{SCRIPTS[selected]?.name}</h1>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="dl-btn dl-btn--outline">Rename</button>
            <button className="dl-btn dl-btn--primary">Save</button>
          </div>
        </div>

        {sections.map((sec, si) => (
          <div key={si} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input
              value={sec.title}
              onChange={e => setSections(s => s.map((x, i) => i === si ? { ...x, title: e.target.value } : x))}
              style={{
                background: 'var(--surface-sunk)', border: 0, borderRadius: 6, padding: '4px 10px',
                fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
                color: 'var(--faint)', fontFamily: 'var(--font-sans)', width: '100%',
              }}
            />
            <textarea
              value={sec.content}
              onChange={e => setSections(s => s.map((x, i) => i === si ? { ...x, content: e.target.value } : x))}
              className="dl-input"
              style={{ minHeight: 100, fontSize: 16, lineHeight: '26px' }}
            />
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="dl-btn dl-btn--outline" onClick={() => setSections(s => [...s, { title: 'NEW SECTION', content: '' }])}>
            + Add section
          </button>
        </div>

        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
          <div className="dl-small dl-muted" style={{ marginBottom: 10 }}>
            Use <code style={{ background: 'var(--surface-sunk)', padding: '1px 5px', borderRadius: 4 }}>{'{FirstName}'}</code> for merge tags. Available: FirstName, LastName, Company, JobTitle, City, Website.
          </div>
        </div>
      </main>

      {/* Preview */}
      <aside style={{ background: 'var(--surface-sunk)', borderLeft: '1px solid var(--line)', padding: 24, overflow: 'auto' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.1em', color: 'var(--faint)', textTransform: 'uppercase', marginBottom: 16 }}>
          Preview · calling Lena Okafor
        </div>
        <div className="dl-paper">
          <div className="dl-sc">
            {sections.map((sec, i) => (
              <div key={i}>
                <h4>{sec.title}</h4>
                <p>{renderWithMergeTags(
                  sec.content
                    .replace('{FirstName}', 'Lena')
                    .replace('{LastName}', 'Okafor')
                    .replace('{Company}', 'MegaCorp')
                    .replace('{JobTitle}', 'Director')
                    .replace('{City}', 'Lagos')
                    .replace('{Website}', 'megacorp.ng')
                )}</p>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
