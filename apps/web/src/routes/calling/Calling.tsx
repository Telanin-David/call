import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { usePlan } from '@/lib/plan';
import { useCallStore, useDeviceStore } from '@/lib/store';
import { BALANCE, DETAILS, QUEUE, RESULT_LABEL, type QueueItem } from '@/lib/fake';
import { formatUsd, formatUsd3 } from '@/lib/money';
import { DIALS_PER_DAY, RATE_PER_MIN, formatRate } from '@/lib/pricing';
import { SCRIPT_NAME, SCRIPT_PARTS, renderScript, type MergeValues } from '@/lib/script';
import Icon, { type IconName } from '@/components/Icon';

type Phase = 'ready' | 'pairing' | 'live';
type Outcome = 'interested' | 'callback' | 'not_interested' | 'no_answer' | 'wrong' | 'dnc';

const OUTCOMES: { key: Outcome; label: string; icon: IconName; tone: string }[] = [
  { key: 'interested', label: 'Interested', icon: 'i-up', tone: 't-mint' },
  { key: 'callback', label: 'Call back', icon: 'i-callback', tone: 't-orange' },
  { key: 'not_interested', label: 'Not interested', icon: 'i-down', tone: 't-grey' },
  { key: 'no_answer', label: 'No answer', icon: 'i-missed', tone: 't-lemon' },
  { key: 'wrong', label: 'Wrong number', icon: 'i-wrong', tone: 't-grey' },
  { key: 'dnc', label: 'Do not call', icon: 'i-ban', tone: 't-red' },
];

const WHEN = ['Tomorrow', 'In 3 days', 'Next week'] as const;
const ORDINAL = ['', '1st', '2nd', '3rd'];
const FIRST_OPEN = QUEUE.findIndex(q => !q.done);

const pad = (n: number) => String(n).padStart(2, '0');

export default function Calling() {
  const { plan } = usePlan();
  const free = plan === 'free';
  const { leadId } = useParams();
  const { talkVia, phoneLinked, setTalkVia, setPhoneLinked } = useDeviceStore();
  const setCallStatus = useCallStore(s => s.setStatus);

  const [queue, setQueue] = useState<QueueItem[]>(QUEUE);
  const [current, setCurrent] = useState(() => {
    const i = QUEUE.findIndex(q => q.lead.id === leadId && !q.done);
    return i >= 0 ? i : FIRST_OPEN;
  });
  const [phase, setPhase] = useState<Phase>('ready');
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [when, setWhen] = useState<(typeof WHEN)[number]>('Tomorrow');
  const [made, setMade] = useState(0);
  const [scriptSize, setScriptSize] = useState(20);

  const via = free ? 'computer' : talkVia;
  const canStart = via === 'computer' || (via === 'phone' && phoneLinked);
  const item = queue[current];
  const lead = item?.lead;
  const detail = lead ? DETAILS[lead.id] : undefined;
  const left = 42 - queue.filter(q => q.done).length;
  const dials = (free ? 0 : 86) + made;
  const limit = DIALS_PER_DAY[plan];

  useEffect(() => {
    if (phase !== 'live') return;
    const t = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'pairing') return;
    const t = setTimeout(() => { setPhoneLinked(true); setPhase('ready'); }, 2500);
    return () => clearTimeout(t);
  }, [phase, setPhoneLinked]);

  useEffect(() => () => setCallStatus('idle'), [setCallStatus]);

  function start() {
    if (!canStart || !lead) return;
    setPhase('live');
    setSeconds(0);
    setOutcome(null);
    setMade(m => m + 1);
    setCallStatus('answered');
  }

  function hangUp() {
    const label = outcome === 'callback'
      ? `Call back ${when.toLowerCase()}`
      : outcome ? (OUTCOMES.find(o => o.key === outcome)?.label ?? '') : RESULT_LABEL.no_answer;
    const next = queue.map((q, i) => (i === current ? { ...q, done: label } : q));
    setQueue(next);
    setPhase('ready');
    setMuted(false);
    setCallStatus('idle');
    const n = next.findIndex(q => !q.done);
    if (n >= 0) setCurrent(n);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) return;
      const k = e.key.toLowerCase();
      if (phase === 'ready' && k === 'p') start();
      if (phase !== 'live') return;
      if (k === 'm') setMuted(m => !m);
      if (k === 'h') hangUp();
      const n = Number(k);
      const o = OUTCOMES[n - 1];
      if (n >= 1 && n <= 6 && o) setOutcome(o.key);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!lead || !detail) {
    return <div className="dl-empty">Your list is done. Pick another list on the Leads page.</div>;
  }

  const merge: MergeValues = {
    first_name: lead.name.split(' ')[0] ?? lead.name,
    company: lead.company,
    city: detail.location.split(',')[0] ?? detail.location,
    her_time: detail.localTime,
  };
  const live = phase === 'live';
  const cost = Math.round((RATE_PER_MIN[plan] * seconds) / 60);

  return (
    <div className="dl-call">
      <aside className="dl-queue" aria-label="Queue">
        <div className="dl-queue-head">
          <span className="dl-label dl-grow">{free ? 'YOUR LEADS' : 'UP NEXT'} <span className="dl-muted">{left} {free ? 'to call' : 'left'}</span></span>
          <button className="dl-iconbtn" aria-label="Close queue"><Icon name="i-panel" /></button>
        </div>
        {queue.map((q, i) => {
          const isCurrent = i === current;
          const d = DETAILS[q.lead.id];
          const sub = q.done ?? (isCurrent
            ? (live ? 'On call now' : `${free ? 'Selected' : 'Up first'} · ${d?.localTime ?? ''}`)
            : `${q.lead.company} · ${d?.localTime ?? ''}`);
          return (
            <button key={q.lead.id} className={`dl-q2${q.done ? ' is-done' : ''}${isCurrent ? ' is-current' : ''}`}
              disabled={live || Boolean(q.done)} onClick={() => setCurrent(i)}>
              <span className={`av${isCurrent ? '' : ` dl-av-${q.lead.tone}`}`}>{q.lead.initials}</span>
              <div className="dl-grow"><div className="nm">{q.lead.name}</div><div className="sm">{sub}</div></div>
              {isCurrent && <span className="dl-dot dl-dot--ok" />}
              {free && !isCurrent && !q.done && <span className="dl-q2-call" aria-hidden="true"><Icon name="i-call" size={14} /></span>}
            </button>
          );
        })}
        <span className="dl-push" />
        <div className="dl-meter">
          <div className="dl-meter-row"><span className="dl-muted">Dials today</span><b className="dl-num">{limit ? `${dials} of ${limit}` : `${dials}`}</b></div>
          <div className="dl-progress"><span style={{ width: `${limit ? Math.min(100, Math.round((dials / limit) * 100)) : 0}%` }} /></div>
        </div>
        {free ? (
          <Link to="/plans" className="dl-upsell dl-plainlink">
            <Icon name="i-lock" size={14} />
            <span className="dl-grow"><b>Auto-dial the list</b><p>Calls one after another for you</p></span>
            <span className="dl-pill dl-pill--brand">Starter</span>
          </Link>
        ) : (
          <div className="dl-queue-acts">
            <button className="dl-btn"><Icon name="i-pause" size={16} />Pause</button>
            <button className="dl-btn" onClick={() => { if (live) return; const n = queue.findIndex((q, i) => i > current && !q.done); if (n >= 0) setCurrent(n); }}>
              <Icon name="i-skip" size={16} />Skip
            </button>
          </div>
        )}
      </aside>

      <main className="dl-call-main">
        <section className="dl-card dl-leadcard" aria-label="Lead">
          <div className="dl-leadhead">
            <span className={`dl-avlg dl-avlg--52 dl-av-${lead.tone}`}>{lead.initials}</span>
            <div className="dl-grow">
              <h1 className="dl-lead-name dl-lead-name--26">{lead.name}</h1>
              <p className="dl-muted dl-small">{detail.title}, {lead.company}</p>
            </div>
            {detail.lastCall && <span className="dl-pill dl-pill--success"><Icon name="i-up" size={14} />{RESULT_LABEL[detail.lastCall.result]} last time</span>}
            <span className="dl-pill">{ORDINAL[detail.attempt] ?? `${detail.attempt}th`} call</span>
          </div>
          <div className="dl-facts">
            <div className="dl-fact"><span><Icon name="i-call" size={16} />Phone</span><b>{detail.phone}</b></div>
            <div className="dl-fact"><span><Icon name="i-mail" size={16} />Email</span><b>{detail.email}</b></div>
            <div className="dl-fact"><span><Icon name="i-pin" size={16} />Location</span><b>{detail.location}</b></div>
            <div className="dl-fact"><span><Icon name="i-building" size={16} />Company</span><b>{detail.companyNote}</b></div>
            <div className="dl-fact"><span><Icon name="i-globe" size={16} />Website</span><b>{detail.website}</b></div>
            <div className="dl-fact"><span><Icon name="i-list" size={16} />List</span><b>October leads</b></div>
          </div>
          {detail.lastCall && (
            <div className="dl-conclusion dl-conclusion--warn">
              <Icon name="i-history" size={16} /><b>Last call, {detail.lastCall.date}</b><span>{detail.lastCall.note}</span>
            </div>
          )}
        </section>

        <section className="dl-paper dl-paper--fill" aria-label="Script">
          <div className="dl-paper-head">
            <span className="dl-label dl-grow">YOUR SCRIPT · {SCRIPT_NAME.toUpperCase()}</span>
            {free && <span className="dl-pill dl-pill--brand">Free until 1 Dec</span>}
            <Link to="/scripts" className="dl-btn dl-btn--quiet dl-btn--32">Edit</Link>
            <button className="dl-iconbtn" aria-label="Smaller text" onClick={() => setScriptSize(s => Math.max(16, s - 2))}>A-</button>
            <button className="dl-iconbtn" aria-label="Bigger text" onClick={() => setScriptSize(s => Math.min(28, s + 2))}>A+</button>
          </div>
          <div className="dl-sc" style={{ fontSize: scriptSize, lineHeight: `${Math.round(scriptSize * 1.6)}px` }}>
            {SCRIPT_PARTS.map(p => (
              <div key={p.title}>
                <h4>{p.title}</h4>
                <p>{renderScript(p.body, t => <span className="dl-merge">{merge[t]}</span>)}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <section className="dl-callpanel" aria-label="Call">
        <div className="dl-callcard">
          <div className="dl-callcard-top">
            {live
              ? <span className="lv"><span className="dl-dot dl-dot--ok dl-dot--pulse" />CONNECTED</span>
              : <span className="lv is-idle">READY</span>}
            {!live && <span className="rec">US rate {formatRate(plan)} / min</span>}
            {live && plan === 'pro' && <span className="rec"><i />Recording</span>}
            {live && plan !== 'pro' && <span className="rec"><Icon name="i-lock" size={13} />Not recorded · Pro</span>}
          </div>
          <div className={`tm${live ? '' : ' is-idle'}`}>{pad(Math.floor(seconds / 60))}:{pad(seconds % 60)}</div>
          <div className="row">
            <div><span>{lead.pronoun === 'her' ? 'Her' : 'His'} time</span><b>{detail.localTime}</b></div>
            <div><span>Your time</span><b>8:14 pm</b></div>
            {live
              ? <div className="hot"><span>This call</span><b>{formatUsd3(cost)}</b></div>
              : <div><span>Balance</span><b>{formatUsd(BALANCE)}</b></div>}
          </div>
          {live && (via === 'phone' ? (
            <div className="dev">
              <span className="ico"><Icon name="i-phone" /></span>
              <div><b>Your phone</b><span>Mic and speaker · Pixel 6a</span></div>
              <span className="bat">64%</span>
            </div>
          ) : (
            <div className="dev">
              <span className="ico"><Icon name="i-headset" /></span>
              <div><b>This laptop</b><span>Headset plugged into the jack</span></div>
            </div>
          ))}
        </div>

        {live ? (
          <>
            <div className="dl-callacts">
              <button className="dl-btn dl-btn--lg dl-btn--outline" aria-pressed={muted} onClick={() => setMuted(m => !m)}>
                <Icon name={muted ? 'i-micoff' : 'i-mic'} />{muted ? 'Unmute' : 'Mute'}<span className="dl-kbd">M</span>
              </button>
              <button className="dl-btn dl-btn--lg dl-btn--danger" onClick={hangUp}><Icon name="i-hangup" />Hang up<span className="dl-kbd">H</span></button>
            </div>
            <span className="dl-label dl-mt4">HOW DID IT GO? <span>Keys 1 to 6</span></span>
            <div className="dl-otiles">
              {OUTCOMES.map(o => (
                <button key={o.key} className="dl-otile" aria-pressed={outcome === o.key} onClick={() => setOutcome(o.key)}>
                  <span className={`t ${o.tone}`}><Icon name={o.icon} /></span>{o.label}
                </button>
              ))}
            </div>
            {outcome === 'callback' && (
              <>
                <span className="dl-label dl-mt2">CALL BACK WHEN?</span>
                <div className="dl-chiprow dl-chiprow--nowrap">
                  {WHEN.map(w => <button key={w} className="dl-chip" aria-pressed={when === w} onClick={() => setWhen(w)}>{w}</button>)}
                  <button className="dl-chip dl-chip--icon" aria-label="Pick a date"><Icon name="i-callback" size={16} /></button>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <span className="dl-label dl-mt6">HOW WILL YOU TALK?</span>
            <div className="dl-how" role="radiogroup" aria-label="How will you talk">
              <button className="dl-choice" role="radio" aria-checked={via === 'computer'} onClick={() => setTalkVia('computer')}>
                <span className="dl-tile t-grey"><Icon name="i-laptop" /></span>
                <span><b className="dl-choice-title">On this computer</b><span className="dl-mini">Use this laptop's mic and speakers, or plug in a headset</span></span>
                <span className="dl-radio" />
              </button>
              <button className={`dl-choice${free ? ' is-locked' : ''}`} role="radio" aria-checked={via === 'phone'} aria-disabled={free}
                onClick={() => !free && setTalkVia('phone')}>
                <span className="dl-tile t-orange"><Icon name="i-phone" /></span>
                <span><b className="dl-choice-title">Use my phone to talk</b><span className="dl-mini">Your phone is the mic and speaker. You watch the script here. No phone minutes used</span></span>
                {free ? <span className="dl-pill dl-pill--brand"><Icon name="i-lock" size={14} />Starter</span> : <span className="dl-radio" />}
              </button>
            </div>
            {free && (
              <div className="dl-callnote dl-callnote--grey">
                <Icon name="i-lock" size={14} />
                <span className="dl-small dl-grow">Talking on your phone while you read here comes with Starter.</span>
                <Link to="/plans" className="dl-btn dl-btn--outline dl-btn--34">See Starter</Link>
              </div>
            )}
            {!free && via === 'phone' && !phoneLinked && (
              <div className="dl-callnote">
                <Icon name="i-qr" />
                {phase === 'pairing'
                  ? <span className="dl-small dl-grow">Waiting for your phone to scan</span>
                  : <><span className="dl-small dl-grow">Your phone isn't connected yet</span>
                    <button className="dl-btn dl-btn--outline dl-btn--34" onClick={() => setPhase('pairing')}>Scan code</button></>}
              </div>
            )}
            <span className="dl-push" />
            <button className="dl-btn dl-btn--primary dl-btn--lg dl-btn--block" aria-disabled={!canStart} onClick={start}>
              <Icon name="i-call" />{free ? `Call ${merge.first_name}` : 'Start calling'}{!free && <span className="dl-kbd">P</span>}
            </button>
            <p className="dl-mini dl-center">
              {free ? 'On Free you call one lead at a time and pick who is next.'
                : canStart ? 'Calls go out one after another. Pause any time.' : 'Starts once your phone is connected'}
            </p>
          </>
        )}
      </section>
    </div>
  );
}
