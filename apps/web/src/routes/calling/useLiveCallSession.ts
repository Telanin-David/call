import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { OUTCOMES, clockOf, type CallSession, type Outcome, type Phase, type When } from './useCallSession';
import type { Peek } from './NextLead';
import { usePlan } from '@/lib/plan';
import { useCallStore, useDeviceStore } from '@/lib/store';
import { useMe } from '@/lib/account';
import { apiBase } from '@/lib/backend';
import { errorText } from '@/lib/api';
import { activityKeys, clockIn, initialsOf, isOutcome, toneOf } from '@/lib/activity';
import { leadKeys } from '@/lib/leads';
import { prettyNumber } from '@/lib/numbers';
import { formatUsd } from '@/lib/money';
import {
  OUTCOME_KEY, autodialGap, callbackAt, callbackLabel, callingKeys, costOf, dial, getCall, hangupCall, refusalCopy, saveOutcome, useQueue,
  type LiveCall, type QueueLead, type Refusal,
} from '@/lib/calling';
import { fakeLeadHangsUp, phoneFor, type Softphone } from '@/lib/phone';
import { createPairing, mutePairing, usePairing } from '@/lib/pairing';
import type { LeadDetail, QueueItem } from '@/lib/fake';
import type { MergeValues } from '@/lib/script';

/** A queue row: the lead as the layouts show it, plus the server's lead. */
type Item = QueueItem & { src: QueueLead };

/** How the call that just ended went, for the wrap-up and Undo. */
interface Ended { seconds: number; cost: number; answered: boolean }

interface Undo { index: number; callId: string; outcome: Outcome; note: string; when: When; ended: Ended; label: string }

/** How long a call may ring before it is ended as no answer. */
export const RING_LIMIT_MS = 30_000;

const SKIP_LABEL: Record<string, string> = {
  do_not_call: 'Do not call · skipped', three_tries: 'Blocked · 3 tries', calling_hours: 'Too early or late · skipped',
  premium: 'Premium number · skipped', no_rate: 'Country not open · skipped',
};

/** Read aloud when the lead's row has no value for a fill-in word. */
const MERGE_FALLBACK: MergeValues = { first_name: 'there', company: 'your company', city: 'your city', her_time: 'now' };

function itemOf(l: QueueLead): Item {
  return { src: l, lead: { id: l.id, name: l.name, initials: initialsOf(l.name), tone: toneOf(l.id), company: l.company } };
}

function detailOf(l: QueueLead, now: Date): LeadDetail {
  const last = l.last_call;
  return {
    title: '', phone: prettyNumber(l.phone), email: l.email, location: l.city, companyNote: '', website: '', notes: l.notes,
    localTime: clockIn(l.her_time_zone, now) || '—',
    lastCall: last && isOutcome(last.outcome)
      ? { date: new Date(last.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), note: last.note, result: last.outcome }
      : undefined,
    attempt: l.attempts + 1,
  };
}

function savedLabel(o: Outcome, when: When): string {
  if (o === 'callback') return /^\d{4}-/.test(when) ? `Call back ${callbackLabel(when)}` : `Call back ${when.toLowerCase()}`;
  return OUTCOMES.find(x => x.key === o)?.label ?? '';
}

/** Ends a call when the tab closes mid-call; a normal request may not finish then. */
function hangupOnLeave(callId: string) {
  void fetch(`${apiBase() ?? '/api'}/calls/${callId}/hangup`, {
    method: 'POST', credentials: 'include', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: '{}',
  }).catch(() => { /* the ticker ends it */ });
}

/**
 * The call screen against the api: the queue from GET /queue, a real call
 * per lead (every rule checked on the server), the live status, time and
 * cost, hang up, the result with Undo, and the server's reasons when a call
 * is refused. Same shape as the demo session, so both layouts work on it.
 */
export function useLiveCallSession(): CallSession {
  const { plan } = usePlan();
  const free = plan === 'free';
  const { leadId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const setCallStatus = useCallStore(s => s.setStatus);
  const target = useMemo(() => ({ lead: leadId, list: params.get('list') ?? undefined, followups: params.get('followups') === '1' }),
    [leadId, params]);
  const key = JSON.stringify(target);
  const queue = useQueue(target);
  const q = queue.data;

  const [snap, setSnap] = useState<{ key: string; items: Item[] } | null>(null);
  const items = useMemo(() => (snap?.key === key ? snap.items : []), [snap, key]);
  const setItems = useCallback((f: (xs: Item[]) => Item[]) => setSnap(s => (s ? { ...s, items: f(s.items) } : s)), []);
  useEffect(() => {
    if (q && snap?.key !== key) setSnap({ key, items: q.leads.map(itemOf) });
  }, [q, key, snap?.key]);

  const [current, setCurrent] = useState(0);
  const [phase, setPhase] = useState<Phase>('ready');
  const [callId, setCallId] = useState<string | null>(null);
  const [price, setPrice] = useState(0);
  const [answeredAt, setAnsweredAt] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [ended, setEnded] = useState<Ended | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<(Refusal & { index: number }) | null>(null);
  const [blockOpen, setBlockOpen] = useState(false);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [muted, setMutedState] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [when, setWhen] = useState<When>('Tomorrow');
  const [note, setNote] = useState('');
  const [made, setMade] = useState(0);
  const [scriptSize, setScriptSize] = useState(20);
  const [pauseAfter, setPauseAfter] = useState(false);
  const [upgrade, setUpgrade] = useState<{ to: 'starter' | 'pro'; reason: string } | null>(null);
  const [peek, setPeek] = useState<Peek | null>(null);
  const [nextPick, setNextPick] = useState<number | null>(null);
  const [multiDial, setMultiDial] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [gap] = useState(autodialGap);
  const [fake, setFake] = useState(false);
  // Auto-dial (Starter and Pro): after each call, a countdown, then the next lead.
  const [auto, setAuto] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [hold, setHold] = useState(false);
  const [dialedAt, setDialedAt] = useState<number | null>(null);
  // Phone as headset (Starter and Pro): calls go through the linked phone.
  const [viaPhone, setViaPhone] = useState(false);
  const [pair, setPair] = useState<{ code: string; expiresAt: string | null } | null>(null);
  const pairing = usePairing('laptop', viaPhone || pair !== null);
  const linked = pairing.data?.status === 'linked';
  const phoneLost = viaPhone && pairing.data?.status === 'lost';
  const device = useDeviceStore();
  const phone = useRef<Softphone | null>(null);
  const liveCall = useRef<string | null>(null);
  useEffect(() => { liveCall.current = phase === 'live' ? callId : null; }, [phase, callId]);

  const { setTalkVia: storeVia, setPhoneLinked: storeLinked, setPhoneName: storeName } = device;
  useEffect(() => {
    storeVia(viaPhone ? 'phone' : 'computer');
    storeLinked(viaPhone && linked);
    storeName(pairing.data?.phone_name ?? '');
  }, [viaPhone, linked, pairing.data?.phone_name, storeVia, storeLinked, storeName]);
  useEffect(() => {
    if (pair && linked) setPair(null);
  }, [pair, linked]);
  // The phone is gone: auto-dial stops, so no call is sent to a phone that can't take it.
  useEffect(() => {
    if (phoneLost && phase !== 'live') { setAuto(false); setCountdown(null); }
  }, [phoneLost, phase]);

  // Start of a new queue: back to its first lead.
  useEffect(() => { setCurrent(0); setUndo(null); }, [key]);

  // Clocks on screen ("3:14 pm their time") move with the minute.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const callQ = useQuery({
    queryKey: callingKeys.call(callId ?? ''),
    queryFn: () => getCall(callId ?? ''),
    enabled: Boolean(callId) && phase === 'live',
    refetchInterval: 1000,
  });
  const status = phase === 'live' ? (callQ.data?.id === callId ? callQ.data.status : 'dialing') : 'ended';

  const applyEnded = useCallback((c: LiveCall) => {
    phone.current?.stop();
    setEnded({ seconds: c.seconds, cost: c.cost_microdollars, answered: c.answered_at !== null });
    setSeconds(c.seconds);
    setAnsweredAt(null);
    setMutedState(false);
    setCallStatus('idle');
    qc.setQueryData(callingKeys.call(c.id), c);
  }, [qc, setCallStatus]);

  // The lead picked up: the timer starts. They hung up, or the money ran out: wrap up.
  useEffect(() => {
    const c = callQ.data;
    if (!c || c.id !== callId || phase !== 'live') return;
    if (c.status === 'answered' && answeredAt === null) setAnsweredAt(Date.now());
    if (c.status === 'ended' && !busy) {
      applyEnded(c);
      if (c.answered_at === null) setOutcome(o => o ?? 'no_answer');
      setPhase('wrapup');
    }
  }, [callQ.data, callId, phase, answeredAt, busy, applyEnded]);

  useEffect(() => {
    if (phase !== 'live' || answeredAt === null) return;
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - answeredAt) / 1000)), 250);
    return () => clearInterval(t);
  }, [phase, answeredAt]);

  // Leaving mid-call ends it, so nothing is billed for a call nobody is on.
  useEffect(() => {
    const leave = () => { if (liveCall.current) hangupOnLeave(liveCall.current); };
    const warn = (e: BeforeUnloadEvent) => { if (liveCall.current) e.preventDefault(); };
    window.addEventListener('pagehide', leave);
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('beforeunload', warn);
      phone.current?.stop();
      if (liveCall.current) void hangupCall(liveCall.current).catch(() => { /* the ticker ends it */ });
      setCallStatus('idle');
    };
  }, [setCallStatus]);

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 8000);
    return () => clearTimeout(t);
  }, [undo]);

  const refresh = useCallback(() => Promise.all(
    [['queue'], leadKeys.lists, activityKeys.today, ['followups'], ['history'], ['me'], ['wallet']]
      .map(queryKey => qc.invalidateQueries({ queryKey })),
  ), [qc]);

  const item = items[current];
  const lead = item?.lead;
  const detail = item ? detailOf(item.src, now) : undefined;
  const details = useMemo(() => Object.fromEntries(items.map(x => [x.lead.id, detailOf(x.src, now)])), [items, now]);
  const live = phase === 'live';
  const answered = status === 'answered';
  const cost = ended ? ended.cost : costOf(price, seconds);
  const left = items.filter(x => !x.done).length;
  const dials = q?.dials_today ?? 0;
  const limit = q?.dial_limit ?? null;
  const script = q?.scripts.find(s => s.id === item?.src.script_id) ?? null;
  const freeUntil = q?.script_free_until ? new Date(`${q.script_free_until}T00:00:00Z`) : null;
  const scriptLocked = free && freeUntil !== null && now >= freeUntil;

  function nextOpen(after: number, xs: Item[] = items): number {
    return xs.findIndex((x, i) => i > after && !x.done);
  }
  const nextIndex = nextOpen(current);
  const nextLead = items[nextIndex]?.lead;

  const merge: MergeValues | null = item && detail ? {
    first_name: item.src.first_name || item.src.name || MERGE_FALLBACK.first_name,
    company: item.src.company || MERGE_FALLBACK.company,
    city: item.src.city || MERGE_FALLBACK.city,
    her_time: detail.localTime === '—' ? MERGE_FALLBACK.her_time : detail.localTime,
  } : null;

  function resetCall() {
    setPhase('ready');
    setCallId(null);
    setOutcome(null);
    setNote('');
    setSeconds(0);
    setEnded(null);
    setAnsweredAt(null);
    setMutedState(false);
    setPeek(null);
  }

  async function startAt(i: number, xs: Item[] = items, autoRun = auto, skipped = 0) {
    if (busy || phase === 'live') return;
    const it = xs[i];
    if (!it || it.done) return;
    setCurrent(i);
    setError(null);
    setUndo(null);
    setBusy(true);
    let res: Awaited<ReturnType<typeof dial>>;
    try {
      res = await dial(it.lead.id, viaPhone ? 'phone' : 'laptop');
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
      return;
    }
    if ('refused' in res) {
      setBusy(false);
      // Auto-dial skips leads it may not call now (too early, do not call) and
      // carries on; anything the rep must act on stops it.
      if (autoRun && res.refused.action === 'skip' && skipped < 25) {
        const next = xs.map((x, j) => (j === i ? { ...x, done: SKIP_LABEL[res.refused.code] ?? 'Skipped' } : x));
        setItems(() => next);
        const n = next.findIndex(x => !x.done);
        if (n >= 0) { await startAt(n, next, true, skipped + 1); return; }
        setAuto(false);
        return;
      }
      setAuto(false);
      setRefusal({ ...res.refused, index: i });
      setBlockOpen(true);
      return;
    }
    const st = res.started;
    resetCall();
    setCallId(st.call_id);
    setFake(st.phone === 'fake');
    setPrice(st.price_per_minute_microdollars);
    setPhase('live');
    setDialedAt(Date.now());
    setMade(m => m + 1);
    setCallStatus('answered');
    setBusy(false);
    void qc.invalidateQueries({ queryKey: ['queue'] });
    try {
      phone.current = phoneFor(st);
      await phone.current.dial(st);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The call couldn't connect.");
      try { applyEnded(await hangupCall(st.call_id)); } catch { /* the ticker ends it */ }
      setPhase('wrapup');
      setOutcome('no_answer');
    }
  }

  /** Free calls the lead picked; Starter and Pro start auto-dial from here. */
  function start() {
    if (viaPhone && !linked) { void openPairing(); return; }
    const on = !free;
    setAuto(on);
    setPauseAfter(false);
    void startAt(current, items, on);
  }

  /** Ends the call on the server, which bills it to the second. */
  async function endNow(): Promise<LiveCall | null> {
    if (!callId) return null;
    phone.current?.stop();
    setBusy(true);
    try {
      const c = await hangupCall(callId);
      applyEnded(c);
      return c;
    } catch (e) {
      setError(errorText(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveWith(o: Outcome, thenCall: boolean, done: Ended | null = ended) {
    if (!callId || !lead || !done) return;
    setBusy(true);
    setError(null);
    try {
      await saveOutcome(callId, {
        outcome: OUTCOME_KEY[o], note: note.trim(),
        ...(o === 'callback' ? { follow_up_at: callbackAt(when).toISOString() } : {}),
      });
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
      return;
    }
    setBusy(false);
    const label = savedLabel(o, when);
    const next = items.map((x, i) => (i === current
      ? { ...x, done: label, src: { ...x.src, attempts: x.src.attempts + 1, last_call: { at: new Date().toISOString(), outcome: OUTCOME_KEY[o], note: note.trim() } } }
      : x));
    setItems(() => next);
    setUndo({ index: current, callId, outcome: o, note, when, ended: done, label: `${label} · ${lead.name}` });
    void refresh();
    resetCall();
    const picked = nextPick !== null && !next[nextPick]?.done ? nextPick : -1;
    setNextPick(null);
    const n = picked >= 0 ? picked : next.findIndex(x => !x.done);
    if (n >= 0) setCurrent(n);
    const go = thenCall && !pauseAfter && n >= 0;
    setPauseAfter(false);
    setCountdown(null);
    if (!go) setAuto(false);
    if (go) void startAt(n, next, auto);
  }

  function save(thenCall: boolean) {
    const o = outcome ?? (ended && !ended.answered ? 'no_answer' : null);
    if (!o) { setError('Pick how the call went.'); return; }
    void saveWith(o, thenCall);
  }

  /**
   * Laptop: hang up, and save the result picked during the call in the
   * same step. A call nobody answered saves as No answer; an answered call
   * with nothing picked waits in the wrap-up.
   */
  function hangUp() {
    if (phase === 'wrapup') { save(false); return; }
    void (async () => {
      const c = await endNow();
      if (!c) return;
      const done: Ended = { seconds: c.seconds, cost: c.cost_microdollars, answered: c.answered_at !== null };
      if (auto) {
        // Auto-dial: the countdown saves it and calls the next lead.
        if (!done.answered) setOutcome(o => o ?? 'no_answer');
        setPhase('wrapup');
        return;
      }
      const o = outcome ?? (done.answered ? null : 'no_answer');
      setPhase('wrapup');
      if (o) {
        setOutcome(o);
        await saveWith(o, false, done);
      }
    })();
  }

  /** Phone: end the call and show the wrap-up screen. */
  function endCall() {
    void (async () => {
      const c = await endNow();
      if (!c) return;
      if (c.answered_at === null) setOutcome(o => o ?? 'no_answer');
      setPhase('wrapup');
    })();
  }

  function skip(i: number) {
    setItems(xs => xs.map((x, j) => (j === i ? { ...x, done: 'Skipped' } : x)));
    if (i === current && phase === 'ready') {
      const n = nextOpen(current);
      if (n >= 0) setCurrent(n);
    }
  }

  /** Skip: during or after a call, the lead after this one; before, this one. */
  function skipNext() {
    if (phase === 'ready') { skip(current); return; }
    const n = nextOpen(current);
    if (n >= 0) skip(n);
  }

  // A call nobody picks up ends after RING_LIMIT, so no one waits on a dead line.
  useEffect(() => {
    if (phase !== 'live' || dialedAt === null || status === 'answered' || busy) return;
    const t = setTimeout(() => {
      void (async () => {
        const c = await endNow();
        if (!c) return;
        if (c.answered_at === null) setOutcome(o => o ?? 'no_answer');
        setPhase('wrapup');
      })();
    }, Math.max(0, dialedAt + RING_LIMIT_MS - Date.now()));
    return () => clearTimeout(t);
    // endNow is recreated each render; the timer only needs the call and its state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, dialedAt, status, busy]);

  // Auto-dial: once the call has ended and has a result, count down to the next one.
  useEffect(() => {
    if (auto && phase === 'wrapup' && outcome && ended && countdown === null && !busy) setCountdown(gap);
  }, [auto, phase, outcome, ended, countdown, busy, gap]);
  const saveLatest = useRef(saveWith);
  useEffect(() => { saveLatest.current = saveWith; });
  useEffect(() => {
    if (countdown === null || hold || busy) return;
    if (countdown <= 0) {
      setCountdown(null);
      if (outcome) void saveLatest.current(outcome, true);
      return;
    }
    const t = setTimeout(() => setCountdown(c => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [countdown, hold, busy, outcome]);

  /** Stops auto-dial: at once between calls, after this one during a call. */
  function pauseAuto() {
    if (phase === 'live') { setPauseAfter(true); return; }
    setCountdown(null);
    setAuto(false);
  }

  const copy = refusal ? refusalCopy(refusal, nextIndex >= 0) : null;

  function resolveBlock() {
    if (copy && 'route' in copy && copy.route) navigate(copy.route);
    if (copy && 'skip' in copy && refusal) {
      const xs = items.map((x, j) => (j === refusal.index ? { ...x, done: SKIP_LABEL[refusal.code] ?? 'Skipped' } : x));
      setItems(() => xs);
      const n = xs.findIndex(x => !x.done);
      if (n >= 0) setCurrent(n);
    }
    setBlockOpen(false);
    setRefusal(null);
  }

  function runUndo() {
    if (!undo || phase === 'live') return;
    const u = undo;
    setItems(xs => xs.map((x, i) => (i === u.index ? { src: { ...x.src, attempts: Math.max(0, x.src.attempts - 1) }, lead: x.lead } : x)));
    setCurrent(u.index);
    setCallId(u.callId);
    setEnded(u.ended);
    setSeconds(u.ended.seconds);
    setOutcome(u.outcome);
    setNote(u.note);
    setWhen(u.when);
    setPhase('wrapup');
    setUndo(null);
  }

  const setMuted = (v: boolean | ((m: boolean) => boolean)) => {
    setMutedState(m => {
      const next = typeof v === 'function' ? v(m) : v;
      if (viaPhone) void mutePairing(next).catch(e => setError(errorText(e)));
      else phone.current?.setMuted(next);
      return next;
    });
  };

  /** Shows a new code for the phone to scan. */
  async function openPairing() {
    setError(null);
    try {
      const p = await createPairing();
      setPair({ code: p.code ?? '', expiresAt: p.expires_at });
      void qc.invalidateQueries({ queryKey: ['pairing'] });
    } catch (e) {
      setError(errorText(e));
      setViaPhone(false);
    }
  }

  function chooseVia(v: 'computer' | 'phone') {
    if (v === 'computer') { setViaPhone(false); setPair(null); return; }
    if (free) { setUpgrade({ to: 'starter', reason: 'Talk on your phone with Starter' }); return; }
    setViaPhone(true);
    if (!linked) void openPairing();
  }

  /** The phone dropped during a call: end it now and carry on from this laptop, or scan again. */
  const fixProblem = (action: 'laptop' | 'phone' | 'retry' | 'ok') => {
    if (action === 'laptop') {
      setViaPhone(false);
      if (phase === 'live') void endNow().then(c => { if (c) { if (c.answered_at === null) setOutcome(o => o ?? 'no_answer'); setPhase('wrapup'); } });
    }
    if (action === 'phone') void openPairing();
  };

  const staleId = q?.live_call_id && q.live_call_id !== callId ? q.live_call_id : null;

  return {
    plan, free, sim: phoneLost && phase === 'live' ? 'phone' : null, setSim: () => {}, navigate,
    talkVia: viaPhone ? 'phone' : 'computer', via: viaPhone ? 'phone' : 'computer', phoneLinked: linked, setTalkVia: chooseVia,
    canStart: Boolean(lead) && !busy && (!viaPhone || linked),
    queue: items, current, setCurrent, lead, detail, merge, left, dials, limit, made,
    phase, setPhase, live, seconds, cost, clock: clockOf(seconds), muted, setMuted,
    outcome, setOutcome, when, setWhen, note, setNote, scriptSize, setScriptSize, scriptLocked,
    upgrade, setUpgrade, blockOpen, setBlockOpen, block: copy, peek, setPeek, nextPick, setNextPick,
    multiDial, setMultiDial, pauseAfter, setPauseAfter, nextIndex, nextLead, nextOpen: (after: number) => nextOpen(after),
    start, startAt: (i: number) => { void startAt(i); }, save, hangUp, endCall, skip, fixProblem, answerCallback: () => {}, resolveBlock,

    demo: false,
    pair: pair ? { ...pair, renew: () => { void openPairing(); }, close: () => { setPair(null); if (!linked) setViaPhone(false); } } : null,
    openPairing: () => { void openPairing(); },
    phoneName: pairing.data?.phone_name ?? '',
    phoneLostLeft: pairing.data?.phone_seen_at
      ? Math.max(0, Math.round(15 - (Date.now() - Date.parse(pairing.data.phone_seen_at)) / 1000))
      : 15,
    auto,
    countdown,
    callNow: () => setCountdown(c => (c === null ? null : 0)),
    pauseAuto,
    skipNext,
    holdCountdown: setHold,
    details,
    listName: q?.title ?? '',
    script: script ? { name: script.name, parts: script.parts } : null,
    scriptFreeUntil: freeUntil ? freeUntil.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : null,
    balance: formatUsd(q?.balance_microdollars ?? 0),
    rateLabel: `$${((q?.price_per_minute_microdollars ?? 0) / 1_000_000).toFixed(3)}`,
    yourTime: clockIn(me.data?.timezone ?? '', now),
    callState: live ? (answered ? 'connected' : 'calling') : phase === 'wrapup' ? 'ended' : 'ready',
    answered: answered || Boolean(ended?.answered),
    lowBalance: Boolean(callQ.data?.low_balance && live),
    busy,
    error,
    clearError: () => setError(null),
    undo: undo && phase !== 'live' ? { label: undo.label, run: runUndo } : null,
    dev: live && fake && callId ? { leadHangsUp: () => { void fakeLeadHangsUp(callId); } } : null,
    staleCall: staleId ? { end: () => { void hangupCall(staleId).then(() => qc.invalidateQueries({ queryKey: ['queue'] })).catch(e => setError(errorText(e))); } } : null,
    loading: queue.isPending,
    loadError: queue.isError ? errorText(queue.error) : null,
  };
}
