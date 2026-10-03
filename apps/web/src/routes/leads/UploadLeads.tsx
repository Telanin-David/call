import { Fragment, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, CardLabel, DarkCard, DarkEyebrow, Icon, LinkButton, List, PageHeader, Tile, cn, type IconName, type TileTone } from '@dialer/ui';
import { BackLink, Page } from '@/components/Page';

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

const LEFT_OUT: { icon: IconName; tone: TileTone; title: string; body: string }[] = [
  { icon: 'globe', tone: 'lemon', title: '2 not US or Canada', body: 'UK and Ghana numbers. Calling them costs more, so they go in a separate list.' },
  { icon: 'users', tone: 'grey', title: '2 duplicates', body: 'Same phone number twice. We kept the first.' },
  { icon: 'ban', tone: 'red', title: '1 on the do-not-call list', body: 'We never call it, and you are never charged.' },
];

const STEPS = ['Upload file', 'Match columns', 'Check and add'] as const;
const MAP_COLS = 'grid grid-cols-[200px_1fr_30px_280px] items-center gap-3 border-t border-line px-[18px]';

export default function UploadLeads() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const fromSetup = params.get('from') === 'setup';
  const [step, setStep] = useState<1 | 2>(params.get('step') === 'match' ? 2 : 1);
  const [mapping, setMapping] = useState<Field[]>(COLUMNS.map(c => c.saveAs));

  return (
    <Page className="gap-[22px]">
      <PageHeader title="Upload leads"
        back={fromSetup ? <BackLink to="/setup">Setup · step 5 of 6</BackLink> : <BackLink to="/leads">Leads</BackLink>} />

      <ol className="flex items-center gap-3" aria-label="Progress">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const state = n < step ? 'done' : n === step ? 'now' : 'todo';
          return (
            <Fragment key={label}>
              {i > 0 && <li aria-hidden="true" className="h-0.5 w-10 flex-none bg-line-2" />}
              <li className={cn('flex items-center gap-2.5 text-14 font-semibold', state === 'now' && 'font-bold', state === 'todo' && 'text-faint')}>
                <span className={cn('flex size-7 items-center justify-center rounded-full text-13 font-extrabold',
                  state === 'done' && 'bg-success text-white', state === 'now' && 'bg-tangerine text-night', state === 'todo' && 'bg-well-2 text-faint')}>
                  {state === 'done' ? <Icon name="check" size={14} /> : n}
                </span>
                {label}
              </li>
            </Fragment>
          );
        })}
      </ol>

      {step === 1 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border-[1.5px] border-dashed border-line-strong bg-surface p-12 text-center">
          <Tile tone="brand"><Icon name="upload" /></Tile>
          <b>Drop a CSV file here</b>
          <p className="text-13 text-muted">First row should be column names. Up to 5,000 rows.</p>
          <Button variant="primary" onClick={() => setStep(2)}>Choose file</Button>
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-6">
          <List>
            <div className="flex items-center gap-3.5 px-[18px] py-4">
              <Tile tone="mint"><Icon name="file" size={19} /></Tile>
              <div className="flex-1"><b className="text-15">october-leads.csv</b><p className="text-13 text-muted">42 rows · 8 columns</p></div>
              <LinkButton className="text-14" onClick={() => setStep(1)}>Change file</LinkButton>
            </div>
            <div className={cn(MAP_COLS, 'bg-sunk py-2.5 text-12 font-extrabold uppercase tracking-[.05em] text-faint')}>
              <span>Your column</span><span>First row</span><span /><span>Save as</span>
            </div>
            {COLUMNS.map((c, i) => {
              const skip = mapping[i] === 'Skip this column';
              return (
                <div key={c.yours} className={cn(MAP_COLS, 'py-3')}>
                  <b className="text-14">{c.yours}</b>
                  <span className="truncate text-14 text-muted">{c.sample}</span>
                  <Icon name="right" size={16} className="text-off" />
                  <span className="relative">
                    <select aria-label={`Save ${c.yours} as`} value={mapping[i]}
                      onChange={e => setMapping(m => m.map((v, j) => (j === i ? (e.target.value as Field) : v)))}
                      className={cn('h-10 w-full cursor-pointer appearance-none rounded-md border pl-3 pr-8 text-14',
                        skip ? 'border-line-2 bg-sunk font-medium text-faint' : 'border-line-strong bg-surface font-semibold text-ink')}>
                      {FIELDS.map(f => <option key={f}>{f}</option>)}
                    </select>
                    <Icon name="right" size={14} className="pointer-events-none absolute right-3 top-[13px] rotate-90 text-faint" />
                  </span>
                </div>
              );
            })}
          </List>

          <aside className="flex flex-col gap-3.5">
            <DarkCard className="p-6">
              <DarkEyebrow>READY TO ADD</DarkEyebrow>
              <div className="mt-1.5 text-44 font-extrabold tracking-[-0.04em]">37<small className="text-18 font-semibold text-zinc-400"> of 42</small></div>
              <div className="mt-1 text-14 text-zinc-300">List name: <b className="text-white">October leads</b></div>
              <Button variant="primary" size="lg" block className="mt-[18px]" onClick={() => navigate(fromSetup ? '/scripts?from=setup' : '/leads')}>Add 37 leads</Button>
            </DarkCard>
            <div className="rounded-3xl border border-line bg-surface p-5">
              <CardLabel>5 rows left out</CardLabel>
              <div className="flex flex-col gap-3 text-14">
                {LEFT_OUT.map(r => (
                  <div key={r.title} className="flex gap-2.5">
                    <Tile tone={r.tone} size={30}><Icon name={r.icon} size={15} /></Tile>
                    <span><b>{r.title}</b><p className="text-muted">{r.body}</p></span>
                  </div>
                ))}
                <LinkButton className="self-start text-14">See the 5 rows</LinkButton>
              </div>
            </div>
          </aside>
        </div>
      )}
    </Page>
  );
}
