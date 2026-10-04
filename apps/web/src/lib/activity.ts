import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { components } from '@dialer/api-client';
import type { AvatarTone, PillTone } from '@dialer/ui';
import { api } from './api';
import { isLive } from './backend';
import { formatUsd } from './money';

type S = components['schemas'];
export type LeadRef = S['LeadRef'];
export type Followup = S['Followup'];
export type CallTotals = S['CallTotals'];
export type CallRecord = S['CallRecord'];
export type HistoryPage = S['HistoryResponse'];
export type TodayData = {
  dials_today: number; dial_limit: number | null; today: CallTotals; yesterday: CallTotals;
  followups_due: number; due: Followup[]; ready_list: { id: string; name: string; left: number; script_name: string } | null;
};
export type FollowupTab = 'today' | 'tomorrow' | 'week' | 'later';
export type FollowupsData = { counts: Record<FollowupTab, number>; followups: Followup[] };
export type Outcome = NonNullable<CallRecord['outcome']>;

export const activityKeys = {
  today: ['today'] as const,
  followups: (tab: FollowupTab) => ['followups', tab] as const,
  history: (outcome: string, q: string) => ['history', outcome, q] as const,
};

export function useToday() {
  return useQuery({ queryKey: activityKeys.today, queryFn: () => api.get<TodayData>('/today'), enabled: isLive() });
}

export function useFollowups(tab: FollowupTab) {
  return useQuery({ queryKey: activityKeys.followups(tab), queryFn: () => api.get<FollowupsData>(`/followups?tab=${tab}`), enabled: isLive() });
}

export function useHistory(outcome: string, q: string) {
  return useInfiniteQuery({
    queryKey: activityKeys.history(outcome, q),
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams();
      if (outcome) p.set('outcome', outcome);
      if (q) p.set('q', q);
      if (pageParam) p.set('cursor', pageParam);
      return api.get<HistoryPage>(`/history?${p.toString()}`);
    },
    initialPageParam: '',
    getNextPageParam: last => last.next_cursor || undefined,
    enabled: isLive(),
  });
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  interested: 'Interested',
  callback: 'Call back',
  not_interested: 'Not interested',
  no_answer: 'No answer',
  wrong_number: 'Wrong number',
  do_not_call: 'Do not call',
};

export const OUTCOME_TONE: Record<Outcome, PillTone> = {
  interested: 'success',
  callback: 'brand',
  not_interested: 'neutral',
  no_answer: 'warn',
  wrong_number: 'neutral',
  do_not_call: 'danger',
};

/** "Lena Park" → "LP"; a company or number gives its first two letters. */
export function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter(w => /[A-Za-z]/.test(w));
  if (words.length >= 2) return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase();
  return (words[0] ?? '#').slice(0, 2).toUpperCase();
}

const TONES: AvatarTone[] = ['a', 'b', 'c', 'd', 'e'];

/** The same lead always gets the same avatar colour. */
export function toneOf(id: string): AvatarTone {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length] ?? 'a';
}

/** 252 → "4:12". */
export function callLength(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** 6720 → "1h 52m"; 300 → "5m"; 14 → "14s"; 0 → "0m". */
export function talkTime(seconds: number): string {
  if (seconds > 0 && seconds < 60) return `${seconds}s`;
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

/** A call's cost to the cent; a cost under a cent shows "<$0.01", never "$0.00". */
export function callCost(micro: number): string {
  return micro > 0 && micro < 10_000 ? '<$0.01' : formatUsd(micro);
}

/** "3:14 pm" in a time zone; "" when the zone is unknown. */
export function clockIn(zone: string, at: Date = new Date()): string {
  if (!zone) return '';
  try {
    return at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: zone }).toLowerCase().replace(/\s/g, ' ');
  } catch {
    return '';
  }
}

/** "in 2 h", "in 25 min", "15 min ago" or "2 days ago". */
export function relative(iso: string, now: Date = new Date()): string {
  const mins = Math.round((new Date(iso).getTime() - now.getTime()) / 60_000);
  const abs = Math.abs(mins);
  const span = abs < 60 ? `${abs} min` : abs < 48 * 60 ? `${Math.round(abs / 60)} h` : `${Math.round(abs / 1440)} days`;
  return mins >= 0 ? `in ${span}` : `${span} ago`;
}

/** "Today 3:02 pm", "Yesterday 4:20 pm" or "2 Oct 9:15 am", in the viewer's time. */
export function whenLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  const day = (x: Date) => x.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day(d) === day(now)) return `Today ${time}`;
  if (day(d) === day(yesterday)) return `Yesterday ${time}`;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${time}`;
}

export function isOutcome(s: string | null | undefined): s is Outcome {
  return typeof s === 'string' && s in OUTCOME_LABEL;
}
