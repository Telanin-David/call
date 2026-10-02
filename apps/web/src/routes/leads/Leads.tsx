import { useNavigate } from 'react-router-dom';
import Icon from '@/components/Icon';

type Status = 'active' | 'done' | 'new' | 'abroad';

const STATUS: Record<Status, { label: string; pill: string }> = {
  active: { label: 'In use', pill: 'dl-pill dl-pill--brand' },
  done: { label: 'Done', pill: 'dl-pill' },
  new: { label: 'Not started', pill: 'dl-pill dl-pill--warn' },
  abroad: { label: 'Outside US and Canada', pill: 'dl-pill' },
};

const LISTS: { name: string; total: number; called: number; followups: number; script: string; status: Status }[] = [
  { name: 'October leads', total: 42, called: 5, followups: 5, script: 'Office cleaning v2', status: 'active' },
  { name: 'September follow-up list', total: 120, called: 120, followups: 9, script: 'Office cleaning v2', status: 'done' },
  { name: 'Dental offices NY', total: 64, called: 0, followups: 0, script: 'Office cleaning v1', status: 'new' },
  { name: 'UK and Ghana numbers', total: 2, called: 0, followups: 0, script: 'Office cleaning v2', status: 'abroad' },
];

export default function Leads() {
  const navigate = useNavigate();
  return (
    <div className="dl-wrap dl-wrap--wide">
      <div className="dl-pagehead dl-pagehead--12">
        <div className="dl-grow">
          <h1 className="dl-h1">Leads</h1>
          <p className="dl-lede">Your lead lists. Each list uses one script.</p>
        </div>
        <button className="dl-btn dl-btn--outline dl-btn--lg" onClick={() => navigate('/scripts')}><Icon name="i-file" size={17} />Edit scripts</button>
        <button className="dl-btn dl-btn--primary dl-btn--lg" onClick={() => navigate('/leads/upload')}><Icon name="i-upload" size={17} />Upload a list</button>
      </div>

      <div className="dl-list dl-list--leads">
        <div className="dl-list-row dl-list-head"><span>List</span><span>Script</span><span>Progress</span><span>Status</span><span /></div>
        {LISTS.map(l => {
          const left = l.total - l.called;
          return (
            <div key={l.name} className="dl-list-row">
              <div className="dl-who">
                <span className={`dl-tile ${l.status === 'active' ? 't-orange' : 't-grey'}`}><Icon name="i-list" /></span>
                <div><b>{l.name}</b><p>{l.total} leads · {l.followups} follow-ups</p></div>
              </div>
              <span className="dl-note">{l.script}</span>
              <div className="dl-meter2">
                <div><span>{l.called} called</span><b>{left} left</b></div>
                <div className="dl-bar6"><i style={{ width: `${Math.round((l.called / l.total) * 100)}%` }} /></div>
              </div>
              <span className={STATUS[l.status].pill}>{STATUS[l.status].label}</span>
              {l.status === 'done'
                ? <button className="dl-btn dl-btn--outline dl-btn--38">Open</button>
                : <button className="dl-btn dl-btn--primary dl-btn--38" onClick={() => navigate('/call')}>Call list</button>}
            </div>
          );
        })}
      </div>

      <p className="dl-footnote"><Icon name="i-ban" size={15} />Numbers on the do-not-call list are removed when you upload, and you're never charged for them.</p>
    </div>
  );
}
