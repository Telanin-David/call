import { useQuery } from '@tanstack/react-query';
import type { components } from '@dialer/api-client';
import type { IconName, TileTone } from '@dialer/ui';
import { api, ApiError } from './api';
import { isLive } from './backend';
import type { Outcome } from './activity';

type S = components['schemas'];
export type Queue = S['Queue'];
export type QueueLead = S['QueueLead'];
export type QueueScript = S['QueueScript'];
export type StartedCall = S['StartedCall'];
export type LiveCall = S['Call'];

/** Which leads the call screen works through. */
export interface QueueFor {
  list?: string;
  followups?: boolean;
  lead?: string;
}

export const callingKeys = {
  queue: (f: QueueFor) => ['queue', f.lead ?? '', f.list ?? '', f.followups ? '1' : ''] as const,
  call: (id: string) => ['call', id] as const,
};

export function queuePath(f: QueueFor): string {
  const p = new URLSearchParams();
  if (f.lead) p.set('lead', f.lead);
  else if (f.followups) p.set('followups', '1');
  else if (f.list) p.set('list', f.list);
  const qs = p.toString();
  return qs ? `/queue?${qs}` : '/queue';
}

export function useQueue(f: QueueFor) {
  return useQuery({ queryKey: callingKeys.queue(f), queryFn: () => api.get<Queue>(queuePath(f)), enabled: isLive(), retry: false });
}

export const startCall = (leadId: string, via: 'laptop' | 'phone' = 'laptop') => api.post<StartedCall>('/calls', { lead_id: leadId, via });
export const getCall = (id: string) => api.get<LiveCall>(`/calls/${id}`);
export const hangupCall = (id: string) => api.post<LiveCall>(`/calls/${id}/hangup`);
export const saveOutcome = (id: string, body: { outcome: Outcome; note: string; follow_up_at?: string }) =>
  api.post<LiveCall>(`/calls/${id}/outcome`, body);

/** What the server said when it refused a call (board 34). */
export interface Refusal {
  code: string;
  title: string;
  message: string;
  action: string;
}

/** Reads a refused dial out of an api error. Its body carries a title and next step besides the message. */
export function refusalOf(err: unknown): Refusal {
  if (err instanceof ApiError) {
    const { title, action } = err.body;
    return {
      code: err.code,
      title: typeof title === 'string' && title ? title : "That call didn't start",
      message: err.message,
      action: typeof action === 'string' ? action : '',
    };
  }
  return { code: '', title: "That call didn't start", message: 'Something went wrong. Try again.', action: '' };
}

/** Starts a call. A refusal comes back as a Refusal instead of throwing. */
export async function dial(leadId: string, via: 'laptop' | 'phone' = 'laptop'): Promise<{ started: StartedCall } | { refused: Refusal }> {
  try {
    return { started: await startCall(leadId, via) };
  } catch (err) {
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
      return { refused: refusalOf(err) };
    }
    throw err;
  }
}

const REFUSAL_LOOK: Record<string, { icon: IconName; tone: TileTone }> = {
  daily_limit: { icon: 'clock', tone: 'brand' },
  low_balance: { icon: 'wallet', tone: 'lemon' },
  three_tries: { icon: 'lock', tone: 'grey' },
  do_not_call: { icon: 'ban', tone: 'red' },
  premium: { icon: 'ban', tone: 'red' },
  calling_hours: { icon: 'clock', tone: 'grey' },
  no_rate: { icon: 'globe', tone: 'grey' },
  abroad_cap: { icon: 'globe', tone: 'brand' },
  no_number: { icon: 'phone', tone: 'brand' },
};

const ACTION: Record<string, { primary: string; route?: string }> = {
  top_up: { primary: 'Add money', route: '/wallet' },
  verify_id: { primary: 'Verify my ID', route: '/verify' },
  upgrade: { primary: 'See plans', route: '/plans' },
  get_number: { primary: 'Get a number', route: '/numbers' },
};

/** The dialog for a refusal: the server's words, the look by code, one next step. */
export function refusalCopy(r: Refusal, hasNext: boolean) {
  const look = REFUSAL_LOOK[r.code] ?? { icon: 'wrong' as IconName, tone: 'grey' as TileTone };
  const act = ACTION[r.action];
  if (act) return { ...look, title: r.title, body: r.message, primary: act.primary, secondary: 'Not now', route: act.route };
  if (r.action === 'skip') return { ...look, title: r.title, body: r.message, primary: hasNext ? 'Skip to next lead' : 'OK', skip: true };
  return { ...look, title: r.title, body: r.message, primary: 'OK' };
}

/** The six results the server knows, keyed by the call screen's short names. */
export const OUTCOME_KEY = {
  interested: 'interested', callback: 'callback', not_interested: 'not_interested',
  no_answer: 'no_answer', wrong: 'wrong_number', dnc: 'do_not_call',
} as const satisfies Record<string, Outcome>;

const DAY = 86_400_000;
const PRESET_DAYS: Record<string, number> = { Tomorrow: 1, 'In 3 days': 3, 'Next week': 7 };

/**
 * When a "call back" lands: a preset is that many days from now at the
 * same time of day; a picked date (YYYY-MM-DD) is that day at the current
 * time of day, and never in the past.
 */
export function callbackAt(when: string, now: Date = new Date()): Date {
  const days = PRESET_DAYS[when];
  if (days !== undefined) return new Date(now.getTime() + days * DAY);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(when);
  if (!m) return new Date(now.getTime() + DAY);
  const at = new Date(now);
  at.setFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return at < now ? new Date(now.getTime() + 5 * 60_000) : at;
}

/** "2026-10-09" → "Thu 9 Oct"; presets stay as they are. */
export function callbackLabel(when: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(when);
  if (!m) return when;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** The cost of `seconds` at `pricePerMin`, rounded up to the micro-dollar as the server bills it. */
export function costOf(pricePerMin: number, seconds: number): number {
  return Math.ceil((pricePerMin * seconds) / 60);
}

const GAP_KEY = 'dialer.autodialGap';
export const GAPS = [3, 5, 10] as const;

/** Seconds auto-dial waits after a result before the next call. Kept on this device. */
export function autodialGap(): number {
  try {
    const n = Number(window.localStorage.getItem(GAP_KEY));
    return (GAPS as readonly number[]).includes(n) ? n : 5;
  } catch {
    return 5;
  }
}

export function setAutodialGap(seconds: number) {
  try { window.localStorage.setItem(GAP_KEY, String(seconds)); } catch { /* private window: the default it is */ }
}
