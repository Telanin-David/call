import { useNavigate } from 'react-router-dom';
import { Button, Icon, List, ListRow, PageHeader, Pill, Progress, Tile, type PillTone } from '@dialer/ui';
import { Page } from '@/components/Page';

type Status = 'active' | 'done' | 'new' | 'abroad';

const STATUS: Record<Status, { label: string; tone: PillTone }> = {
  active: { label: 'In use', tone: 'brand' },
  done: { label: 'Done', tone: 'neutral' },
  new: { label: 'Not started', tone: 'warn' },
  abroad: { label: 'Outside US and Canada', tone: 'neutral' },
};

const LISTS: { name: string; total: number; called: number; followups: number; script: string; status: Status }[] = [
  { name: 'October leads', total: 42, called: 5, followups: 5, script: 'Office cleaning v2', status: 'active' },
  { name: 'September follow-up list', total: 120, called: 120, followups: 9, script: 'Office cleaning v2', status: 'done' },
  { name: 'Dental offices NY', total: 64, called: 0, followups: 0, script: 'Office cleaning v1', status: 'new' },
  { name: 'UK and Ghana numbers', total: 2, called: 0, followups: 0, script: 'Office cleaning v2', status: 'abroad' },
];

const COLS = 'grid-cols-[minmax(0,1fr)_200px_220px_150px_120px]';

export default function Leads() {
  const navigate = useNavigate();
  return (
    <Page width={1200}>
      <PageHeader title="Leads" lede="Your lead lists. Each list uses one script." className="gap-3" aside={<>
        <Button variant="outline" size="lg" onClick={() => navigate('/scripts')}><Icon name="file" size={17} />Edit scripts</Button>
        <Button variant="primary" size="lg" onClick={() => navigate('/leads/upload')}><Icon name="upload" size={17} />Upload a list</Button>
      </>} />

      <List>
        <ListRow cols={COLS} head><span>List</span><span>Script</span><span>Progress</span><span>Status</span><span /></ListRow>
        {LISTS.map(l => (
          <ListRow key={l.name} cols={COLS} className="py-4">
            <div className="flex items-center gap-3 max-lg:basis-full">
              <Tile tone={l.status === 'active' ? 'brand' : 'grey'}><Icon name="list" /></Tile>
              <div><b className="text-15">{l.name}</b><p className="text-13 text-muted">{l.total} leads · {l.followups} follow-ups<span className="lg:hidden"> · {l.script}</span></p></div>
            </div>
            <span className="text-14 text-ink-2 max-lg:hidden">{l.script}</span>
            <div className="max-lg:basis-full">
              <div className="mb-1.5 flex justify-between text-13"><span className="text-muted">{l.called} called</span><b>{l.total - l.called} left</b></div>
              <Progress value={(l.called / l.total) * 100} label={`${l.name} progress`} />
            </div>
            <Pill tone={STATUS[l.status].tone} className="max-lg:mr-auto">{STATUS[l.status].label}</Pill>
            {l.status === 'done'
              ? <Button variant="outline" className="h-[38px]" onClick={() => navigate('/history')}>Open</Button>
              : <Button variant="primary" className="h-[38px]" onClick={() => navigate('/call')}>Call list</Button>}
          </ListRow>
        ))}
      </List>

      <p className="flex items-start gap-3 text-13 text-muted"><Icon name="ban" size={15} className="mt-0.5 flex-none" />Numbers on the do-not-call list are removed when you upload, and you're never charged for them.</p>
    </Page>
  );
}
