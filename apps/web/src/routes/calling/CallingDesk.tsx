import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Avatar, Button, CallCard, CallFacts, CallStatus, CallTimer, ChoiceCard, Chip, Dot, Facts, Icon, Kbd, Merge, Note,
  OutcomeTile, Paper, Pill, Progress, Radio, ScriptText, Tile, Toggle, buttonClass, cn,
} from '@dialer/ui';
import { FakePickUpSwitch, ProblemCard } from './CallAlerts';
import { DEV_TOOLS } from '@/lib/devtools';
import { LeadPeek, peekAt, type PeekAction } from './NextLead';
import { PairDialog } from './Pairing';
import { OUTCOMES, WHEN, type CallSession } from './useCallSession';
import { isProblem } from '@/lib/sim';
import { resultLabel } from '@/lib/fake';
import { formatUsd3 } from '@/lib/money';
import { callbackLabel } from '@/lib/calling';
import { callLength } from '@/lib/activity';
import { renderScript } from '@/lib/script';

const ORDINAL = ['', '1st', '2nd', '3rd'];
const label = 'text-12 font-medium tracking-[.02em] text-muted';
/** Remembers whether the rep last left the lead details open or shrunk. */
const DETAILS_KEY = 'dialer.leadDetails';

/** Laptop and tablet layout: queue, lead and script, call panel side by side from 1280px. */
export default function CallingDesk({ s }: { s: CallSession }) {
  const {
    plan, free, sim, via, phoneLinked, setTalkVia, canStart, queue, current, setCurrent, lead, detail, merge, left, dials, limit, made,
    phase, setPhase, live, seconds, cost, clock, muted, setMuted, outcome, setOutcome, when, setWhen, scriptSize, setScriptSize,
    scriptLocked, setUpgrade, peek, setPeek, nextPick, setNextPick, multiDial, setMultiDial, pauseAfter, setPauseAfter, nextOpen, start, startAt, hangUp, skip, fixProblem,
    demo, details, listName, script, scriptFreeUntil, note, setNote, save, nextLead,
  } = s;
  const wrapup = phase === 'wrapup';

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) return;
      const k = e.key.toLowerCase();
      if (phase === 'ready' && k === 'p') start();
      if (phase !== 'live' && phase !== 'wrapup') return;
      if (phase === 'live' && k === 'm') setMuted(m => !m);
      if (phase === 'live' && k === 'h') hangUp();
      const n = Number(k);
      const o = OUTCOMES[n - 1];
      if (n >= 1 && n <= 6 && o) setOutcome(o.key);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const [queueOpen, setQueueOpen] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(() => {
    try { return window.localStorage.getItem(DETAILS_KEY) === 'open'; } catch { return false; }
  });
  const toggleDetails = () => {
    const next = !detailsOpen;
    setDetailsOpen(next);
    try { window.localStorage.setItem(DETAILS_KEY, next ? 'open' : 'closed'); } catch { /* private window: just don't remember */ }
  };
  const closeTimer = useRef<number | null>(null);
  const cancelClose = () => { if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const scheduleClose = () => { cancelClose(); closeTimer.current = window.setTimeout(() => setPeek(null), 160); };
  const openPeek = (i: number, el: HTMLElement) => { cancelClose(); setPeek(peekAt(i, el)); };
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
          const d = details[q.lead.id];
          const sub = q.done ?? (isCurrent
            ? (live ? 'On call now' : wrapup ? 'Just called' : `${free ? 'Selected' : 'Up first'} · ${d?.localTime ?? ''}`)
            : nextPick === i ? 'Next up' : [q.lead.company, d?.localTime].filter(Boolean).join(' · '));
          return (
            <div key={q.lead.id}
              onMouseEnter={e => { if (!isCurrent) openPeek(i, e.currentTarget); }} onMouseLeave={scheduleClose}
              onFocus={e => { if (!isCurrent) openPeek(i, e.currentTarget); }} onBlur={scheduleClose}>
            <button type="button" aria-current={isCurrent || undefined} aria-expanded={isCurrent ? undefined : peek?.index === i}
              aria-disabled={Boolean(q.done) || live || undefined}
              onClick={() => { if (q.done || live) return; setCurrent(i); setPeek(null); }}
              className={cn('flex w-full items-center gap-3 rounded-lg border-0 bg-transparent px-3 py-2.5 text-left',
                isCurrent ? 'bg-brand-soft' : 'cursor-pointer hover:bg-sunk aria-disabled:cursor-default')}>
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
            </div>
          );
        })}
        <span className="flex-1" />
        {plan === 'pro' && demo ? (
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
            {demo ? (
              <Button aria-pressed={pauseAfter} onClick={() => setPauseAfter(v => !v)}><Icon name={pauseAfter ? 'play' : 'pause'} size={16} />{pauseAfter ? 'Paused' : 'Pause'}</Button>
            ) : s.auto ? (
              <Button aria-pressed={pauseAfter} onClick={s.pauseAuto}><Icon name="pause" size={16} />{pauseAfter ? 'Stopping' : 'Pause'}</Button>
            ) : (
              <Button disabled={s.busy || live} onClick={start}><Icon name="play" size={16} />{s.made > 0 ? 'Resume' : 'Start'}</Button>
            )}
            <Button onClick={s.skipNext}><Icon name="skip" size={16} />Skip</Button>
          </div>
        )}
      </aside>
      )}

      <main className="max-xl:contents xl:flex xl:min-h-0 xl:flex-col xl:gap-4 xl:overflow-y-auto xl:bg-sunk xl:px-8 xl:py-6">
        <section aria-label="Lead" className={cn('flex flex-col rounded-xl border border-line bg-surface shadow-card max-xl:order-1',
          detailsOpen ? 'gap-4 px-4 py-4 sm:px-[22px] sm:py-5' : 'gap-2 px-4 py-3 sm:px-5')}>
          <div className={cn('flex items-center gap-x-3.5 gap-y-2', detailsOpen && 'flex-wrap')}>
            <Avatar initials={lead.initials} tone={lead.tone} size={detailsOpen ? 52 : 38} />
            <div className={detailsOpen ? 'min-w-[150px] flex-1' : 'min-w-0 flex-1'}>
              <h1 className={cn('font-semibold tracking-[-0.03em]', detailsOpen ? 'text-22 sm:text-26' : 'text-20')}>{lead.name}</h1>
              <p className={cn('pt-0.5 text-13 text-muted', !detailsOpen && 'truncate')}>
                {[detail.title, lead.company].filter(Boolean).join(', ')}{!detailsOpen && <>{detail.title || lead.company ? ' · ' : ''}{detail.localTime} their time</>}
              </p>
            </div>
            {detail.lastCall && <Pill tone={detail.lastCall.result === 'interested' ? 'success' : 'neutral'}>{detail.lastCall.result === 'interested' && <Icon name="up" size={14} />}{resultLabel(detail.lastCall.result)} last time</Pill>}
            <Pill>{ORDINAL[detail.attempt] ?? `${detail.attempt}th`} call</Pill>
            {plan === 'pro' && demo && <Pill tone="lemon"><Icon name="spark" size={14} />Summary on</Pill>}
            <Button variant="quiet" size="sm" className="flex-none" aria-expanded={detailsOpen} aria-controls="lead-details" onClick={toggleDetails}>
              {detailsOpen ? 'Hide details' : 'Show details'}
              <Icon name="right" size={14} className={detailsOpen ? '-rotate-90' : 'rotate-90'} />
            </Button>
          </div>
          {detailsOpen ? (
            <div id="lead-details" className="flex flex-col gap-4">
              <Facts items={([
                { icon: 'call', label: 'Phone', value: detail.phone },
                { icon: 'mail', label: 'Email', value: detail.email },
                { icon: 'pin', label: 'Location', value: detail.location },
                { icon: 'building', label: 'Company', value: detail.companyNote },
                { icon: 'globe', label: 'Website', value: detail.website },
                { icon: 'list', label: 'List', value: listName },
                { icon: 'note', label: 'Notes', value: detail.notes ?? '' },
              ] as const).filter(f => f.value)} />
              {detail.lastCall && (
                <div className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-md bg-warn-soft px-3.5 py-3 text-14 sm:flex-nowrap">
                  <Icon name="history" size={16} className="mt-0.5 text-warn-ink" />
                  <b className="whitespace-nowrap text-12 leading-5 font-medium text-warn-ink">Last call, {detail.lastCall.date} · {resultLabel(detail.lastCall.result)}</b>
                  <span>{detail.lastCall.note}</span>
                </div>
              )}
            </div>
          ) : detail.lastCall && (
            <p className="flex items-center gap-2 rounded-md bg-warn-soft px-3 py-1.5 text-13" title={detail.lastCall.note}>
              <Icon name="history" size={14} className="flex-none text-warn-ink" />
              <b className="whitespace-nowrap font-medium text-warn-ink">Last call, {detail.lastCall.date} · {resultLabel(detail.lastCall.result)}</b>
              <span className="truncate">{detail.lastCall.note}</span>
            </p>
          )}
        </section>

        <Paper className="max-xl:order-3 max-xl:after:hidden xl:flex xl:min-h-[380px] xl:flex-1 xl:flex-col">
          <div className="mb-[18px] flex flex-wrap items-center gap-1.5">
            <span className={cn(label, 'flex-1')}>{script ? `YOUR SCRIPT · ${script.name.toUpperCase()}` : 'NO SCRIPT YET'}</span>
            {free && script && scriptFreeUntil && (scriptLocked ? <Pill><Icon name="lock" size={13} />Starter</Pill> : <Pill tone="brand">Free until {scriptFreeUntil}</Pill>)}
            <Link to="/scripts" className={buttonClass({ variant: 'quiet', size: 'sm' })}>Edit</Link>
            <button type="button" aria-label="Smaller text" onClick={() => setScriptSize(s => Math.max(16, s - 2))} className="size-9 cursor-pointer rounded-sm border-0 bg-transparent text-13 text-muted hover:bg-sunk">A-</button>
            <button type="button" aria-label="Bigger text" onClick={() => setScriptSize(s => Math.min(28, s + 2))} className="size-9 cursor-pointer rounded-sm border-0 bg-transparent text-13 text-muted hover:bg-sunk">A+</button>
          </div>
          <div className="relative xl:-mr-3 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:pb-14 xl:pr-3" tabIndex={0} aria-label="Script">
            {!script && (
              <p className="text-15 text-muted">This list has no script. <Link to="/scripts" className="font-semibold text-brand-ink">Write one</Link> and pick this list, and it shows here with {merge.first_name === 'there' ? 'their' : `${merge.first_name}'s`} name filled in.</p>
            )}
            {script && <ScriptText size={scriptSize} className={cn(scriptLocked && 'pointer-events-none select-none blur-[6px]')}>
              <div aria-hidden={scriptLocked || undefined}>
                {script.parts.map(p => (
                  <div key={p.title}>
                    <h4>{p.title}</h4>
                    <p>{renderScript(p.body, t => <Merge>{merge[t]}</Merge>)}</p>
                  </div>
                ))}
              </div>
            </ScriptText>}
            {script && scriptLocked && (
              <div className="absolute inset-x-0 top-6 mx-auto flex max-w-[420px] flex-col items-center gap-2 rounded-2xl border border-line bg-surface px-6 py-5 text-center shadow-[0_16px_40px_rgba(0,0,0,.12)]">
                <Tile tone="brand"><Icon name="lock" /></Tile>
                <b className="text-18">Your script is now a Starter feature</b>
                <p className="text-13 text-muted">Your 2 free months of script on screen ended on {scriptFreeUntil ?? '1 Dec'}. You can keep calling on Free. To see your script while you call, move to Starter.</p>
                {live
                  ? <b className="text-13 text-brand-ink">You can move to Starter from Plans after this call.</b>
                  : <Button variant="primary" onClick={() => setUpgrade({ to: 'starter', reason: 'See your script while you call' })}>See Starter</Button>}
              </div>
            )}
          </div>
        </Paper>
      </main>

      <section className="flex flex-col gap-3.5 max-xl:order-2 xl:overflow-auto xl:border-l xl:border-line xl:p-5 [&>*]:shrink-0" aria-label="Call">
        {isProblem(sim) ? (
          <ProblemCard problem={sim} timer={clock} lead={merge.first_name} canUsePhone={!free} onFix={fixProblem} />
        ) : (
        <CallCard>
          <div className="flex items-center justify-between">
            <CallStatus live={live} state={s.callState} />
            {!live && !wrapup && <span className="text-12 text-zinc-400">US rate {s.rateLabel} / min</span>}
            {live && plan === 'pro' && demo && <span className="inline-flex items-center gap-1.5 text-12 text-zinc-400"><i className="size-[7px] rounded-full bg-danger" />Recording{via === 'phone' ? ' · on your phone' : ''}</span>}
            {live && !(plan === 'pro' && demo) && <span className="inline-flex items-center gap-1.5 text-12 text-zinc-400"><Icon name="lock" size={13} />Not recorded · Pro</span>}
          </div>
          <CallTimer seconds={seconds} idle={!live && !wrapup} />
          <CallFacts items={[
            { label: 'Their time', value: detail.localTime },
            { label: 'Your time', value: s.yourTime || '—' },
            live || wrapup ? { label: wrapup ? 'Cost' : 'This call', value: formatUsd3(cost), hot: true } : { label: 'Balance', value: s.balance },
          ]} />
        </CallCard>
        )}
        {s.lowBalance && (
          <Note tone="danger" className="text-13">
            <Icon name="wallet" size={15} />
            <span className="flex-1">Your balance is almost used up. The call ends when it runs out.</span>
          </Note>
        )}
        {s.dev && (
          <Note className="text-13">
            <Icon name="headset" size={15} />
            <span className="flex-1">{s.answered ? 'Fake phone: no sound.' : 'Fake phone: they pick up in 3 seconds.'}</span>
            <Button variant="outline" className="h-[34px]" onClick={s.dev.leadHangsUp}>They hang up</Button>
          </Note>
        )}

        {live || wrapup ? (
          <>
            {live ? (
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="lg" aria-pressed={muted} onClick={() => setMuted(m => !m)}>
                  <Icon name={muted ? 'micoff' : 'mic'} />{muted ? 'Unmute' : 'Mute'}<Kbd onColor={muted}>M</Kbd>
                </Button>
                <Button variant="danger" size="lg" disabled={s.busy} onClick={hangUp}><Icon name="hangup" />Hang up<Kbd onColor>H</Kbd></Button>
              </div>
            ) : (
              <p className="text-14 text-muted">
                {s.answered ? `Call ended after ${callLength(seconds)}.` : `${merge.first_name === 'there' ? 'They' : merge.first_name} didn't pick up. You weren't charged.`}
              </p>
            )}
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
                    {!(WHEN as readonly string[]).includes(when) && callbackLabel(when)}
                    <input type="date" aria-label="Pick a date" min={new Date().toISOString().slice(0, 10)} className="absolute inset-0 cursor-pointer opacity-0"
                      onChange={e => { if (e.target.value) setWhen(e.target.value); }} />
                  </label>
                </div>
              </>
            )}
            {!demo && (
              <textarea aria-label="Note" value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note (they'll see it next time)" maxLength={2000}
                onFocus={() => s.holdCountdown(true)} onBlur={() => s.holdCountdown(false)}
                className="min-h-[64px] w-full rounded-xl border border-line-strong bg-surface p-3 text-14 text-ink" />
            )}
            {wrapup && s.auto && (
              s.countdown !== null ? (
                <div role="status" className="flex flex-col gap-2 rounded-xl bg-brand-tint p-3.5">
                  <b className="text-15">{nextLead ? `Calling ${nextLead.name.split(' ')[0]} in ${s.countdown}` : `Saving in ${s.countdown}`}</b>
                  <span className="text-13 text-muted">Change the result or add a note before then. Typing a note holds the countdown.</span>
                  <div className="grid grid-cols-2 gap-2">
                    <Button onClick={s.pauseAuto}><Icon name="pause" size={16} />Pause</Button>
                    <Button variant="primary" onClick={s.callNow}><Icon name="call" size={16} />{nextLead ? 'Call now' : 'Save now'}</Button>
                  </div>
                </div>
              ) : !outcome && (
                <p className="text-13 text-muted">Pick a result and the next call starts on its own.</p>
              )
            )}
            {wrapup && !s.auto && (
              free || !nextLead ? (
                <Button variant="primary" size="lg" block disabled={s.busy} onClick={() => save(false)}>Save</Button>
              ) : (
                <div className="flex flex-col gap-2">
                  <Button variant="primary" size="lg" block disabled={s.busy} onClick={() => save(true)}>Save · call {nextLead.name.split(' ')[0]}</Button>
                  <Button size="lg" block disabled={s.busy} onClick={() => save(false)}>Save and pause</Button>
                </div>
              )
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
              <ChoiceCard checked={via === 'phone'} locked={free || !demo}
                onClick={() => { if (!demo) return; if (free) setUpgrade({ to: 'starter', reason: 'Talk on your phone with Starter' }); else setTalkVia('phone'); }}>
                <Tile tone="brand" size={36}><Icon name="phone" /></Tile>
                <span><b className="block text-14 font-semibold">Use my phone to talk</b><span className="block text-12 text-muted">Your phone is the mic and speaker. You watch the script here. No phone minutes used</span></span>
                {!demo ? <Pill className="ml-auto flex-none">Soon</Pill> : free ? <Pill tone="brand" className="ml-auto flex-none"><Icon name="lock" size={14} />Starter</Pill> : <Radio />}
              </ChoiceCard>
            </div>
            {free && demo && (
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
            {!demo && DEV_TOOLS && <FakePickUpSwitch />}
            <Button variant="primary" size="lg" block aria-disabled={!canStart} onClick={start}>
              <Icon name="call" />{s.busy ? 'Calling…' : free ? `Call ${merge.first_name === 'there' ? lead.name : merge.first_name}` : 'Start calling'}{!free && <Kbd onColor>P</Kbd>}
            </Button>
            <p className="text-center text-12 text-muted">
              {free ? 'On Free you call one lead at a time and pick who is next.'
                : canStart ? 'Calls go out one after another. Pause any time.' : s.busy ? 'Starting the call…' : 'Starts once your phone is connected'}
            </p>
          </>
        )}
      </section>

      <PairDialog open={phase === 'pairing'} onCancel={() => setPhase('ready')} onChange={() => { setTalkVia('computer'); setPhase('ready'); }} />
      {peek && queue[peek.index] && (() => {
        const q = queue[peek.index]!;
        const first = q.lead.name.split(' ')[0] ?? q.lead.name;
        const done = () => setPeek(null);
        let tag = 'In list';
        let actions: PeekAction[] = [];
        if (q.done) tag = 'Done';
        else if (live && !free) {
          tag = peek.index === nextOpen(current) ? 'Next' : 'In queue';
          actions = [
            { label: 'Skip', onClick: () => { skip(peek.index); done(); } },
            { label: 'Call next', primary: true, onClick: () => { setNextPick(peek.index); done(); } },
          ];
        } else if (!live && free) {
          actions = [{ label: `Call ${first}`, primary: true, onClick: () => { startAt(peek.index); done(); } }];
        } else if (!live) {
          tag = 'In queue';
          actions = [
            { label: 'Skip', onClick: () => { skip(peek.index); done(); } },
            { label: 'Call first', primary: true, onClick: () => { setCurrent(peek.index); done(); } },
          ];
        }
        return <LeadPeek peek={peek} lead={q.lead} detail={details[q.lead.id]} tag={tag} actions={actions} onClose={done} onEnter={cancelClose} onLeave={scheduleClose} />;
      })()}
    </div>
  );
}
