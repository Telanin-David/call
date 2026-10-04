import { api } from './api';
import type { StartedCall } from './calling';

/**
 * The browser phone: it places the call the server approved and carries the
 * sound. Ending a call goes through the server (POST /calls/{id}/hangup),
 * which tells the provider and bills it, so the phone only has to dial.
 */
export interface Softphone {
  dial(call: StartedCall): Promise<void>;
  /** Drops the sound at once; the server ends the call itself. */
  stop(): void;
  setMuted(muted: boolean): void;
}

/** How long the fake lead takes to pick up. */
export const FAKE_ANSWER_MS = 3000;
/** How long a fake lead who doesn't pick up rings before the line drops. */
export const FAKE_NO_ANSWER_MS = 5000;

const PICK_UP_KEY = 'dialer.fakePickUp';

/** Development: whether fake leads pick up. Kept for this tab. */
export function fakeLeadsPickUp(): boolean {
  try { return window.sessionStorage.getItem(PICK_UP_KEY) !== 'no'; } catch { return true; }
}

export function setFakeLeadsPickUp(on: boolean) {
  try { window.sessionStorage.setItem(PICK_UP_KEY, on ? 'yes' : 'no'); } catch { /* the default it is */ }
}

/**
 * Development only. There is no sound: it plays the provider's events
 * through /dev/calls, which signs them like Telnyx does, so the server runs
 * the same checks and billing as for a real call. The lead picks up after
 * FAKE_ANSWER_MS unless the rep hangs up first; with pick-up off, the line
 * drops unanswered after FAKE_NO_ANSWER_MS, as a busy or unanswered phone.
 */
export function fakePhone(answerAfterMs = FAKE_ANSWER_MS): Softphone {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    async dial(call) {
      await api.post(`/dev/calls/${call.call_id}/events/initiated`);
      const pickUp = fakeLeadsPickUp();
      timer = setTimeout(() => {
        void api.post(`/dev/calls/${call.call_id}/events/${pickUp ? 'answered' : 'hangup'}`).catch(() => { /* the call ended first */ });
      }, pickUp ? answerAfterMs : FAKE_NO_ANSWER_MS);
    },
    stop() {
      clearTimeout(timer);
    },
    setMuted() { /* no sound to mute */ },
  };
}

/** Development only: the lead hangs up. */
export function fakeLeadHangsUp(callId: string): Promise<unknown> {
  return api.post(`/dev/calls/${callId}/events/hangup`);
}

/** The phone for a call the server approved. Telnyx's browser phone comes with D3 part 5. */
export function phoneFor(call: StartedCall): Softphone {
  if (call.phone === 'fake') return fakePhone();
  throw new Error('The browser phone for real calls is not set up yet.');
}
