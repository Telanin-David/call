import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Icon, List, ListRow, PageHeader, Person, Pill, TabPills } from '@dialer/ui';
import { Page } from '@/components/Page';
import { FOLLOWUPS_TODAY, RESULT_LABEL, RESULT_TONE } from '@/lib/fake';

type Tab = 'today' | 'tomorrow' | 'week' | 'later';

const TABS = [
  { value: 'today', label: 'Due today', count: 5 },
  { value: 'tomorrow', label: 'Tomorrow', count: 3 },
  { value: 'week', label: 'This week', count: 9 },
  { value: 'later', label: 'Later', count: 14 },
] as const;

const COLS = 'grid-cols-[280px_170px_minmax(0,1fr)_120px_90px]';

export default function Followups() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('today');
  const rows = tab === 'today' ? FOLLOWUPS_TODAY : [];

  return (
    <Page width={1200}>
      <PageHeader title="Follow-ups" lede="People you said you'd call back, and people who called you."
        aside={<Button variant="primary" size="lg" onClick={() => navigate('/call')}><Icon name="call" size={17} />Call all {FOLLOWUPS_TODAY.length} in order</Button>} />

      <TabPills tabs={TABS} value={tab} onChange={setTab} />

      <List>
        <ListRow cols={COLS} head><span>Lead</span><span>When</span><span>Last note</span><span>Last result</span><span /></ListRow>
        {rows.map(f => {
          const missed = f.result === 'missed';
          return (
            <ListRow key={f.lead.id} cols={COLS} alert={missed}>
              <Person initials={f.lead.initials} tone={f.lead.tone} name={f.lead.name} sub={f.lead.company} className="max-lg:order-1 max-lg:flex-1" />
              <div className="max-lg:order-3 max-lg:flex max-lg:items-baseline max-lg:gap-2"><b className="text-14">{f.when}</b><p className={missed ? 'text-13 text-danger-ink' : 'text-13 text-brand-ink'}>{f.due}</p></div>
              <span className="text-14 text-ink-2 max-lg:order-4 max-lg:basis-full">{f.note}</span>
              <Pill tone={RESULT_TONE[f.result]} className="max-lg:order-3 max-lg:ml-auto">{RESULT_LABEL[f.result]}</Pill>
              <Button variant="primary" className="h-[38px] max-lg:order-2" onClick={() => navigate(`/call/${f.lead.id}`)}><Icon name="call" size={15} />Call</Button>
              <span aria-hidden="true" className="order-2 basis-full lg:hidden" />
            </ListRow>
          );
        })}
        {rows.length === 0 && <p className="px-6 py-12 text-center text-muted">Nothing due here yet.</p>}
      </List>

      <p className="text-13 text-muted">Missed calls come in when a lead calls your number back. On Starter and Pro you also get an alert on screen.</p>
    </Page>
  );
}
