import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Avatar, Button, CallCard, CallDevice, CallFacts, CallStatus, CallTimer, ChoiceCard, Chip, Dot, Facts, Icon, Kbd, Merge, Note,
  OutcomeTile, Paper, Pill, Progress, Radio, ScriptText, Tile, buttonClass, cn, type IconName, type OutcomeTone,
} from '@dialer/ui';
import { usePlan } from '@/lib/plan';
import { useCallStore, useDeviceStore } from '@/lib/store';
import { BALANCE, DETAILS, QUEUE, RESULT_LABEL, type QueueItem } from '@/lib/fake';
import { formatUsd, formatUsd3 } from '@/lib/money';
import { DIALS_PER_DAY, RATE_PER_MIN, formatRate } from '@/lib/pricing';
import { SCRIPT_NAME, SCRIPT_PARTS, renderScript, type MergeValues } from '@/lib/script';

type Phase = 'ready' | 'pairing' | 'live';
type Outcome = 'interested' | 'callback' | 'not_interested' | 'no_answer' | 'wrong' | 'dnc';

const OUTCOMES: { key: Outcome; label: string; icon: IconName; tone: OutcomeTone }[] = [
  { key: 'interested', label: 'Interested', icon: 'up', tone: 'mint' },
  { key: 'callback', label: 'Call back', icon: 'callback', tone: 'orange' },
  { key: 'not_interested', label: 'Not interested', icon: 'down', tone: 'grey' },
  { key: 'no_answer', label: 'No answer', icon: 'missed', tone: 'lemon' },
  { key: 'wrong', label: 'Wrong number', icon: 'wrong', tone: 'grey' },
  { key: 'dnc', label: 'Do not call', icon: 'ban', tone: 'red' },
];

const WHEN = ['Tomorrow', 'In 3 days', 'Next week'] as const;
const ORDINAL = ['', '1st', '2nd', '3rd'];
const FIRST_OPEN = QUEUE.findIndex(q => !q.done);
const label = 'text-12 font-medium tracking-[.02em] text-muted';

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
    return <p className="px-6 py-12 text-center text-muted">Your list is done. Pick another list on the Leads page.</p>;
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
    <div className="grid h-full min-h-0 grid-cols-[288px_minmax(0,1fr)_380px] bg-surface">
      <aside className="flex flex-col gap-0.5 overflow-auto border-r border-line px-3 py-4" aria-label="Queue">
        <div className="flex items-center gap-2 pb-3 pl-3 pr-1 pt-1">
          <span className={cn(label, 'flex-1')}>{free ? 'YOUR LEADS' : 'UP NEXT'} <span className="font-normal">{left} {free ? 'to call' : 'left'}</span></span>
          <button type="button" aria-label="Close queue" className="flex size-9 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent text-muted hover:bg-sunk hover:text-ink">
            <Icon name="panel" />
          </button>
        </div>
        {queue.map((q, i) => {
          const isCurrent = i === current;
          const d = DETAILS[q.lead.id];
          const sub = q.done ?? (isCurrent
            ? (live ? 'On call now' : `${free ? 'Selected' : 'Up first'} · ${d?.localTime ?? ''}`)
            : `${q.lead.company} · ${d?.localTime ?? ''}`);
          return (
            <button key={q.lead.id} type="button" aria-current={isCurrent || undefined} disabled={live || Boolean(q.done)} onClick={() => setCurrent(i)}
              className={cn('flex w-full items-center gap-3 rounded-lg border-0 bg-transparent px-3 py-2.5 text-left',
                isCurrent ? 'bg-brand-soft' : 'enabled:cursor-pointer enabled:hover:bg-sunk')}>
              <Avatar initials={q.lead.initials} tone={isCurrent ? 'brand' : 'plain'} size={32} className="text-12 font-semibold" />
              <div className="min-w-0 flex-1">
                <div className={cn('text-14 font-medium', q.done && 'text-muted')}>{q.lead.name}</div>
                <div className="truncate text-12 text-muted">{sub}</div>
              </div>
              {isCurrent && <Dot tone="ok" />}
              {free && !isCurrent && !q.done && (
                <span aria-hidden="true" className="flex size-[30px] flex-none items-center justify-center rounded-full bg-surface text-brand-ink shadow-[inset_0_0_0_1px_var(--line)]">
                  <Icon name="call" size={14} />
                </span>
              )}
            </button>
          );
        })}
        <span className="flex-1" />
        <div className="flex flex-col gap-2 p-3">
          <div className="flex justify-between text-13"><span className="text-muted">Dials today</span><b className="tabular-nums">{limit ? `${dials} of ${limit}` : `${dials}`}</b></div>
          <Progress value={limit ? (dials / limit) * 100 : 0} label="Dials today" />
        </div>
        {free ? (
          <Link to="/plans" className="flex items-center gap-2.5 rounded-lg bg-sunk px-3.5 py-3 text-13 text-ink no-underline">
            <Icon name="lock" size={14} className="text-muted" />
            <span className="flex-1"><b className="block font-semibold">Auto-dial the list</b><span className="text-muted">Calls one after another for you</span></span>
            <Pill tone="brand">Starter</Pill>
          </Link>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button><Icon name="pause" size={16} />Pause</Button>
            <Button onClick={() => { if (live) return; const n = queue.findIndex((q, i) => i > current && !q.done); if (n >= 0) setCurrent(n); }}>
              <Icon name="skip" size={16} />Skip
            </Button>
          </div>
        )}
      </aside>

      <main className="flex min-h-0 flex-col gap-4 overflow-hidden bg-sunk px-8 py-6">
        <section aria-label="Lead" className="flex flex-col gap-4 rounded-xl border border-line bg-surface px-[22px] py-5 shadow-card">
          <div className="flex items-center gap-3.5">
            <Avatar initials={lead.initials} tone={lead.tone} size={52} />
            <div className="flex-1">
              <h1 className="text-26 font-semibold tracking-[-0.03em]">{lead.name}</h1>
              <p className="pt-0.5 text-13 text-muted">{detail.title}, {lead.company}</p>
            </div>
            {detail.lastCall && <Pill tone="success"><Icon name="up" size={14} />{RESULT_LABEL[detail.lastCall.result]} last time</Pill>}
            <Pill>{ORDINAL[detail.attempt] ?? `${detail.attempt}th`} call</Pill>
          </div>
          <Facts items={[
            { icon: 'call', label: 'Phone', value: detail.phone },
            { icon: 'mail', label: 'Email', value: detail.email },
            { icon: 'pin', label: 'Location', value: detail.location },
            { icon: 'building', label: 'Company', value: detail.companyNote },
            { icon: 'globe', label: 'Website', value: detail.website },
            { icon: 'list', label: 'List', value: 'October leads' },
          ]} />
          {detail.lastCall && (
            <div className="flex items-start gap-3 rounded-md bg-warn-soft px-3.5 py-3 text-14">
              <Icon name="history" size={16} className="mt-0.5 text-warn-ink" />
              <b className="whitespace-nowrap text-12 leading-5 font-medium text-warn-ink">Last call, {detail.lastCall.date}</b>
              <span>{detail.lastCall.note}</span>
            </div>
          )}
        </section>

        <Paper className="min-h-0 flex-1">
          <div className="mb-[18px] flex items-center gap-1.5">
            <span className={cn(label, 'flex-1')}>YOUR SCRIPT · {SCRIPT_NAME.toUpperCase()}</span>
            {free && <Pill tone="brand">Free until 1 Dec</Pill>}
            <Link to="/scripts" className={buttonClass({ variant: 'quiet', size: 'sm' })}>Edit</Link>
            <button type="button" aria-label="Smaller text" onClick={() => setScriptSize(s => Math.max(16, s - 2))} className="size-9 cursor-pointer rounded-sm border-0 bg-transparent text-13 text-muted hover:bg-sunk">A-</button>
            <button type="button" aria-label="Bigger text" onClick={() => setScriptSize(s => Math.min(28, s + 2))} className="size-9 cursor-pointer rounded-sm border-0 bg-transparent text-13 text-muted hover:bg-sunk">A+</button>
          </div>
          <ScriptText size={scriptSize}>
            {SCRIPT_PARTS.map(p => (
              <div key={p.title}>
                <h4>{p.title}</h4>
                <p>{renderScript(p.body, t => <Merge>{merge[t]}</Merge>)}</p>
              </div>
            ))}
          </ScriptText>
        </Paper>
      </main>

      <section className="flex flex-col gap-3.5 overflow-auto border-l border-line p-5" aria-label="Call">
        <CallCard>
          <div className="flex items-center justify-between">
            <CallStatus live={live} />
            {!live && <span className="text-12 text-zinc-400">US rate {formatRate(plan)} / min</span>}
            {live && plan === 'pro' && <span className="inline-flex items-center gap-1.5 text-12 text-zinc-400"><i className="size-[7px] rounded-full bg-[#ef4444]" />Recording</span>}
            {live && plan !== 'pro' && <span className="inline-flex items-center gap-1.5 text-12 text-zinc-400"><Icon name="lock" size={13} />Not recorded · Pro</span>}
          </div>
          <CallTimer seconds={seconds} idle={!live} />
          <CallFacts items={[
            { label: `${lead.pronoun === 'her' ? 'Her' : 'His'} time`, value: detail.localTime },
            { label: 'Your time', value: '8:14 pm' },
            live ? { label: 'This call', value: formatUsd3(cost), hot: true } : { label: 'Balance', value: formatUsd(BALANCE) },
          ]} />
          {live && (via === 'phone'
            ? <CallDevice icon="phone" title="Your phone" sub="Mic and speaker · Pixel 6a" battery="64%" />
            : <CallDevice icon="headset" title="This laptop" sub="Headset plugged into the jack" />)}
        </CallCard>

        {live ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="lg" aria-pressed={muted} onClick={() => setMuted(m => !m)}>
                <Icon name={muted ? 'micoff' : 'mic'} />{muted ? 'Unmute' : 'Mute'}<Kbd onColor={muted}>M</Kbd>
              </Button>
              <Button variant="danger" size="lg" onClick={hangUp}><Icon name="hangup" />Hang up<Kbd onColor>H</Kbd></Button>
            </div>
            <span className={cn(label, 'mt-1')}>HOW DID IT GO? <span className="font-normal">Keys 1 to 6</span></span>
            <div className="grid grid-cols-2 gap-2">
              {OUTCOMES.map(o => (
                <OutcomeTile key={o.key} icon={o.icon} tone={o.tone} pressed={outcome === o.key} onClick={() => setOutcome(o.key)}>{o.label}</OutcomeTile>
              ))}
            </div>
            {outcome === 'callback' && (
              <>
                <span className={cn(label, 'mt-0.5')}>CALL BACK WHEN?</span>
                <div className="flex gap-1.5">
                  {WHEN.map(w => <Chip key={w} pressed={when === w} className="px-3" onClick={() => setWhen(w)}>{w}</Chip>)}
                  <Chip aria-label="Pick a date" className="w-10 flex-none px-0"><Icon name="callback" size={16} /></Chip>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <span className={cn(label, 'mt-1.5')}>HOW WILL YOU TALK?</span>
            <div className="flex flex-col gap-2" role="radiogroup" aria-label="How will you talk">
              <ChoiceCard checked={via === 'computer'} onClick={() => setTalkVia('computer')}>
                <Tile tone="grey" size={36}><Icon name="laptop" /></Tile>
                <span><b className="block text-14 font-semibold">On this computer</b><span className="block text-12 text-muted">Use this laptop's mic and speakers, or plug in a headset</span></span>
                <Radio />
              </ChoiceCard>
              <ChoiceCard checked={via === 'phone'} locked={free} onClick={() => !free && setTalkVia('phone')}>
                <Tile tone="brand" size={36}><Icon name="phone" /></Tile>
                <span><b className="block text-14 font-semibold">Use my phone to talk</b><span className="block text-12 text-muted">Your phone is the mic and speaker. You watch the script here. No phone minutes used</span></span>
                {free ? <Pill tone="brand" className="ml-auto flex-none"><Icon name="lock" size={14} />Starter</Pill> : <Radio />}
              </ChoiceCard>
            </div>
            {free && (
              <Note>
                <Icon name="lock" size={14} />
                <span className="flex-1 text-13">Talking on your phone while you read here comes with Starter.</span>
                <Link to="/plans" className={buttonClass({ variant: 'outline', className: 'h-[34px]' })}>See Starter</Link>
              </Note>
            )}
            {!free && via === 'phone' && !phoneLinked && (
              <Note tone="brand">
                <Icon name="qr" className="text-brand-ink" />
                {phase === 'pairing'
                  ? <span className="flex-1 text-13">Waiting for your phone to scan</span>
                  : <><span className="flex-1 text-13">Your phone isn't connected yet</span>
                    <Button variant="outline" className="h-[34px]" onClick={() => setPhase('pairing')}>Scan code</Button></>}
              </Note>
            )}
            <span className="flex-1" />
            <Button variant="primary" size="lg" block aria-disabled={!canStart} onClick={start}>
              <Icon name="call" />{free ? `Call ${merge.first_name}` : 'Start calling'}{!free && <Kbd onColor>P</Kbd>}
            </Button>
            <p className="text-center text-12 text-muted">
              {free ? 'On Free you call one lead at a time and pick who is next.'
                : canStart ? 'Calls go out one after another. Pause any time.' : 'Starts once your phone is connected'}
            </p>
          </>
        )}
      </section>
    </div>
  );
}
