import { useState, type ReactNode } from 'react';
import {
  Avatar, Button, ChoiceCard, Chip, Icon, LinkButton, Merge, Modal, Note, Pill, Radio, ScriptText, Tile, Toggle, cn, type IconName,
} from '@dialer/ui';
import { ProblemCard } from './CallAlerts';
import { OUTCOMES, WHEN, clockOf, type CallSession } from './useCallSession';
import { isProblem } from '@/lib/sim';
import { PLAN_LABEL } from '@/lib/plan';
import { CALLS, DETAILS, RESULT_LABEL } from '@/lib/fake';
import { formatUsd, formatUsd3 } from '@/lib/money';
import { SCRIPT_PARTS, renderScript } from '@/lib/script';

const OUTCOME_TILE: Record<string, string> = {
  mint: 'bg-success text-white', orange: 'bg-tangerine text-night', grey: 'bg-faint text-white', lemon: 'bg-lemon text-night', red: 'bg-danger text-white',
};

/** Full-height layer above the app shell, for the call and wrap-up screens. */
function Layer({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('fixed inset-0 z-30 flex flex-col bg-sunk text-ink', className)}>{children}</div>;
}

function RoundAction({ icon, label, onClick, pressed, danger }: { icon: IconName; label: string; onClick: () => void; pressed?: boolean; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={pressed}
      className="flex flex-1 cursor-pointer flex-col items-center gap-1.5 border-0 bg-transparent text-12 font-semibold text-ink">
      <span className={cn('flex size-[52px] items-center justify-center rounded-full',
        danger ? 'bg-danger text-white' : pressed ? 'bg-ink text-surface' : 'bg-sunk text-ink')}>
        <Icon name={icon} size={22} />
      </span>
      {label}
    </button>
  );
}

function PlanBadge({ s }: { s: CallSession }) {
  const tone = s.plan === 'pro' ? 'bg-sun text-night' : s.plan === 'starter' ? 'bg-tangerine text-night' : 'bg-white text-night';
  const text = s.limit ? (s.free ? `${Math.max(0, s.limit - s.dials)} dials left` : `${s.dials} of ${s.limit}`) : 'No limit';
  return (
    <span className="flex items-center gap-1.5 text-12 font-semibold text-zinc-300">
      <span className={cn('rounded-[5px] px-1.5 py-0.5 text-11 font-extrabold uppercase', tone)}>{PLAN_LABEL[s.plan]}</span>{text}
    </span>
  );
}

function UpNextSheet({ s, open, onClose }: { s: CallSession; open: boolean; onClose: () => void }) {
  const next = s.nextLead;
  return (
    <Modal open={open} onClose={onClose} title="Up next">
      <p className="text-14 text-muted">{s.left} left{s.limit ? ` · ${s.dials} of ${s.limit} dials today` : ''}</p>
      <ul className="mt-3 flex list-none flex-col rounded-2xl border border-line">
        {s.queue.map((q, i) => {
          const d = DETAILS[q.lead.id];
          const isCurrent = i === s.current;
          return (
            <li key={q.lead.id} className={cn('flex items-center gap-3 border-t border-line px-3.5 py-2.5 first:border-t-0', q.done && 'opacity-55')}>
              <Avatar initials={q.lead.initials} tone={isCurrent ? 'brand' : q.lead.tone} size={32} />
              <span className="min-w-0 flex-1">
                <b className="block text-15">{q.lead.name}</b>
                <span className="text-13 text-muted">{q.done ?? (isCurrent ? 'On this call' : `${q.lead.company} · ${d?.localTime ?? ''}`)}</span>
              </span>
              {q.done ? <span className="text-13 text-muted">Done</span> : isCurrent && <span aria-hidden="true" className="size-2 rounded-full bg-success" />}
            </li>
          );
        })}
      </ul>
      {!s.free && (
        <div className="mt-3 flex flex-col rounded-2xl border border-line">
          <div className="flex items-center gap-3 px-3.5 py-3">
            <b className="flex-1 text-15 text-brand-ink">Pause after this call</b>
            <Toggle checked={s.pauseAfter} onChange={s.setPauseAfter} label="Pause after this call" />
          </div>
          {next && (
            <button type="button" onClick={() => { s.skip(s.nextIndex); }}
              className="flex cursor-pointer items-center gap-3 border-0 border-t border-line bg-transparent px-3.5 py-3 text-left">
              <b className="flex-1 text-15 text-brand-ink">Skip {next.name.split(' ')[0]}</b><Icon name="skip" size={17} className="text-brand-ink" />
            </button>
          )}
        </div>
      )}
      <Button size="lg" block className="mt-4" onClick={onClose}>Done</Button>
    </Modal>
  );
}

function DetailsSheet({ s, open, onClose }: { s: CallSession; open: boolean; onClose: () => void }) {
  const { lead, detail } = s;
  if (!lead || !detail) return null;
  const past = CALLS.filter(c => c.lead.id === lead.id);
  const rows: { icon: IconName; tone: string; main: string; sub: string }[] = [
    { icon: 'call', tone: 'bg-success', main: detail.phone, sub: 'Phone' },
    { icon: 'mail', tone: 'bg-blue-600', main: detail.email, sub: 'Email' },
    { icon: 'pin', tone: 'bg-tangerine', main: detail.location, sub: 'Location' },
    { icon: 'clock', tone: 'bg-night', main: `${detail.localTime} ${lead.pronoun} time`, sub: '8:14 pm your time' },
    { icon: 'building', tone: 'bg-violet-500', main: detail.companyNote, sub: detail.website },
  ];
  return (
    <Modal open={open} onClose={onClose} label={`${lead.name} details`}>
      <div className="flex flex-col items-center gap-1 text-center">
        <Avatar initials={lead.initials} tone={lead.tone} size={52} />
        <b className="mt-1 text-22">{lead.name}</b>
        <span className="text-14 text-muted">{detail.title}, {lead.company}</span>
      </div>
      <ul className="mt-4 flex list-none flex-col rounded-2xl border border-line">
        {rows.map(r => (
          <li key={r.sub} className="flex items-center gap-3 border-t border-line px-3.5 py-2.5 first:border-t-0">
            <span className={cn('flex size-8 flex-none items-center justify-center rounded-lg text-white', r.tone)}><Icon name={r.icon} size={16} /></span>
            <span className="min-w-0"><b className="block break-words text-15">{r.main}</b><span className="text-13 text-muted">{r.sub}</span></span>
          </li>
        ))}
      </ul>
      <span className="mt-4 block text-12 font-extrabold uppercase tracking-[.06em] text-faint">Past calls</span>
      <ul className="mt-2 flex list-none flex-col rounded-2xl border border-line">
        {detail.lastCall && (
          <li className="flex items-center gap-3 px-3.5 py-2.5">
            <span className="flex-1"><b className="block text-15">{detail.lastCall.date} · {RESULT_LABEL[detail.lastCall.result]}</b><span className="text-13 text-muted">{detail.lastCall.note}</span></span>
          </li>
        )}
        {past.map(c => (
          <li key={c.when} className="flex items-center gap-3 border-t border-line px-3.5 py-2.5 first:border-t-0">
            <span className="flex-1"><b className="block text-15">{c.when} · {RESULT_LABEL[c.result]}</b><span className="text-13 text-muted">{c.length}</span></span>
            <span className="text-14 tabular-nums">{formatUsd(c.cost)}</span>
          </li>
        ))}
        {!detail.lastCall && past.length === 0 && <li className="px-3.5 py-3 text-14 text-muted">First call to {lead.name.split(' ')[0]}.</li>}
      </ul>
    </Modal>
  );
}

function ReadyView({ s }: { s: CallSession }) {
  const [laptop, setLaptop] = useState(false);

  if (s.free) {
    return (
      <div className="flex flex-col gap-4 px-4 py-5">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <span className="text-12 font-extrabold uppercase tracking-[.06em] text-faint">October leads · {s.left} to call</span>
            <h1 className="text-28 font-extrabold tracking-[-0.03em]">Leads</h1>
          </div>
          <Pill>Free</Pill>
        </div>
        <button type="button" onClick={() => s.setUpgrade({ to: 'starter', reason: 'Let us dial for you with Starter' })}
          className="flex cursor-pointer items-center gap-3 rounded-2xl border-0 bg-brand-tint p-3.5 text-left text-ink">
          <Tile tone="brand" size={36}><Icon name="lock" size={17} /></Tile>
          <span className="flex-1"><b className="block text-15">Let us dial for you</b><span className="text-13 text-muted">Starter calls your list one after another.</span></span>
          <b className="text-14 text-brand-ink">See</b>
        </button>
        <span className="text-12 font-extrabold uppercase tracking-[.06em] text-faint">Tap to call · {s.dials} of {s.limit} today</span>
        <ul className="flex list-none flex-col rounded-2xl border border-line bg-surface">
          {s.queue.map((q, i) => {
            const d = DETAILS[q.lead.id];
            return (
              <li key={q.lead.id} className={cn('flex items-center gap-3 border-t border-line px-3.5 py-2.5 first:border-t-0', q.done && 'opacity-55')}>
                <Avatar initials={q.lead.initials} tone={q.lead.tone} size={36} />
                <span className="min-w-0 flex-1"><b className="block text-15">{q.lead.name}</b><span className="text-13 text-muted">{q.done ?? `${q.lead.company} · ${d?.localTime ?? ''}`}</span></span>
                {!q.done && (
                  <button type="button" aria-label={`Call ${q.lead.name}`} onClick={() => s.startAt(i)}
                    className="flex size-10 flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-tangerine text-night">
                    <Icon name="call" size={18} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-5">
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <span className="text-12 font-extrabold uppercase tracking-[.06em] text-faint">October leads · {s.left} left</span>
          <h1 className="text-28 font-extrabold tracking-[-0.03em]">Calling</h1>
        </div>
        <Pill tone={s.plan === 'pro' ? 'lemon' : 'brand'}>{PLAN_LABEL[s.plan]}</Pill>
      </div>
      {s.lead && (
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3.5">
          <Avatar initials={s.lead.initials} tone={s.lead.tone} size={40} />
          <span className="min-w-0 flex-1"><b className="block text-16">{s.lead.name}</b><span className="text-13 text-muted">{s.lead.company} · {s.detail?.localTime} {s.lead.pronoun} time</span></span>
          <Pill>Up first</Pill>
        </div>
      )}
      <section aria-label="How do you want to call?" className="flex flex-col gap-2.5">
        <h2 className="text-18 font-bold">How do you want to call?</h2>
        <div className="flex flex-col gap-2" role="radiogroup" aria-label="How do you want to call">
          <ChoiceCard checked={!laptop} onClick={() => { setLaptop(false); s.setTalkVia('computer'); }}>
            <Tile tone="brand" size={36}><Icon name="phone" /></Tile>
            <span><b className="block text-15 font-semibold">Just this phone</b><span className="block text-13 text-muted">Script and buttons here. Talk through the phone.</span></span>
            <Radio />
          </ChoiceCard>
          <ChoiceCard checked={laptop} onClick={() => setLaptop(true)}>
            <Tile tone="grey" size={36}><Icon name="laptop" /></Tile>
            <span><b className="block text-15 font-semibold">With my laptop</b><span className="block text-13 text-muted">Script on the laptop. This phone is the mic and speaker.</span></span>
            <Radio />
          </ChoiceCard>
        </div>
        <p className="text-13 text-muted">Calls use the internet, not your airtime. You can change this any time.</p>
      </section>
      {laptop ? (
        <Button variant="primary" size="xl" block onClick={() => s.navigate('/link')}><Icon name="qr" />Link my laptop</Button>
      ) : (
        <Button variant="primary" size="xl" block onClick={() => s.startAt(s.current)}><Icon name="call" />Start calling</Button>
      )}
      {s.nextLead && <p className="text-center text-13 text-muted">Then {s.nextLead.name}, {s.left - 1} more after that.</p>}
    </div>
  );
}

function LiveView({ s }: { s: CallSession }) {
  const [sheet, setSheet] = useState<'queue' | 'note' | 'details' | null>(null);
  const { lead, detail, merge } = s;
  if (!lead || !detail || !merge) return null;

  return (
    <Layer>
      <header className="flex flex-col gap-3 bg-night px-4 pb-4 pt-[max(12px,env(safe-area-inset-top))] text-white">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setSheet('queue')} className="flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-15 text-glow">
            <Icon name="left" size={16} />{s.free ? 'Leads' : 'Queue'}
          </button>
          <span className="flex flex-1 justify-center"><PlanBadge s={s} /></span>
          <button type="button" aria-label="Up next" onClick={() => setSheet('queue')} className="flex size-8 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-glow">
            <Icon name="list" size={18} />
          </button>
        </div>
        <div className="flex items-center gap-3">
          <Avatar initials={lead.initials} tone={lead.tone} size={40} />
          <div className="min-w-0 flex-1">
            <h1 className="text-20 font-bold">{lead.name}</h1>
            <p className="text-13 text-zinc-400">{lead.company} · {detail.localTime} {lead.pronoun} time</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 text-12 font-bold">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success/20 px-2.5 py-1 text-success tabular-nums"><i className="size-1.5 rounded-full bg-success" />{s.clock}</span>
          <span className="rounded-full bg-tangerine/20 px-2.5 py-1 text-glow tabular-nums">{formatUsd3(s.cost)}</span>
          {s.plan === 'pro'
            ? <span className="inline-flex items-center gap-1.5 rounded-full bg-danger/25 px-2.5 py-1 text-red-300"><i className="size-1.5 rounded-full bg-danger" />Rec</span>
            : <button type="button" onClick={() => s.setUpgrade({ to: 'pro', reason: 'Recording is on Pro' })}
                className="inline-flex cursor-pointer items-center gap-1 rounded-full border-0 bg-white/10 px-2.5 py-1 text-12 font-bold text-zinc-300">
                <Icon name="lock" size={12} />Not recorded
              </button>}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
        {isProblem(s.sim) && (
          <div className="mb-4">
            <ProblemCard problem={s.sim} timer={s.clock} lead={merge.first_name} canUsePhone={!s.free} onFix={s.fixProblem} />
          </div>
        )}
        {detail.lastCall && (
          <Note tone="lemon" className="mb-4 gap-2 text-13">
            <Icon name="history" size={15} className="mt-0.5 text-warn-ink" />
            <span><b>{detail.lastCall.date}</b> {detail.lastCall.note}</span>
          </Note>
        )}
        {s.free && !s.scriptLocked && <p className="mb-3 flex items-center gap-1.5 text-12 font-semibold text-brand-ink"><Icon name="lock" size={13} />Script on screen is free until 1 Dec</p>}
        <div className="relative">
          <ScriptText size={18} className={cn(s.scriptLocked && 'pointer-events-none select-none blur-[6px]')}>
            <div aria-hidden={s.scriptLocked || undefined}>
              {SCRIPT_PARTS.map(p => (
                <div key={p.title}>
                  <h4>{p.title}</h4>
                  <p>{renderScript(p.body, t => <Merge>{merge[t]}</Merge>)}</p>
                </div>
              ))}
            </div>
          </ScriptText>
          {s.scriptLocked && (
            <div className="absolute inset-x-0 top-10 flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4 shadow-[0_16px_40px_rgba(0,0,0,.12)]">
              <Tile tone="brand" size={36}><Icon name="lock" size={17} /></Tile>
              <b className="text-16">Your script is now a Starter feature</b>
              <p className="text-13 text-muted">You can keep calling on Free. You can move to Starter from Plans after this call.</p>
            </div>
          )}
        </div>
      </div>

      <nav aria-label="Call controls" className="flex border-t border-line bg-surface px-2 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
        <RoundAction icon={s.muted ? 'micoff' : 'mic'} label={s.muted ? 'Unmute' : 'Mute'} pressed={s.muted} onClick={() => s.setMuted(m => !m)} />
        <RoundAction icon="note" label="Note" onClick={() => setSheet('note')} />
        <RoundAction icon="users" label="Details" onClick={() => setSheet('details')} />
        <RoundAction icon="hangup" label="End" danger onClick={s.endCall} />
      </nav>

      <UpNextSheet s={s} open={sheet === 'queue'} onClose={() => setSheet(null)} />
      <DetailsSheet s={s} open={sheet === 'details'} onClose={() => setSheet(null)} />
      <Modal open={sheet === 'note'} onClose={() => setSheet(null)} title={`Note on ${lead.name.split(' ')[0]}`}>
        <textarea aria-label="Note" value={s.note} onChange={e => s.setNote(e.target.value)} placeholder="What did they say?"
          className="mt-4 min-h-[120px] w-full rounded-xl border border-line-strong bg-surface p-3 text-16 text-ink" />
        <Button variant="primary" size="lg" block className="mt-3" onClick={() => setSheet(null)}>Save note</Button>
      </Modal>
    </Layer>
  );
}

const SUMMARY = 'Lena runs 3 offices. Her cleaner keeps missing Fridays. She wants prices for all three and a call tomorrow after 3 pm.';

function WrapUpView({ s }: { s: CallSession }) {
  const first = s.merge?.first_name ?? '';
  const next = s.nextLead?.name;
  return (
    <Layer className="overflow-auto">
      <div className="flex flex-1 flex-col gap-4 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-[max(20px,env(safe-area-inset-top))]">
        <div>
          <p className="text-13 text-muted">Call ended · {clockOf(s.seconds)} · {formatUsd3(s.cost)}</p>
          <div className="flex items-center gap-2">
            <h1 className="flex-1 text-28 font-extrabold tracking-[-0.03em]">How did it go?</h1>
            {s.plan === 'pro' && <Pill tone="lemon">Pro</Pill>}
          </div>
        </div>
        {s.plan === 'pro' && (
          <section aria-label="Call summary" className="rounded-2xl border border-line bg-surface p-3.5">
            <span className="flex items-center gap-1.5 text-12 font-extrabold uppercase tracking-[.06em] text-warn-ink"><Icon name="spark" size={14} />Call summary</span>
            <p className="mt-1.5 text-14">{SUMMARY}</p>
            <div className="mt-2 flex gap-1.5">
              <Pill tone="brand">Suggested: Call back tomorrow</Pill>
              <Pill>Transcript</Pill>
            </div>
          </section>
        )}
        <div role="radiogroup" aria-label="Result" className="flex flex-col rounded-2xl border border-line bg-surface">
          {OUTCOMES.map(o => (
            <button key={o.key} type="button" role="radio" aria-checked={s.outcome === o.key} onClick={() => s.setOutcome(o.key)}
              className="flex cursor-pointer items-center gap-3 border-0 border-t border-line bg-transparent px-3.5 py-3 text-left first:border-t-0 aria-checked:bg-brand-tint">
              <span className={cn('flex size-7 flex-none items-center justify-center rounded-md', OUTCOME_TILE[o.tone])}><Icon name={o.icon} size={15} /></span>
              <b className="flex-1 text-15 font-semibold">{o.label}</b>
              {s.outcome === o.key && <Icon name="check" size={18} className="text-brand-ink" />}
            </button>
          ))}
        </div>
        {s.outcome === 'callback' && (
          <div className="flex flex-col gap-2">
            <span className="text-12 font-extrabold uppercase tracking-[.06em] text-faint">Call {first} back</span>
            <div className="flex flex-wrap gap-1.5">
              {WHEN.map(w => <Chip key={w} pressed={s.when === w} onClick={() => s.setWhen(w)}>{w}</Chip>)}
            </div>
          </div>
        )}
        <textarea aria-label="Note" value={s.note} onChange={e => s.setNote(e.target.value)} placeholder="Add a note"
          className="min-h-[72px] w-full rounded-2xl border border-line bg-surface p-3.5 text-16 text-ink" />
        <span className="flex-1" />
        {s.free ? (
          <Button variant="primary" size="xl" block onClick={() => s.save(false)}>Save</Button>
        ) : (
          <>
            <Button variant="primary" size="xl" block onClick={() => s.save(Boolean(next))}>
              {next ? `Save · call ${next}` : 'Save'}
            </Button>
            <LinkButton className="self-center text-15 font-semibold" onClick={() => s.save(false)}>Save and pause</LinkButton>
          </>
        )}
      </div>
    </Layer>
  );
}

/** Phone layout: pick how to call, a full-screen call with the script, then a wrap-up screen. */
export default function CallingPhone({ s }: { s: CallSession }) {
  if (s.phase === 'live') return <LiveView s={s} />;
  if (s.phase === 'wrapup') return <WrapUpView s={s} />;
  return <ReadyView s={s} />;
}
