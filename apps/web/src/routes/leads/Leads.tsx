import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Icon, List, ListRow, Modal, Note, PageHeader, Pill, Progress, Tile, useToast, type PillTone } from '@dialer/ui';
import { Page } from '@/components/Page';
import { activityKeys } from '@/lib/activity';
import { api, errorText } from '@/lib/api';
import { isLive } from '@/lib/backend';
import { leadKeys, useLists, type LeadList } from '@/lib/leads';

type Status = LeadList['status'];

const STATUS: Record<Status, { label: string; tone: PillTone }> = {
  active: { label: 'In use', tone: 'brand' },
  done: { label: 'Done', tone: 'neutral' },
  new: { label: 'Not started', tone: 'warn' },
  abroad: { label: 'Outside US and Canada', tone: 'neutral' },
};

type Row = { id: string; name: string; total: number; called: number; followups: number; script: string; status: Status };

const DEMO: Row[] = [
  { id: 'oct', name: 'October leads', total: 42, called: 5, followups: 5, script: 'Office cleaning v2', status: 'active' },
  { id: 'sep', name: 'September follow-up list', total: 120, called: 120, followups: 9, script: 'Office cleaning v2', status: 'done' },
  { id: 'dental', name: 'Dental offices NY', total: 64, called: 0, followups: 0, script: 'Office cleaning v1', status: 'new' },
  { id: 'abroad', name: 'UK and Ghana numbers', total: 2, called: 0, followups: 0, script: 'Office cleaning v2', status: 'abroad' },
];

function toRow(l: LeadList): Row {
  return { id: l.id, name: l.name, total: l.lead_count, called: l.called_count, followups: l.followup_count, script: l.script?.name ?? 'No script yet', status: l.status };
}

const COLS = 'grid-cols-[minmax(0,1fr)_200px_220px_150px_196px]';

export default function Leads() {
  const live = isLive();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const lists = useLists();
  const [hidden, setHidden] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const rows = (live ? (lists.data?.lists ?? []).map(toRow) : DEMO).filter(r => !hidden.includes(r.id));
  const empty = (live ? lists.isSuccess : true) && rows.length === 0;

  const remove = useMutation({
    mutationFn: (r: Row) => (live ? api.delete<void>(`/lists/${r.id}`) : Promise.resolve()),
    onSuccess: async (_, r) => {
      setDeleting(null);
      if (live) await Promise.all([leadKeys.lists, activityKeys.today, ['followups'], ['history']].map(queryKey => qc.invalidateQueries({ queryKey })));
      else setHidden(h => [...h, r.id]);
      toast(`${r.name} deleted`);
    },
  });

  return (
    <Page width={1200}>
      <PageHeader title="Leads" lede="Your lead lists. Each list uses one script." className="gap-3" aside={<>
        <Button variant="outline" size="lg" onClick={() => navigate('/scripts')}><Icon name="file" size={17} />Edit scripts</Button>
        <Button variant="primary" size="lg" onClick={() => navigate('/leads/upload')}><Icon name="upload" size={17} />Upload a list</Button>
      </>} />

      {lists.isError && <Note tone="danger" className="text-14"><Icon name="wrong" size={16} /><span role="alert">{errorText(lists.error)}</span></Note>}

      {empty ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border-[1.5px] border-dashed border-line-strong bg-surface px-6 py-10 text-center sm:p-12">
          <Tile tone="brand"><Icon name="list" /></Tile>
          <b>No lists yet</b>
          <p className="text-13 text-muted">Upload a CSV of the people you want to call.</p>
          <Button variant="primary" onClick={() => navigate('/leads/upload')}>Upload a list</Button>
        </div>
      ) : (
        <List>
          <ListRow cols={COLS} head><span>List</span><span>Script</span><span>Progress</span><span>Status</span><span /></ListRow>
          {live && lists.isPending && <p className="px-[18px] py-6 text-14 text-muted">Loading your lists…</p>}
          {rows.map(l => (
            <ListRow key={l.id} cols={COLS} className="py-4">
              <div className="flex min-w-0 items-center gap-3 max-lg:basis-full">
                <Tile tone={l.status === 'active' ? 'brand' : 'grey'}><Icon name="list" /></Tile>
                <div className="min-w-0"><b className="block truncate text-15">{l.name}</b><p className="text-13 text-muted">{l.total} leads · {l.followups} follow-ups<span className="lg:hidden"> · {l.script}</span></p></div>
              </div>
              <span className="text-14 text-ink-2 max-lg:hidden">{l.script}</span>
              <div className="max-lg:basis-full">
                <div className="mb-1.5 flex justify-between text-13"><span className="text-muted">{l.called} called</span><b>{l.total - l.called} left</b></div>
                <Progress value={l.total ? (l.called / l.total) * 100 : 0} label={`${l.name} progress`} />
              </div>
              <Pill tone={STATUS[l.status].tone} className="max-lg:mr-auto">{STATUS[l.status].label}</Pill>
              <div className="flex items-center gap-1.5 lg:justify-end">
                {l.status === 'done'
                  ? <Button variant="outline" className="h-[38px]" onClick={() => navigate('/history')}>Open</Button>
                  : <Button variant="primary" className="h-[38px]" onClick={() => navigate(`/call?list=${l.id}`)}>Call list</Button>}
                <Button variant="quiet" className="h-[38px] text-danger-ink" aria-label={`Delete ${l.name}`} onClick={() => { remove.reset(); setDeleting(l); }}>Delete</Button>
              </div>
            </ListRow>
          ))}
        </List>
      )}

      <p className="flex items-start gap-3 text-13 text-muted"><Icon name="ban" size={15} className="mt-0.5 flex-none" />Numbers on the do-not-call list are removed when you upload, and you're never charged for them.</p>

      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title={`Delete ${deleting?.name ?? 'this list'}?`} width="sm">
        <p className="mt-2 text-15 text-muted">
          {deleting ? `Its ${deleting.total} ${deleting.total === 1 ? 'lead' : 'leads'}` : 'Its leads'} and their follow-ups are removed for good.
          {deleting && deleting.called > 0 && ' Calls you already made stay in your history.'}
        </p>
        <p className="mt-2 text-13 text-muted">Numbers you already called 3 times, or marked do not call, stay blocked if you upload them again.</p>
        {remove.isError && <Note tone="danger" className="mt-3 text-14"><Icon name="wrong" size={16} /><span role="alert">{errorText(remove.error)}</span></Note>}
        <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
          <Button size="lg" onClick={() => setDeleting(null)}>Keep it</Button>
          <Button variant="danger" size="lg" disabled={remove.isPending} onClick={() => deleting && remove.mutate(deleting)}>Delete list</Button>
        </div>
      </Modal>
    </Page>
  );
}
