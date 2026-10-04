import { Fragment, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button, Card, CardLabel, Checkbox, Icon, Input, LinkButton, Merge, Modal, Note, PageHeader, Paper, ScriptText, Tile, cn, useToast,
} from '@dialer/ui';
import { BackLink, Page } from '@/components/Page';
import { api, errorText } from '@/lib/api';
import { isLive } from '@/lib/backend';
import { dayMonth } from '@/lib/dates';
import { leadKeys, useLists } from '@/lib/leads';
import { usePlan, PLAN_LABEL } from '@/lib/plan';
import { MERGE_TAGS, SCRIPT_NAME, SCRIPT_PARTS, renderScript, type MergeValues, type ScriptPart } from '@/lib/script';
import { freshName, partsFromText, scriptKeys, useScripts, type Script } from '@/lib/scripts';

const SAMPLE: MergeValues = { first_name: 'Lena', company: 'Sparkle Offices', city: 'Brooklyn', her_time: '3:14 pm' };

/** A script being edited. listIds null means "the lists that have no script yet". */
type Draft = { key: string; id: string | null; name: string; parts: ScriptPart[]; listIds: string[] | null; saved: string; note?: string };
type ListOption = { id: string; name: string; script: { id: string; name: string } | null };

const snapshot = (name: string, parts: ScriptPart[], listIds: string[] | null) =>
  JSON.stringify([name, parts, listIds ? [...listIds].sort() : null]);

function fromScript(s: Script): Draft {
  const listIds = s.lists.map(l => l.id);
  return { key: s.id, id: s.id, name: s.name, parts: s.parts, listIds, saved: snapshot(s.name, s.parts, listIds) };
}

// Demo mode: the board.
const DEMO_LISTS: ListOption[] = [
  { id: 'oct', name: 'October leads', script: { id: 'v2', name: SCRIPT_NAME } },
  { id: 'dental', name: 'Dental offices NY', script: { id: 'v1', name: 'Office cleaning v1' } },
];
const DEMO: Draft[] = [
  { key: 'v2', id: 'v2', name: SCRIPT_NAME, parts: SCRIPT_PARTS, listIds: ['oct'], saved: '', note: 'In use · October leads' },
  { key: 'v1', id: 'v1', name: 'Office cleaning v1', parts: SCRIPT_PARTS, listIds: ['dental'], saved: '', note: 'Old' },
  { key: 'home', id: 'home', name: 'Home cleaning', parts: SCRIPT_PARTS, listIds: [], saved: '', note: 'Not in use' },
].map(d => ({ ...d, saved: snapshot(d.name, d.parts, d.listIds) }));

const tag = 'inline-flex items-center rounded-[7px] bg-brand-soft px-2 font-mono text-13 font-bold text-brand-ink';

let drafted = 0;

export default function Scripts() {
  const live = isLive();
  const { plan } = usePlan();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const fromSetup = params.get('from') === 'setup';
  const file = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const pressing = useRef(false);
  const toast = useToast();
  const qc = useQueryClient();
  const scriptsQ = useScripts();
  const listsQ = useLists();

  const [drafts, setDrafts] = useState<Draft[]>(live ? [] : DEMO);
  const [selected, setSelected] = useState(live ? '' : 'v2');
  const [editing, setEditing] = useState<number | null>(null);
  const [lastPart, setLastPart] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const lists: ListOption[] = live ? listsQ.data?.lists ?? [] : DEMO_LISTS;

  function blank(taken: readonly string[]): Draft {
    drafted += 1;
    const name = freshName(taken);
    const parts = [{ title: 'Opening', body: '' }];
    return { key: `new-${drafted}`, id: null, name, parts, listIds: live ? null : [], saved: '' };
  }

  // Live: start from the saved scripts, or a blank one for a first script.
  useEffect(() => {
    if (!live || !scriptsQ.data || drafts.length > 0) return;
    const loaded = scriptsQ.data.scripts.map(fromScript);
    const start = loaded.length > 0 ? loaded : [blank([])];
    setDrafts(start);
    setSelected(start[0]?.key ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on first load
  }, [live, scriptsQ.data]);

  // A part's text box closes when it loses focus. When that happens because
  // something else is being clicked, close it after the click, or the page
  // shifts under the pointer and the click is lost.
  useEffect(() => {
    const down = () => { pressing.current = true; };
    const up = () => { pressing.current = false; };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
    };
  }, []);

  function closeEditor(i: number) {
    const close = () => setEditing(cur => (cur === i ? null : cur));
    if (pressing.current) window.addEventListener('click', close, { once: true });
    else close();
  }

  const draft = drafts.find(d => d.key === selected) ?? drafts[0];
  const parts = draft?.parts ?? [];
  const listIds = draft ? draft.listIds ?? lists.filter(l => !l.script).map(l => l.id) : [];
  const dirty = (d: Draft) => d.id === null || snapshot(d.name, d.parts, d.listIds) !== d.saved;

  const change = (patch: Partial<Draft>) => setDrafts(ds => ds.map(d => (d.key === draft?.key ? { ...d, ...patch } : d)));
  const update = (i: number, patch: Partial<ScriptPart>) => change({ parts: parts.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  const save = useMutation({
    mutationFn: (d: Draft) => {
      const body = { name: d.name, parts: d.parts, list_ids: d.listIds ?? lists.filter(l => !l.script).map(l => l.id) };
      return d.id ? api.put<Script>(`/scripts/${d.id}`, body) : api.post<Script>('/scripts', body);
    },
    onSuccess: async (s, d) => {
      const next = fromScript(s);
      setDrafts(ds => ds.map(x => (x.key === d.key ? next : x)));
      setSelected(next.key);
      await Promise.all([qc.invalidateQueries({ queryKey: scriptKeys.scripts }), qc.invalidateQueries({ queryKey: leadKeys.lists })]);
      toast(`${s.name} saved`);
      if (fromSetup) navigate('/');
    },
  });

  const remove = useMutation({
    mutationFn: (d: Draft) => (live && d.id ? api.delete<void>(`/scripts/${d.id}`) : Promise.resolve()),
    onSuccess: async (_, d) => {
      setConfirmDelete(false);
      const rest = drafts.filter(x => x.key !== d.key);
      const next = rest.length > 0 ? rest : [blank([])];
      setDrafts(next);
      setSelected(next[0]?.key ?? '');
      if (live) await Promise.all([qc.invalidateQueries({ queryKey: scriptKeys.scripts }), qc.invalidateQueries({ queryKey: leadKeys.lists })]);
      toast(`${d.name} deleted`);
    },
  });

  async function upload(f: File) {
    const blocks = partsFromText(await f.text());
    if (blocks.length === 0) { toast(`${f.name} is empty`); return; }
    change({ parts: blocks });
    toast(`Added ${blocks.length} parts from ${f.name}`);
  }

  /** Puts {word} where the cursor is in the open part, or at the end of the last part used. */
  function insertField(word: string) {
    const i = lastPart;
    const body = parts[i]?.body ?? '';
    const el = editing === i ? box.current : null;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    const before = body.slice(0, start);
    const after = body.slice(end);
    const text = `${before && !/\s$/.test(before) ? ' ' : ''}{${word}}${after && !/^[\s.,!?;:]/.test(after) ? ' ' : ''}`;
    update(i, { body: before + text + after });
    if (el) requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + text.length, start + text.length); });
  }

  function newScript() {
    const d = blank(drafts.map(x => x.name));
    setDrafts(ds => [...ds, d]);
    setSelected(d.key);
    setEditing(null);
    setLastPart(0);
    save.reset();
  }

  function pick(key: string) {
    setSelected(key);
    setEditing(null);
    setLastPart(0);
    save.reset();
  }

  function toggleList(id: string, on: boolean) {
    change({ listIds: on ? [...listIds, id] : listIds.filter(x => x !== id) });
  }

  function noteFor(d: Draft): string {
    if (!live && d.note && !dirty(d)) return d.note;
    if (dirty(d)) return d.id ? 'Changes not saved' : 'Not saved yet';
    const names = lists.filter(l => d.listIds?.includes(l.id)).map(l => l.name);
    return names.length > 0 ? `In use · ${names.join(', ')}` : 'Not in use';
  }

  const freeUntil = scriptsQ.data?.on_screen_free_until;
  const planNote = live
    ? freeUntil === null || freeUntil === undefined
      ? `On ${PLAN_LABEL[plan]}, your script always shows on screen.`
      : new Date(`${freeUntil}T00:00:00Z`) > new Date()
        ? `On Free, the script shows on screen until ${dayMonth(freeUntil)}. After that it's part of Starter.`
        : `On Free, your 2 months of script on screen ended on ${dayMonth(freeUntil)}. Move to Starter to see it while you call.`
    : plan === 'free'
      ? "On Free, the script shows on screen for your first 2 months. After that it's part of Starter."
      : `On ${PLAN_LABEL[plan]}, your script always shows on screen.`;

  const loading = live && (scriptsQ.isPending || !draft);
  const failed = save.error ?? remove.error ?? scriptsQ.error;

  return (
    <Page width={1240}>
      <PageHeader title="Your script" lede="Write it once. It shows on screen while you call, with each lead's details filled in."
        back={fromSetup ? <BackLink to="/setup">Setup · step 6 of 6</BackLink> : <BackLink to="/leads">Leads</BackLink>}
        aside={<>
          <input ref={file} type="file" accept=".txt,text/plain" className="sr-only" aria-label="Script file"
            onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
          <Button variant="outline" disabled={!draft} onClick={() => file.current?.click()}><Icon name="upload" size={16} />Upload a file</Button>
          <Button variant="primary" disabled={!draft || save.isPending}
            onClick={() => (live && draft ? save.mutate(draft) : toast(`${draft?.name ?? 'Script'} saved`))}>
            {save.isPending ? 'Saving…' : 'Save script'}
          </Button>
        </>} />

      {failed && <Note tone="danger" className="text-14"><Icon name="wrong" size={16} /><span role="alert">{errorText(failed)}</span></Note>}

      {loading ? (
        <p className="text-14 text-muted">{scriptsQ.isError ? '' : 'Loading your scripts…'}</p>
      ) : draft && (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-3.5 md:grid-cols-[200px_minmax(0,1fr)] lg:grid-cols-[230px_minmax(0,1fr)_340px] lg:gap-[18px]">
          <Card as="nav" aria-label="Scripts" className="p-3.5">
            <CardLabel>Scripts</CardLabel>
            <div className="flex flex-col gap-1">
              {drafts.map(d => (
                <button key={d.key} type="button" aria-current={d.key === draft.key} onClick={() => pick(d.key)}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-3 py-2.5 text-left hover:bg-sunk aria-[current=true]:bg-brand-soft">
                  <Tile tone={(d.listIds?.length ?? 0) > 0 ? 'brand' : 'grey'} size={30}><Icon name="file" size={15} /></Tile>
                  <span className="min-w-0 flex-1"><b className="block truncate text-14">{d.name || 'Untitled'}</b><small className="block truncate text-12 text-muted">{noteFor(d)}</small></span>
                </button>
              ))}
            </div>
            <LinkButton className="ml-3 mt-3 text-14" onClick={newScript}>+ New script</LinkButton>
          </Card>

          <Card as="section" aria-label="Editor" className="p-4 sm:p-5">
            {live && (
              <Input aria-label="Script name" value={draft.name} maxLength={80} onChange={e => change({ name: e.target.value })}
                className="mb-3.5 h-11 text-17 font-bold" />
            )}
            <div className="mb-3.5 flex flex-wrap items-center gap-2 text-13 text-muted">
              <span className="mr-1">Add a detail:</span>
              {MERGE_TAGS.map(t => (
                <button key={t} type="button" className={cn(tag, 'h-7 cursor-pointer rounded-sm border-0 px-2.5')}
                  // Keep the text box open and its cursor where it was.
                  onMouseDown={e => e.preventDefault()} onClick={() => insertField(t)}>{t}</button>
              ))}
            </div>
            <div className="flex flex-col gap-3.5">
              {parts.map((p, i) => (
                <div key={i} className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <Input aria-label="Part title" value={p.title} onChange={e => update(i, { title: e.target.value })}
                      className="h-9 flex-1 border-transparent bg-sunk px-2.5 text-13 font-bold uppercase tracking-[.04em] text-muted" />
                    {parts.length > 1 && (
                      <button type="button" aria-label={`Remove ${p.title || 'this part'}`} title="Remove this part"
                        onClick={() => { change({ parts: parts.filter((_, j) => j !== i) }); setEditing(null); setLastPart(0); }}
                        className="flex size-9 flex-none cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent text-faint hover:bg-sunk hover:text-ink">
                        <Icon name="x" size={16} />
                      </button>
                    )}
                  </div>
                  {editing === i ? (
                    <textarea ref={box} autoFocus aria-label={`${p.title} text`} value={p.body} placeholder="Write what you'll say. Add details like {first_name}."
                      onChange={e => update(i, { body: e.target.value })} onBlur={() => closeEditor(i)}
                      className="min-h-[84px] w-full rounded-sm border border-line-strong bg-surface p-3 text-16 leading-[26px] text-ink" />
                  ) : (
                    <button type="button" onClick={() => { setEditing(i); setLastPart(i); }}
                      className="w-full cursor-text rounded-sm border-0 bg-transparent px-2.5 py-1 text-left text-16 leading-[26px] hover:bg-sunk">
                      {p.body ? renderScript(p.body, t => <span className={cn(tag, 'h-6')}>{t}</span>) : <span className="text-faint">Tap to write this part</span>}
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3">
              <LinkButton className="text-14" onClick={() => change({ parts: [...parts, { title: 'New part', body: '' }] })}>+ Add a part</LinkButton>
              <LinkButton className="text-14 text-danger-ink" onClick={() => setConfirmDelete(true)}>Delete script</LinkButton>
            </div>

            <div role="group" aria-label="Lists using this script" className="mt-5 border-t border-line pt-4">
              <CardLabel>Lists using this script</CardLabel>
              {lists.length === 0 ? (
                <p className="text-14 text-muted">No lead lists yet. Upload one and it can use this script.</p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {lists.map(l => {
                    const other = l.script && l.script.id !== draft.id ? l.script.name : null;
                    const checked = listIds.includes(l.id);
                    return (
                      <Checkbox key={l.id} checked={checked} onChange={e => toggleList(l.id, e.target.checked)}>
                        <b className="font-semibold text-ink">{l.name}</b>
                        {other && <span className="text-muted">{checked ? ` · moves here from ${other}` : ` · uses ${other}`}</span>}
                      </Checkbox>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>

          <aside className="flex flex-col gap-2.5 md:col-span-2 lg:col-span-1">
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
            <p className="px-1 text-13 leading-[19px] text-muted">{planNote}</p>
          </aside>
        </div>
      )}

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title={`Delete ${draft?.name ?? 'this script'}?`} width="sm">
        <p className="mt-2 text-15 text-muted">
          {listIds.length > 0 && draft?.id ? 'Lists that use it will have no script until you pick another.' : 'It is removed for good.'}
        </p>
        <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
          <Button size="lg" onClick={() => setConfirmDelete(false)}>Keep it</Button>
          <Button variant="danger" size="lg" disabled={remove.isPending} onClick={() => draft && remove.mutate(draft)}>Delete</Button>
        </div>
      </Modal>
    </Page>
  );
}
