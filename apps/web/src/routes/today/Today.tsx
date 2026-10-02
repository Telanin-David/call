import { Link, useNavigate } from 'react-router-dom';
import { usePlan, type Plan } from '@/lib/plan';
import { FOLLOWUPS_TODAY, ME, RESULT_LABEL, RESULT_PILL } from '@/lib/fake';
import Icon from '@/components/Icon';
import Avatar from '@/components/Avatar';

const DIAL_LIMIT: Record<Plan, string> = { free: '/30', starter: '/120', pro: '' };

export default function Today() {
  const navigate = useNavigate();
  const { plan } = usePlan();
  const due = FOLLOWUPS_TODAY.filter(f => f.result !== 'missed');

  return (
    <div className="dl-wrap">
      <div className="dl-pagehead">
        <div className="dl-grow">
          <div className="dl-eyebrow">Wednesday 1 October</div>
          <h1 className="dl-h1">Good evening, {ME.first}</h1>
        </div>
        <span className="dl-aside-note">Your time 8:14 pm · New York 3:14 pm</span>
      </div>

      <div className="dl-grid-hero">
        <section className="dl-hero" aria-label="Ready to call">
          <div className="dl-hero-eyebrow">READY TO CALL</div>
          <div className="dl-hero-title">October leads</div>
          <div className="dl-hero-sub">37 left · script: Office cleaning v2</div>
          <div className="dl-hero-acts">
            <button className="dl-btn dl-btn--primary dl-btn--lg dl-btn--wide" onClick={() => navigate('/call')}>
              <Icon name="i-call" />Start calling
            </button>
            <Link to="/leads" className="dl-btn dl-btn--lg dl-btn--glass">Pick a list</Link>
          </div>
        </section>
        <div className="dl-stats">
          <div className="dl-stat"><span>Dials today</span><b>0<small>{DIAL_LIMIT[plan]}</small></b></div>
          <div className="dl-stat"><span>Talk time</span><b>0m</b></div>
          <div className="dl-stat"><span>Spent today</span><b>$0.00</b></div>
          <div className="dl-stat"><span>Follow-ups due</span><b>{due.length}</b></div>
        </div>
      </div>

      <div className="dl-grid-hero dl-grid-hero--top">
        <section className="dl-panel">
          <div className="dl-panel-head">
            <b>Follow-ups due today</b>
            <Link className="dl-link" to="/followups">See all</Link>
          </div>
          {due.map(f => (
            <div key={f.lead.id} className="dl-person">
              <Avatar lead={f.lead} size={36} />
              <div className="dl-who dl-grow">
                <div><b>{f.lead.name}</b><p>{f.lead.company} · {f.when}</p></div>
              </div>
              <span className={RESULT_PILL[f.result]}>{RESULT_LABEL[f.result]}</span>
              <button className="dl-iconbtn dl-callbtn" aria-label={`Call ${f.lead.name}`} onClick={() => navigate(`/call/${f.lead.id}`)}>
                <Icon name="i-call" size={16} />
              </button>
            </div>
          ))}
        </section>
        <div className="dl-stack">
          <section className="dl-panel">
            <b className="dl-heading">Yesterday</b>
            <div className="dl-kpis">
              <div>Calls<b>86</b></div>
              <div>Talked<b>1h 52m</b></div>
              <div>Interested<b className="is-good">6</b></div>
              <div>Spent<b>$2.24</b></div>
            </div>
          </section>
          <Link to="/settings" className="dl-panel dl-panel--tight dl-rowhead dl-plainlink">
            <span className="dl-tile t-orange"><Icon name="i-phone" /></span>
            <div className="dl-grow"><b>3 numbers</b><p>New York, Chicago, Toronto · $4.50 a month</p></div>
          </Link>
        </div>
      </div>
    </div>
  );
}
