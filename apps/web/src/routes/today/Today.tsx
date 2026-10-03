import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, CardHead, DarkCard, DarkEyebrow, Icon, Kpis, PageHeader, Person, Pill, Stat, Tile, buttonClass, cn, linkClass } from '@dialer/ui';
import { Page } from '@/components/Page';
import { usePlan } from '@/lib/plan';
import { FOLLOWUPS_TODAY, ME, RESULT_LABEL, RESULT_TONE } from '@/lib/fake';
import { DIALS_PER_DAY } from '@/lib/pricing';

export default function Today() {
  const navigate = useNavigate();
  const { plan } = usePlan();
  const due = FOLLOWUPS_TODAY.filter(f => f.result !== 'missed');
  const limit = DIALS_PER_DAY[plan];

  return (
    <Page>
      <PageHeader eyebrow="Wednesday 1 October" title={`Good evening, ${ME.first}`}
        aside={<span className="text-14 text-muted">Your time 8:14 pm · New York 3:14 pm</span>} />

      <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:gap-[18px]">
        <DarkCard as="section" aria-label="Ready to call">
          <DarkEyebrow>READY TO CALL</DarkEyebrow>
          <div className="mt-2 text-26 font-extrabold tracking-[-0.03em] sm:text-30">October leads</div>
          <div className="mt-0.5 text-15 text-zinc-400">37 left · script: Office cleaning v2</div>
          <div className="mt-[22px] flex flex-wrap gap-2.5">
            <Button variant="primary" size="lg" className="px-[26px]" onClick={() => navigate('/call')}><Icon name="call" />Start calling</Button>
            <Link to="/leads" className={buttonClass({ variant: 'glass', size: 'lg' })}>Pick a list</Link>
          </div>
        </DarkCard>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Dials today" value="0" suffix={limit ? `/${limit}` : undefined} />
          <Stat label="Talk time" value="0m" />
          <Stat label="Spent today" value="$0.00" />
          <Stat label="Follow-ups due" value={due.length} />
        </div>
      </div>

      <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:gap-[18px]">
        <Card as="section">
          <CardHead title="Follow-ups due today"><Link className={cn(linkClass, 'text-14')} to="/followups">See all</Link></CardHead>
          {due.map(f => (
            <div key={f.lead.id} className="flex items-center gap-3 border-t border-line py-3">
              <Person initials={f.lead.initials} tone={f.lead.tone} size={36} name={f.lead.name} sub={`${f.lead.company} · ${f.when}`} className="flex-1" />
              <Pill tone={RESULT_TONE[f.result]}>{RESULT_LABEL[f.result]}</Pill>
              <button type="button" aria-label={`Call ${f.lead.name}`} onClick={() => navigate(`/call/${f.lead.id}`)}
                className="flex size-9 cursor-pointer items-center justify-center rounded-full border-0 bg-brand-soft text-brand-ink hover:bg-brand hover:text-on-brand">
                <Icon name="call" size={16} />
              </button>
            </div>
          ))}
        </Card>
        <div className="flex flex-col gap-3.5">
          <Card as="section">
            <b className="text-17">Yesterday</b>
            <Kpis className="mt-3.5" items={[
              { label: 'Calls', value: 86 }, { label: 'Talked', value: '1h 52m' },
              { label: 'Interested', value: 6, good: true }, { label: 'Spent', value: '$2.24' },
            ]} />
          </Card>
          <Link to="/settings" className="flex items-center gap-3 rounded-3xl border border-line bg-surface p-[18px] text-ink no-underline">
            <Tile tone="brand"><Icon name="phone" /></Tile>
            <div className="flex-1"><b className="text-15">3 numbers</b><p className="text-13 text-muted">New York, Chicago, Toronto · $4.50 a month</p></div>
          </Link>
        </div>
      </div>
    </Page>
  );
}
