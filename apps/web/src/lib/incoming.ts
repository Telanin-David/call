import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import type { components } from '@dialer/api-client';
import { api } from './api';
import { isLive } from './backend';
import { whenLabel } from './activity';
import type { Softphone } from './phone';

export type IncomingCall = components['schemas']['IncomingCall'];

/** How often the app checks for a lead calling back. Each check keeps the rep online for 10 seconds. */
export const INCOMING_POLL_MS = 2000;

export const incomingKey = ['incoming'] as const;

/** The call ringing the rep, polled on Starter and Pro while the app is open. */
export function useIncoming(on: boolean) {
  return useQuery({
    queryKey: incomingKey,
    queryFn: () => api.get<{ call: IncomingCall | null }>('/incoming'),
    enabled: isLive() && on,
    refetchInterval: INCOMING_POLL_MS,
    refetchIntervalInBackground: true,
  });
}

/** "Not now": the call ends and the lead goes to the top of Follow-ups. */
export const declineIncoming = (id: string) => api.post<unknown>(`/calls/${id}/hangup`);

/** "Reyes Home Care · last call yesterday 2:14 pm", under the caller's name. */
export function callerLine(call: IncomingCall, now: Date = new Date()): string {
  const lead = call.lead;
  const last = lead?.last_call;
  const when = last ? `last call ${whenLabel(last.at, now).replace(/^(Today|Yesterday)/, m => m.toLowerCase())}` : '';
  return [lead?.company || lead?.list_name, when].filter(Boolean).join(' · ');
}

/**
 * The incoming call the rep just answered, handed from the alert to the
 * call screen with the phone carrying it. ringing holds auto-dial while the
 * alert is up.
 */
interface IncomingState {
  answered: { call: IncomingCall; phone: Softphone } | null;
  ringing: boolean;
  take: (call: IncomingCall, phone: Softphone) => void;
  clear: () => void;
  setRinging: (on: boolean) => void;
}

export const useIncomingStore = create<IncomingState>((set) => ({
  answered: null,
  ringing: false,
  take: (call, phone) => set({ answered: { call, phone } }),
  clear: () => set({ answered: null }),
  setRinging: (ringing) => set({ ringing }),
}));
