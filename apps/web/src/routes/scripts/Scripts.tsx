import { Fragment, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, CardLabel, Icon, Input, LinkButton, Merge, PageHeader, Paper, ScriptText, Tile, cn } from '@dialer/ui';
import { BackLink, Page } from '@/components/Page';
import { usePlan, PLAN_LABEL } from '@/lib/plan';
import { MERGE_TAGS, SCRIPT_NAME, SCRIPT_PARTS, renderScript, type MergeValues, type ScriptPart } from '@/lib/script';

const SAMPLE: MergeValues = { first_name: 'Lena', company: 'Sparkle Offices', city: 'Brooklyn', her_time: '3:14 pm' };

const SCRIPTS = [
  { name: SCRIPT_NAME, note: 'In use · October leads', active: true },
  { name: 'Office cleaning v1', note: 'Old', active: false },
  { name: 'Home cleaning', note: 'Not in use', active: false },
];

const tag = 'inline-flex items-center rounded-[7px] bg-brand-soft px-2 font-mono text-13 font-bold text-brand-ink';

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
    <Page width={1240}>
      <PageHeader title="Your script" lede="Write it once. It shows on screen while you call, with each lead's details filled in."
        back={fromSetup ? <BackLink to="/setup">Setup · step 6 of 6</BackLink> : <BackLink to="/leads">Leads</BackLink>}
        aside={<>
          <Button variant="outline"><Icon name="upload" size={16} />Upload a file</Button>
          <Button variant="primary">Save script</Button>
        </>} />

      <div className="grid grid-cols-[230px_minmax(0,1fr)_340px] items-start gap-[18px]">
        <Card as="nav" aria-label="Scripts" className="p-3.5">
          <CardLabel>Scripts</CardLabel>
          <div className="flex flex-col gap-1">
            {SCRIPTS.map((s, i) => (
              <button key={s.name} type="button" aria-current={selected === i} onClick={() => setSelected(i)}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-3 py-2.5 text-left hover:bg-sunk aria-[current=true]:bg-brand-soft">
                <Tile tone={s.active ? 'brand' : 'grey'} size={30}><Icon name="file" size={15} /></Tile>
                <span className="min-w-0 flex-1"><b className="block text-14">{s.name}</b><small className="block text-12 text-muted">{s.note}</small></span>
              </button>
            ))}
          </div>
          <LinkButton className="ml-3 mt-3 text-14">+ New script</LinkButton>
        </Card>

        <Card as="section" aria-label="Editor" className="p-5">
          <div className="mb-3.5 flex flex-wrap items-center gap-2 text-13 text-muted">
            <span className="mr-1">Add a detail:</span>
            {MERGE_TAGS.map(t => (
              <button key={t} type="button" className={cn(tag, 'h-7 cursor-pointer rounded-sm border-0 px-2.5')}
                onClick={() => update(lastPart, { body: `${parts[lastPart]?.body ?? ''} {${t}}` })}>{t}</button>
            ))}
          </div>
          <div className="flex flex-col gap-3.5">
            {parts.map((p, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <Input aria-label="Part title" value={p.title} onChange={e => update(i, { title: e.target.value })}
                  className="h-9 border-transparent bg-sunk px-2.5 text-13 font-bold uppercase tracking-[.04em] text-muted" />
                {editing === i ? (
                  <textarea autoFocus aria-label={`${p.title} text`} value={p.body}
                    onChange={e => update(i, { body: e.target.value })} onBlur={() => setEditing(null)}
                    className="min-h-[84px] w-full rounded-sm border border-line-strong bg-surface p-3 text-16 leading-[26px] text-ink" />
                ) : (
                  <button type="button" onClick={() => { setEditing(i); setLastPart(i); }}
                    className="w-full cursor-text rounded-sm border-0 bg-transparent px-2.5 py-1 text-left text-16 leading-[26px] hover:bg-sunk">
                    {renderScript(p.body, t => <span className={cn(tag, 'h-6')}>{t}</span>)}
                  </button>
                )}
              </div>
            ))}
          </div>
          <LinkButton className="mt-3.5 text-14" onClick={() => setParts(ps => [...ps, { title: 'New part', body: '' }])}>+ Add a part</LinkButton>
        </Card>

        <aside className="flex flex-col gap-2.5">
          <CardLabel className="mb-0">On a call with Lena, it looks like this</CardLabel>
          <Paper className="max-h-[580px] rounded-3xl p-[22px]">
            <ScriptText className="text-17 leading-[27px]">
              {parts.map((p, i) => (
                <Fragment key={i}>
                  <h4>{p.title}</h4>
                  <p>{renderScript(p.body, t => <Merge>{SAMPLE[t]}</Merge>)}</p>
                </Fragment>
              ))}
            </ScriptText>
          </Paper>
          <p className="px-1 text-13 leading-[19px] text-muted">
            {plan === 'free'
              ? "On Free, the script shows on screen for your first 2 months. After that it's part of Starter."
              : `On ${PLAN_LABEL[plan]}, your script always shows on screen.`}
          </p>
        </aside>
      </div>
    </Page>
  );
}
