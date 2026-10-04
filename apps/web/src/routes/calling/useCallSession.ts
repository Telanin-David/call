import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { IconName, OutcomeTone } from '@dialer/ui';
import { blockCopy } from './CallAlerts';
import type { Peek } from './NextLead';
import { isBlock, isProblem, useSimStore } from '@/lib/sim';
import { usePlan } from '@/lib/plan';
import { useCallStore, useDeviceStore } from '@/lib/store';
import { BALANCE, DETAILS, LEADS, QUEUE, RESULT_LABEL, type LeadDetail, type QueueItem } from '@/lib/fake';
import { formatUsd, usd } from '@/lib/money';
import { DIALS_PER_DAY, RATE_PER_MIN, formatRate } from '@/lib/pricing';
import { callbackLabel } from '@/lib/calling';
import { SCRIPT_NAME, SCRIPT_PARTS, type MergeValues, type ScriptPart } from '@/lib/script';

/** `wrapup` is the phone's after-call screen; the laptop picks a result during the call. */
export type Phase = 'ready' | 'pairing' | 'live' | 'wrapup';
export type Outcome = 'interested' | 'callback' | 'not_interested' | 'no_answer' | 'wrong' | 'dnc';

export const OUTCOMES: { key: Outcome; label: string; icon: IconName; tone: OutcomeTone }[] = [
  { key: 'interested', label: 'Interested', icon: 'up', tone: 'mint' },
  { key: 'callback', label: 'Call back', icon: 'callback', tone: 'orange' },
  { key: 'not_interested', label: 'Not interested', icon: 'down', tone: 'grey' },
  { key: 'no_answer', label: 'No answer', icon: 'missed', tone: 'lemon' },
  { key: 'wrong', label: 'Wrong number', icon: 'wrong', tone: 'grey' },
  { key: 'dnc', label: 'Do not call', icon: 'ban', tone: 'red' },
];

export const WHEN = ['Tomorrow', 'In 3 days', 'Next week'] as const;
/** A preset from WHEN, or a date picked by the rep ("Thu 9 Oct"). */
export type When = string;

const FIRST_OPEN = QUEUE.findIndex(q => !q.done);

/**
 * What the layouts show that the demo hard-codes and the live session reads
 * from the api: the list, script, money, clocks, the call's state, and the
 * live-only extras (Undo, errors, the fake phone's buttons).
 */
export interface SessionExtras {
  demo: boolean;
  details: Record<string, LeadDetail>;
  listName: string;
  script: { name: string; parts: ScriptPart[] } | null;
  /** "1 Dec": the last day Free shows the script on screen; null on a paid plan. */
  scriptFreeUntil: string | null;
  balance: string;
  rateLabel: string;
  yourTime: string;
  callState: 'ready' | 'calling' | 'connected' | 'ended';
  /** The lead picked up (this call, or the one being wrapped up). */
  answered: boolean;
  /** Answered calls are recorded (Pro, turned on): the rep starts by saying so. */
  recording: boolean;
  lowBalance: boolean;
  busy: boolean;
  error: string | null;
  clearError: () => void;
  undo: { label: string; run: () => void } | null;
  /** Development with the fake phone: play the lead's side. */
  dev: { leadHangsUp: () => void } | null;
  /** A call left open from before (a closed tab), to end it. */
  staleCall: { end: () => void } | null;
  loading: boolean;
  loadError: string | null;
  /** Auto-dial is running (Starter and Pro). */
  auto: boolean;
  /** Seconds until auto-dial calls the next lead; null when not counting. */
  countdown: number | null;
  callNow: () => void;
  pauseAuto: () => void;
  /** The queue's Skip button. */
  skipNext: () => void;
  /** Holds the countdown while the rep types a note. */
  holdCountdown: (on: boolean) => void;
  /** Live: the code dialog for linking the phone, while open. */
  pair: { code: string; expiresAt: string | null; renew: () => void; close: () => void } | null;
  /** Shows the code to link (or relink) the phone. */
  openPairing: () => void;
  /** The linked phone's name ("Pixel 6a"); empty when none. */
  phoneName: string;
  /** Seconds before a call on a lost phone is ended. */
  phoneLostLeft: number;
}

export function clockOf(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** All state for one calling session, shared by the laptop and phone layouts. */
export function useCallSession() {
  const { plan } = usePlan();
  const free = plan === 'free';
  const { leadId } = useParams();
  const { talkVia, phoneLinked, setTalkVia, setPhoneLinked } = useDeviceStore();
  const setCallStatus = useCallStore(s => s.setStatus);
  const navigate = useNavigate();
  const { sim, setSim } = useSimStore();

  const [upgrade, setUpgrade] = useState<{ to: 'starter' | 'pro'; reason: string } | null>(null);
  const [blockOpen, setBlockOpen] = useState(false);
  const [peek, setPeek] = useState<Peek | null>(null);
  const [nextPick, setNextPick] = useState<number | null>(null);
  const [multiDial, setMultiDial] = useState(true);
  const [queue, setQueue] = useState<QueueItem[]>(QUEUE);
  const [current, setCurrent] = useState(() => {
    const i = QUEUE.findIndex(q => q.lead.id === leadId && !q.done);
    return i >= 0 ? i : FIRST_OPEN;
  });
  const [phase, setPhase] = useState<Phase>('ready');
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [when, setWhen] = useState<When>('Tomorrow');
  const [note, setNote] = useState('');
  const [made, setMade] = useState(0);
  const [scriptSize, setScriptSize] = useState(20);
  const [pauseAfter, setPauseAfter] = useState(false);

  const via = free ? 'computer' : talkVia;
  const canStart = via === 'computer' || (via === 'phone' && phoneLinked);
  const lead = queue[current]?.lead;
  const detail = lead ? DETAILS[lead.id] : undefined;
  const left = 42 - queue.filter(q => q.done).length;
  const dials = (free ? 0 : 86) + made;
  const limit = DIALS_PER_DAY[plan];
  const live = phase === 'live';
  const cost = Math.round((RATE_PER_MIN[plan] * seconds) / 60);
  const scriptLocked = free && sim === 'script';

  function nextOpen(after: number, q: QueueItem[] = queue): number {
    return q.findIndex((x, i) => i > after && !x.done);
  }
  const nextIndex = nextOpen(current);
  const nextLead = queue[nextIndex]?.lead;

  const merge: MergeValues | null = lead && detail ? {
    first_name: lead.name.split(' ')[0] ?? lead.name,
    company: lead.company,
    city: detail.location.split(',')[0] ?? detail.location,
    her_time: detail.localTime,
  } : null;

  const block = isBlock(sim) && lead
    ? blockCopy(sim, { limit, lead: lead.name, next: nextLead?.name ?? 'the next lead', balance: formatUsd(usd(0, 4)) })
    : null;

  useEffect(() => {
    if (phase !== 'live') return;
    const t = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'pairing') return;
    const t = setTimeout(() => { setPhoneLinked(true); setPhase('ready'); }, 6000);
    return () => clearTimeout(t);
  }, [phase, setPhoneLinked]);

  useEffect(() => () => setCallStatus('idle'), [setCallStatus]);

  function startAt(i: number) {
    if (isBlock(sim)) { setBlockOpen(true); return; }
    if (!queue[i] || queue[i]?.done) return;
    setCurrent(i);
    setPhase('live');
    setSeconds(0);
    setOutcome(null);
    setNote('');
    setMade(m => m + 1);
    setCallStatus('answered');
  }

  function start() {
    if (!canStart) return;
    startAt(current);
  }

  /** Writes the result to the queue and moves to the next lead. */
  function save(thenCall: boolean) {
    const result = outcome === 'callback'
      ? `Call back ${(WHEN as readonly string[]).includes(when) ? when.toLowerCase() : callbackLabel(when)}`
      : outcome ? (OUTCOMES.find(o => o.key === outcome)?.label ?? '') : RESULT_LABEL.no_answer;
    const next = queue.map((q, i) => (i === current ? { ...q, done: result } : q));
    setQueue(next);
    setPhase('ready');
    setMuted(false);
    setCallStatus('idle');
    setPeek(null);
    if (isProblem(sim)) setSim(null);
    const picked = nextPick !== null && !next[nextPick]?.done ? nextPick : -1;
    setNextPick(null);
    const n = picked >= 0 ? picked : next.findIndex(q => !q.done);
    if (n < 0) return;
    setCurrent(n);
    if (thenCall && !pauseAfter) {
      setPhase('live');
      setSeconds(0);
      setOutcome(null);
      setNote('');
      setMade(m => m + 1);
      setCallStatus('answered');
    }
    setPauseAfter(false);
  }

  /** Laptop: hang up and save in one step. */
  function hangUp() {
    save(false);
  }

  /** Phone: end the call and show the wrap-up screen. */
  function endCall() {
    setPhase('wrapup');
    setMuted(false);
    setCallStatus('idle');
    if (isProblem(sim)) setSim(null);
  }

  function skip(i: number) {
    setQueue(q => q.map((x, j) => (j === i ? { ...x, done: 'Skipped' } : x)));
    if (i === current && phase === 'ready') {
      const n = nextOpen(current);
      if (n >= 0) setCurrent(n);
    }
  }

  // Dev "Simulate" menu: open the matching state as soon as it's picked.
  useEffect(() => {
    if (sim === 'oncall' || sim === 'wrapup') {
      setPhase(sim === 'oncall' ? 'live' : 'wrapup');
      setSeconds(sim === 'oncall' ? 134 : 252);
      setOutcome(null);
      setCallStatus(sim === 'oncall' ? 'answered' : 'idle');
      setSim(null);
    }
    if (sim === 'pairing') {
      if (!free) { setTalkVia('phone'); setPhoneLinked(false); setPhase('pairing'); }
      setSim(null);
    }
    if (sim === 'upgrade') {
      setUpgrade(free ? { to: 'starter', reason: 'Talk on your phone with Starter' } : { to: 'pro', reason: 'Recording is on Pro' });
      setSim(null);
    }
    if (isBlock(sim)) setBlockOpen(true);
    if (isProblem(sim) && sim !== 'mic' && phase !== 'live') {
      setPhase('live');
      setSeconds(sim === 'internet' ? 134 : sim === 'phone' ? 220 : 65);
      setCallStatus('answered');
    }
    // phase is read, not watched: only a new sim should start a call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim, setCallStatus]);

  const fixProblem = useCallback((action: 'laptop' | 'phone' | 'retry' | 'ok') => {
    if (action === 'laptop') setTalkVia('computer');
    if (action === 'phone') setTalkVia('phone');
    setSim(null);
  }, [setSim, setTalkVia]);

  function answerCallback() {
    setSim(null);
    const i = queue.findIndex(q => q.lead.id === LEADS.mark.id);
    if (i < 0) return;
    setQueue(q => q.map((x, j) => (j === i ? { lead: x.lead } : x)));
    setCurrent(i);
    setPhase('live');
    setSeconds(0);
    setOutcome(null);
    setCallStatus('answered');
  }

  function resolveBlock() {
    if (sim === 'limit') navigate('/verify');
    if (sim === 'balance') navigate('/wallet');
    if (sim === 'tries' && nextIndex >= 0) {
      setQueue(q => q.map((x, j) => (j === current ? { ...x, done: 'Blocked · 3 tries' } : x)));
      setCurrent(nextIndex);
    }
    if (sim === 'dnc' && nextIndex >= 0) {
      setQueue(q => q.map((x, j) => (j === nextIndex ? { ...x, done: 'Do not call · skipped' } : x)));
    }
    setBlockOpen(false);
    setSim(null);
  }

  const extras: SessionExtras = {
    demo: true,
    details: DETAILS,
    listName: 'October leads',
    script: { name: SCRIPT_NAME, parts: SCRIPT_PARTS },
    scriptFreeUntil: free ? '1 Dec' : null,
    balance: formatUsd(BALANCE),
    rateLabel: formatRate(plan),
    yourTime: '8:14 pm',
    callState: live ? 'connected' : phase === 'wrapup' ? 'ended' : 'ready',
    answered: live || phase === 'wrapup',
    recording: plan === 'pro',
    lowBalance: false,
    busy: false,
    error: null,
    clearError: () => {},
    undo: null,
    dev: null,
    staleCall: null,
    loading: false,
    loadError: null,
    auto: false,
    countdown: null,
    callNow: () => {},
    pauseAuto: () => {},
    skipNext: () => { if (phase === 'live') return; const n = nextOpen(current); if (n >= 0) setCurrent(n); },
    holdCountdown: () => {},
    pair: null,
    openPairing: () => setPhase('pairing'),
    phoneName: '',
    phoneLostLeft: 15,
  };

  return {
    ...extras,
    plan, free, sim, setSim, navigate,
    talkVia, via, phoneLinked, setTalkVia, canStart,
    queue, current, setCurrent, lead, detail, merge, left, dials, limit, made,
    phase, setPhase, live, seconds, cost, clock: clockOf(seconds), muted, setMuted,
    outcome, setOutcome, when, setWhen, note, setNote, scriptSize, setScriptSize, scriptLocked,
    upgrade, setUpgrade, blockOpen, setBlockOpen, block, peek, setPeek, nextPick, setNextPick,
    multiDial, setMultiDial, pauseAfter, setPauseAfter, nextIndex, nextLead, nextOpen,
    start, startAt, save, hangUp, endCall, skip, fixProblem, answerCallback, resolveBlock,
  };
}

export type CallSession = ReturnType<typeof useCallSession>;
