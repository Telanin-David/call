import { Fragment, useId, useRef, useState, type DragEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, CardLabel, DarkCard, DarkEyebrow, Icon, LinkButton, List, Note, PageHeader, Tile, cn, useToast, type IconName, type TileTone } from '@dialer/ui';
import { BackLink, Page } from '@/components/Page';
import { api, errorText } from '@/lib/api';
import { isLive } from '@/lib/backend';
import {
  FIELDS, FIELD_LABEL, leadKeys, leftOutLine, listNameFromFile, readCsvFile, remap,
  type ImportCheck, type LeadField, type LeadList, type LeftOutReason,
} from '@/lib/leads';

const STEPS = ['Upload file', 'Match columns', 'Check and add'] as const;
const MAP_COLS = 'grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-x-3 border-t border-line px-4 sm:grid-cols-[200px_1fr_30px_280px] sm:gap-3 sm:px-[18px]';

const LEFT_OUT: Record<LeftOutReason, { icon: IconName; tone: TileTone; title: (n: number) => string; body: string }> = {
  abroad: { icon: 'globe', tone: 'lemon', title: n => `${n} not US or Canada`, body: 'Calling them costs more, so they go in a separate list.' },
  duplicate: { icon: 'users', tone: 'grey', title: n => `${n} duplicate${n === 1 ? '' : 's'}`, body: 'Same phone number twice. We kept the first.' },
  listed: { icon: 'list', tone: 'grey', title: n => `${n} already in your lists`, body: 'We kept them in the list they are in.' },
  dnc: { icon: 'ban', tone: 'red', title: n => `${n} on the do-not-call list`, body: 'We never call it, and you are never charged.' },
  premium: { icon: 'ban', tone: 'red', title: n => `${n} premium-rate number${n === 1 ? '' : 's'}`, body: 'They charge the caller a lot, so they are never called.' },
  invalid: { icon: 'phone', tone: 'red', title: n => `${n} without a full phone number`, body: 'Numbers outside the US and Canada need their country code, like +233.' },
};
const REASONS = Object.keys(LEFT_OUT) as LeftOutReason[];

// Demo mode: the board's file.
const DEMO_FILE = 'october-leads.csv';
const DEMO: ImportCheck = {
  columns: [
    { header: 'First Name', sample: 'Lena', field: 'first_name' },
    { header: 'Last Name', sample: 'Park', field: 'last_name' },
    { header: 'Business', sample: 'Sparkle Offices', field: 'company' },
    { header: 'Phone', sample: '(646) 555-0110', field: 'phone' },
    { header: 'Email Address', sample: 'lena@sparkleoffices.com', field: 'email' },
    { header: 'City', sample: 'Brooklyn, NY', field: 'city' },
    { header: 'Sites', sample: '3', field: 'skip' },
    { header: 'Notes', sample: 'Unhappy with Friday cleaner', field: 'notes' },
  ],
  rows: 42, ready: 37, abroad: 2,
  left_out: { abroad: 2, duplicate: 2, dnc: 1, listed: 0, premium: 0, invalid: 0 },
  left_out_rows: [
    { row: 9, name: 'Kofi Asante', phone: '+233 24 555 0190', reason: 'abroad', same_as_row: null, list_name: null },
    { row: 17, name: 'Amy Clarke', phone: '+44 20 7946 0958', reason: 'abroad', same_as_row: null, list_name: null },
    { row: 23, name: 'Lena Park', phone: '(646) 555-0110', reason: 'duplicate', same_as_row: 4, list_name: null },
    { row: 31, name: 'Tom Allen', phone: '(917) 555-0142', reason: 'duplicate', same_as_row: 12, list_name: null },
    { row: 38, name: 'Maria Gomez', phone: '(305) 555-0117', reason: 'dnc', same_as_row: null, list_name: null },
  ],
  problem: null,
};

type Upload = { id: number; name: string; text: string };

export default function UploadLeads() {
  const live = isLive();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const fromSetup = params.get('from') === 'setup';
  const nameId = useId();
  const picker = useRef<HTMLInputElement>(null);
  const uploads = useRef(0);

  const [demoStep, setDemoStep] = useState<1 | 2>(params.get('step') === 'match' ? 2 : 1);
  const [file, setFile] = useState<Upload | null>(null);
  const [fileError, setFileError] = useState('');
  const [dragging, setDragging] = useState(false);
  // null until the rep changes a column: the api's suggestion is used.
  const [mapping, setMapping] = useState<LeadField[] | null>(null);
  const [demoMapping, setDemoMapping] = useState<LeadField[]>(DEMO.columns.map(c => c.field));
  const [listName, setListName] = useState(live ? '' : 'October leads');
  const [showRows, setShowRows] = useState(false);

  const check = useQuery({
    queryKey: ['import-check', file?.id, mapping],
    queryFn: () => api.post<ImportCheck>('/imports/check', { csv: file?.text, ...(mapping ? { mapping } : {}) }),
    enabled: live && file !== null,
    // While a new mapping is checked, keep showing the last result for the
    // same file; a different file starts fresh.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === file?.id ? prev : undefined),
    staleTime: Infinity,
  });

  const result = live ? check.data : DEMO;
  const fields = live ? mapping ?? result?.columns.map(c => c.field) ?? [] : demoMapping;
  const step = live ? (file && check.data ? 2 : 1) : demoStep;
  const fileName = live ? file?.name ?? '' : DEMO_FILE;

  const add = useMutation({
    mutationFn: () => api.post<{ lists: LeadList[] }>('/imports', { csv: file?.text, mapping: fields, name: listName }),
    onSuccess: async ({ lists }) => {
      await qc.invalidateQueries({ queryKey: leadKeys.lists });
      const added = lists.reduce((n, l) => n + l.lead_count, 0);
      toast(`Added ${added} lead${added === 1 ? '' : 's'} to ${lists[0]?.name ?? 'your lists'}`);
      navigate(fromSetup ? '/scripts?from=setup' : '/leads');
    },
  });

  async function choose(f: File | undefined) {
    if (!f) return;
    setFileError('');
    add.reset();
    try {
      const text = await readCsvFile(f);
      uploads.current += 1;
      setFile({ id: uploads.current, name: f.name, text });
      setMapping(null);
      setListName(listNameFromFile(f.name));
      setShowRows(false);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : "That file couldn't be read.");
    }
  }

  function changeFile() {
    if (!live) {
      setDemoStep(1);
      return;
    }
    setFile(null);
    setMapping(null);
    picker.current?.click();
  }

  function setField(i: number, field: LeadField) {
    const next = remap(fields, i, field);
    if (live) setMapping(next);
    else setDemoMapping(next);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (live) void choose(e.dataTransfer.files[0]);
  }

  const leftOutTotal = result ? REASONS.reduce((n, r) => n + result.left_out[r], 0) : 0;
  const hidden = result ? leftOutTotal - result.left_out_rows.length : 0;
  const readError = fileError || (live && file && check.isError ? errorText(check.error) : '');
  const canAdd = Boolean(result && !result.problem && result.ready + result.abroad > 0 && listName.trim() && !check.isFetching);

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
              {i > 0 && <li aria-hidden="true" className="h-0.5 w-4 flex-none bg-line-2 sm:w-10" />}
              <li className={cn('flex items-center gap-2.5 text-14 font-semibold', state === 'now' && 'font-bold', state === 'todo' && 'text-faint')}>
                <span className={cn('flex size-7 items-center justify-center rounded-full text-13 font-extrabold',
                  state === 'done' && 'bg-success text-white', state === 'now' && 'bg-tangerine text-night', state === 'todo' && 'bg-well-2 text-faint')}>
                  {state === 'done' ? <Icon name="check" size={14} /> : n}
                </span>
                <span className={cn(state !== 'now' && 'max-sm:sr-only')}>{label}</span>
              </li>
            </Fragment>
          );
        })}
      </ol>

      <input ref={picker} type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" tabIndex={-1} aria-hidden="true"
        onChange={e => { void choose(e.target.files?.[0]); e.target.value = ''; }} />

      {step === 1 || !result ? (
        <div onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
          className={cn('flex flex-col items-center justify-center gap-3 rounded-xl border-[1.5px] border-dashed bg-surface px-6 py-10 text-center sm:p-12',
            dragging ? 'border-brand bg-brand-soft' : 'border-line-strong')}>
          <Tile tone="brand"><Icon name="upload" /></Tile>
          <b>{live && file && check.isFetching ? `Reading ${file.name}…` : 'Drop a CSV file here'}</b>
          <p className="text-13 text-muted">First row should be column names. Up to 5,000 rows.</p>
          {readError && <Note tone="danger" className="max-w-md text-left text-14"><Icon name="wrong" size={16} /><span role="alert">{readError}</span></Note>}
          <Button variant="primary" disabled={live && file !== null && check.isFetching}
            onClick={() => (live ? picker.current?.click() : setDemoStep(2))}>
            {readError ? 'Choose another file' : 'Choose file'}
          </Button>
        </div>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6">
          <div className="flex flex-col gap-3.5">
            {result.problem && (
              <Note tone="danger" className="text-14"><Icon name="wrong" size={16} /><span role="alert">{result.problem.error}</span></Note>
            )}
            <List>
              <div className="flex items-center gap-3.5 px-4 py-4 sm:px-[18px]">
                <Tile tone="mint"><Icon name="file" size={19} /></Tile>
                <div className="min-w-0 flex-1"><b className="block truncate text-15">{fileName}</b><p className="text-13 text-muted">{result.rows} rows · {result.columns.length} columns</p></div>
                <LinkButton className="text-14" onClick={changeFile}>Change file</LinkButton>
              </div>
              <div className={cn(MAP_COLS, 'bg-sunk py-2.5 text-12 font-extrabold uppercase tracking-[.05em] text-faint')}>
                <span>Your column</span><span className="max-sm:hidden">First row</span><span className="max-sm:hidden" /><span>Save as</span>
              </div>
              {result.columns.map((c, i) => {
                const field = fields[i] ?? 'skip';
                const skip = field === 'skip';
                return (
                  <div key={`${i}-${c.header}`} className={cn(MAP_COLS, 'py-3')}>
                    <b className="truncate text-14 max-sm:col-start-1">{c.header}</b>
                    <span className="truncate text-14 text-muted max-sm:col-start-1 max-sm:row-start-2 max-sm:text-13">{c.sample || '—'}</span>
                    <Icon name="right" size={16} className="text-off max-sm:hidden" />
                    <span className="relative max-sm:col-start-2 max-sm:row-span-2 max-sm:row-start-1">
                      <select aria-label={`Save ${c.header} as`} value={field}
                        onChange={e => setField(i, e.target.value as LeadField)}
                        className={cn('h-10 w-full cursor-pointer appearance-none rounded-md border pl-3 pr-8 text-13 sm:text-14',
                          skip ? 'border-line-2 bg-sunk font-medium text-faint' : 'border-line-strong bg-surface font-semibold text-ink')}>
                        {FIELDS.map(f => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
                      </select>
                      <Icon name="right" size={14} className="pointer-events-none absolute right-3 top-[13px] rotate-90 text-faint" />
                    </span>
                  </div>
                );
              })}
            </List>
          </div>

          <aside className="flex flex-col gap-3.5">
            <DarkCard className="p-6">
              <DarkEyebrow>READY TO ADD</DarkEyebrow>
              <div className="mt-1.5 text-44 font-extrabold tracking-[-0.04em]" aria-live="polite">
                {result.ready}<small className="text-18 font-semibold text-zinc-400"> of {result.rows}</small>
              </div>
              {live ? (
                <label htmlFor={nameId} className="mt-2 block text-14 text-zinc-300">
                  List name
                  <input id={nameId} value={listName} maxLength={80} onChange={e => setListName(e.target.value)}
                    className="mt-1.5 h-10 w-full rounded-md border border-zinc-600 bg-zinc-800 px-3 text-15 font-semibold text-white outline-none focus:border-brand" />
                </label>
              ) : (
                <div className="mt-1 text-14 text-zinc-300">List name: <b className="text-white">{listName}</b></div>
              )}
              {add.isError && <p role="alert" className="mt-3 text-14 text-brand">{errorText(add.error)}</p>}
              <Button variant="primary" size="lg" block className="mt-[18px]" disabled={live && (!canAdd || add.isPending)}
                onClick={() => (live ? add.mutate() : navigate(fromSetup ? '/scripts?from=setup' : '/leads'))}>
                {add.isPending ? 'Adding…' : `Add ${result.ready || result.abroad} leads`}
              </Button>
            </DarkCard>
            <div className="rounded-3xl border border-line bg-surface p-5">
              <CardLabel>{leftOutTotal === 0 ? 'Nothing left out' : `${leftOutTotal} row${leftOutTotal === 1 ? '' : 's'} left out`}</CardLabel>
              <div className="flex flex-col gap-3 text-14">
                {leftOutTotal === 0 && <p className="text-muted">Every row with a phone number can be called.</p>}
                {REASONS.filter(r => result.left_out[r] > 0).map(r => (
                  <div key={r} className="flex gap-2.5">
                    <Tile tone={LEFT_OUT[r].tone} size={30}><Icon name={LEFT_OUT[r].icon} size={15} /></Tile>
                    <span><b>{LEFT_OUT[r].title(result.left_out[r])}</b><p className="text-muted">{LEFT_OUT[r].body}</p></span>
                  </div>
                ))}
                {showRows && (
                  <ul className="flex max-h-72 list-none flex-col gap-1 overflow-auto rounded-xl bg-sunk p-3 font-mono text-12 text-muted">
                    {result.left_out_rows.map(r => <li key={r.row}>{leftOutLine(r)}</li>)}
                    {hidden > 0 && <li>…and {hidden} more</li>}
                  </ul>
                )}
                {leftOutTotal > 0 && (
                  <LinkButton className="self-start text-14" aria-expanded={showRows} onClick={() => setShowRows(v => !v)}>
                    {showRows ? `Hide the ${leftOutTotal} rows` : `See the ${leftOutTotal} rows`}
                  </LinkButton>
                )}
              </div>
            </div>
          </aside>
        </div>
      )}
    </Page>
  );
}
