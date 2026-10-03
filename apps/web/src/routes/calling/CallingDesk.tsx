import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Avatar, Button, CallCard, CallDevice, CallFacts, CallStatus, CallTimer, ChoiceCard, Chip, Dot, Facts, Icon, Kbd, Merge, Note,
  OutcomeTile, Paper, Pill, Progress, Radio, ScriptText, Tile, Toggle, buttonClass, cn,
} from '@dialer/ui';
import { ProblemCard } from './CallAlerts';
import { NextLeadPopover, peekAt } from './NextLead';
import { PairDialog } from './Pairing';
import { OUTCOMES, WHEN, type CallSession } from './useCallSession';
import { isProblem } from '@/lib/sim';
import { BALANCE, DETAILS, RESULT_LABEL } from '@/lib/fake';
import { formatUsd, formatUsd3 } from '@/lib/money';
import { formatRate } from '@/lib/pricing';
import { SCRIPT_NAME, SCRIPT_PARTS, renderScript } from '@/lib/script';

const ORDINAL = ['', '1st', '2nd', '3rd'];
const label = 'text-12 font-medium tracking-[.02em] text-muted';

/** Laptop and tablet layout: queue, lead and script, call panel side by side from 1280px. */
export default function CallingDesk({ s }: { s: CallSession }) {
  const {
    plan, free, sim, via, phoneLinked, setTalkVia, canStart, queue, current, setCurrent, lead, detail, merge, left, dials, limit, made,
    phase, setPhase, live, seconds, cost, clock, muted, setMuted, outcome, setOutcome, when, setWhen, scriptSize, setScriptSize,
    scriptLocked, setUpgrade, peek, setPeek, nextPick, setNextPick, multiDial, setMultiDial, pauseAfter, setPauseAfter, nextOpen, start, hangUp, skip, fixProblem,
  } = s;

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

  const [queueOpen, setQueueOpen] = useState(true);
  if (!lead || !detail || !merge) return null;

  return (
    <div className={cn('flex flex-col gap-3.5 bg-sunk p-4 sm:p-6 xl:grid xl:h-full xl:min-h-0 xl:gap-0 xl:bg-surface xl:p-0',
      queueOpen ? 'xl:grid-cols-[288px_minmax(0,1fr)_380px]' : 'xl:grid-cols-[64px_minmax(0,1fr)_380px]')}>
      {!queueOpen ? (
        <aside className="flex flex-col items-center gap-2 border-line py-4 max-xl:order-4 max-xl:flex-row max-xl:rounded-xl max-xl:border max-xl:bg-surface max-xl:px-3 xl:border-r" aria-label="Queue">
          <button type="button" aria-label="Open queue" aria-expanded={false} onClick={() => setQueueOpen(true)}
            className="mb-1 flex size-9 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent text-muted hover:bg-sunk hover:text-ink">
            <Icon name="panel" />
          </button>
          {queue.slice(0, 7).map((q, i) => (
            <span key={q.lead.id} title={q.lead.name} className={cn(q.done && 'opacity-50')}>
              <Avatar initials={q.lead.initials} tone={i === current ? 'brand' : 'plain'} size={32} className="text-12 font-semibold" />
            </span>
          ))}
          <span className="text-12 font-semibold text-muted">+{Math.max(0, left - 7)}</span>
        </aside>
      ) : (
      <aside className="flex flex-col gap-0.5 border-line px-3 py-4 max-xl:order-4 max-xl:rounded-xl max-xl:border max-xl:bg-surface xl:overflow-auto xl:border-r" aria-label="Queue">
        <div className="flex items-center gap-2 pb-3 pl-3 pr-1 pt-1">
          <span className={cn(label, 'flex-1')}>{free ? 'YOUR LEADS' : 'UP NEXT'} <span className="font-normal">{left} {free ? 'to call' : 'left'}</span></span>
          <button type="button" aria-label="Close queue" aria-expanded onClick={() => setQueueOpen(false)}
            className="flex size-9 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent text-muted hover:bg-sunk hover:text-ink">
            <Icon name="panel" />
          </button>
        </div>
        {queue.map((q, i) => {
          const isCurrent = i === current;
          const d = DETAILS[q.lead.id];
          const sub = q.done ?? (isCurrent
            ? (live ? 'On call now' : `${free ? 'Selected' : 'Up first'} · ${d?.localTime ?? ''}`)
            : nextPick === i ? 'Next up' : `${q.lead.company} · ${d?.localTime ?? ''}`);
          return (
            <button key={q.lead.id} type="button" aria-current={isCurrent || undefined} aria-expanded={live && !free && !isCurrent ? peek?.index === i : undefined}
              disabled={Boolean(q.done) || (live && (free || isCurrent))}
              onClick={e => {
                if (!live) { setCurrent(i); return; }
                const row = e.currentTarget;
                setPeek(p => (p?.index === i ? null : peekAt(i, row)));
              }}
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
        {plan === 'pro' ? (
          <div className="mb-2 flex flex-col gap-2.5 rounded-xl border border-line bg-surface p-3.5">
            <div className="flex items-center gap-2 text-14">
              <Icon name="call" size={16} className="text-brand-ink" />
              <b className="flex-1">Dial 2 at once</b>
              <Toggle checked={multiDial} onChange={setMultiDial} label="Dial 2 at once" />
            </div>
            <div className="flex justify-between text-13"><span className="text-muted">No daily limit</span><b className="tabular-nums">{38 + made} of 60 included</b></div>
            <Progress value={((38 + made) / 60) * 100} label="Multi-dial minutes" />
          </div>
        ) : (
          <div className="flex flex-col gap-2 p-3">
            <div className="flex justify-between text-13"><span className="text-muted">Dials today</span><b className="tabular-nums">{limit ? `${dials} of ${limit}` : `${dials}`}</b></div>
            <Progress value={limit ? (dials / limit) * 100 : 0} label="Dials today" />
          </div>
        )}
        {free ? (
          <button type="button" onClick={() => setUpgrade({ to: 'starter', reason: 'Auto-dial your list with Starter' })}
            className="flex cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-sunk px-3.5 py-3 text-left text-13 text-ink">
            <Icon name="lock" size={14} className="text-muted" />
            <span className="flex-1"><b className="block font-semibold">Auto-dial the list</b><span className="text-muted">Calls one after another for you</span></span>
            <Pill tone="brand">Starter</Pill>
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button aria-pressed={pauseAfter} onClick={() => setPauseAfter(v => !v)}><Icon name={pauseAfter ? 'play' : 'pause'} size={16} />{pauseAfter ? 'Paused' : 'Pause'}</Button>
            <Button onClick={() => { if (live) return; const n = nextOpen(current); if (n >= 0) setCurrent(n); }}>
              <Icon name="skip" size={16} />Skip
            </Button>
          </div>
        )}
      </aside>
      )}

      <main className="max-xl:contents xl:flex xl:min-h-0 xl:flex-col xl:gap-4 xl:overflow-hidden xl:bg-sunk xl:px-8 xl:py-6">
        <section aria-label="Lead" className="flex flex-col gap-4 rounded-xl border border-line bg-surface px-4 py-4 shadow-card max-xl:order-1 sm:px-[22px] sm:py-5">
          <div className="flex flex-wrap items-center gap-3.5">
            <Avatar initials={lead.initials} tone={lead.tone} size={52} />
            <div className="min-w-[150px] flex-1">
              <h1 className="text-22 font-semibold tracking-[-0.03em] sm:text-26">{lead.name}</h1>
              <p className="pt-0.5 text-13 text-muted">{detail.title}, {lead.company}</p>
            </div>
            {detail.lastCall && <Pill tone="success"><Icon name="up" size={14} />{RESULT_LABEL[detail.lastCall.result]} last time</Pill>}
            <Pill>{ORDINAL[detail.attempt] ?? `${detail.attempt}th`} call</Pill>
            {plan === 'pro' && <Pill tone="lemon"><Icon name="spark" size={14} />Summary on</Pill>}
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
            <div className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-md bg-warn-soft px-3.5 py-3 text-14 sm:flex-nowrap">
              <Icon name="history" size={16} className="mt-0.5 text-warn-ink" />
              <b className="whitespace-nowrap text-12 leading-5 font-medium text-warn-ink">Last call, {detail.lastCall.date}</b>
              <span>{detail.lastCall.note}</span>
            </div>
          )}
        </section>

        <Paper className="max-xl:order-3 max-xl:after:hidden xl:min-h-0 xl:flex-1">
          <div className="mb-[18px] flex flex-wrap items-center gap-1.5">
            <span className={cn(label, 'flex-1')}>YOUR SCRIPT · {SCRIPT_NAME.toUpperCase()}</span>
            {free && (scriptLocked ? <Pill><Icon name="lock" size={13} />Starter</Pill> : <Pill tone="brand">Free until 1 Dec</Pill>)}
            <Link to="/scripts" className={buttonClass({ variant: 'quiet', size: 'sm' })}>Edit</Link>
            <button type="button" aria-label="Smaller text" onClick={() => setScriptSize(s => Math.max(16, s - 2))} className="size-9 cursor-pointer rounded-sm border-0 bg-transparent text-13 text-muted hover:bg-sunk">A-</button>
            <button type="button" aria-label="Bigger text" onClick={() => setScriptSize(s => Math.min(28, s + 2))} className="size-9 cursor-pointer rounded-sm border-0 bg-transparent text-13 text-muted hover:bg-sunk">A+</button>
          </div>
          <div className="relative">
            <ScriptText size={scriptSize} className={cn(scriptLocked && 'pointer-events-none select-none blur-[6px]')}>
              <div aria-hidden={scriptLocked || undefined}>
                {SCRIPT_PARTS.map(p => (
                  <div key={p.title}>
                    <h4>{p.title}</h4>
                    <p>{renderScript(p.body, t => <Merge>{merge[t]}</Merge>)}</p>
                  </div>
                ))}
              </div>
            </ScriptText>
            {scriptLocked && (
              <div className="absolute inset-x-0 top-6 mx-auto flex max-w-[420px] flex-col items-center gap-2 rounded-2xl border border-line bg-surface px-6 py-5 text-center shadow-[0_16px_40px_rgba(0,0,0,.12)]">
                <Tile tone="brand"><Icon name="lock" /></Tile>
                <b className="text-18">Your script is now a Starter feature</b>
                <p className="text-13 text-muted">Your 2 free months of script on screen ended on 1 Dec. You can keep calling on Free. To see your script while you call, move to Starter.</p>
                {live
                  ? <b className="text-13 text-brand-ink">You can move to Starter from Plans after this call.</b>
                  : <Button variant="primary" onClick={() => setUpgrade({ to: 'starter', reason: 'See your script while you call' })}>See Starter</Button>}
              </div>
            )}
          </div>
        </Paper>
      </main>

      <section className="flex flex-col gap-3.5 max-xl:order-2 xl:overflow-auto xl:border-l xl:border-line xl:p-5" aria-label="Call">
        {isProblem(sim) ? (
          <ProblemCard problem={sim} timer={clock} lead={merge.first_name} canUsePhone={!free} onFix={fixProblem} />
        ) : (
        <CallCard>
          <div className="flex items-center justify-between">
            <CallStatus live={live} />
            {!live && <span className="text-12 text-zinc-400">US rate {formatRate(plan)} / min</span>}
            {live && plan === 'pro' && <span className="inline-flex items-center gap-1.5 text-12 text-zinc-400"><i className="size-[7px] rounded-full bg-danger" />Recording{via === 'phone' ? ' · on your phone' : ''}</span>}
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
        )}

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
                <div className="flex flex-wrap gap-1.5">
                  {WHEN.map(w => <Chip key={w} pressed={when === w} className="px-3" onClick={() => setWhen(w)}>{w}</Chip>)}
                  <label className={cn('relative inline-flex h-10 flex-none cursor-pointer items-center gap-1.5 rounded-full border border-transparent bg-sunk px-3 text-14 font-medium',
                    !(WHEN as readonly string[]).includes(when) && 'border-brand bg-brand-soft text-brand-ink')}>
                    <Icon name="callback" size={16} />
                    {!(WHEN as readonly string[]).includes(when) && when}
                    <input type="date" aria-label="Pick a date" className="absolute inset-0 cursor-pointer opacity-0"
                      onChange={e => { const d = e.target.valueAsDate; if (d) setWhen(d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })); }} />
                  </label>
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
              <ChoiceCard checked={via === 'phone'} locked={free} onClick={() => (free ? setUpgrade({ to: 'starter', reason: 'Talk on your phone with Starter' }) : setTalkVia('phone'))}>
                <Tile tone="brand" size={36}><Icon name="phone" /></Tile>
                <span><b className="block text-14 font-semibold">Use my phone to talk</b><span className="block text-12 text-muted">Your phone is the mic and speaker. You watch the script here. No phone minutes used</span></span>
                {free ? <Pill tone="brand" className="ml-auto flex-none"><Icon name="lock" size={14} />Starter</Pill> : <Radio />}
              </ChoiceCard>
            </div>
            {free && (
              <Note>
                <Icon name="lock" size={14} />
                <span className="flex-1 text-13">Talking on your phone while you read here comes with Starter.</span>
                <Button variant="outline" className="h-[34px]" onClick={() => setUpgrade({ to: 'starter', reason: 'Talk on your phone with Starter' })}>See Starter</Button>
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
            <span className="flex-1 max-xl:hidden" />
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

      <PairDialog open={phase === 'pairing'} onCancel={() => setPhase('ready')} onChange={() => { setTalkVia('computer'); setPhase('ready'); }} />
      {peek && queue[peek.index] && (
        <NextLeadPopover peek={peek} lead={queue[peek.index]!.lead} onClose={() => setPeek(null)}
          onSkip={() => { skip(peek.index); setPeek(null); }}
          onCallNext={() => { setNextPick(peek.index); setPeek(null); }} />
      )}
    </div>
  );
}
