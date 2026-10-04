import { useQuery } from '@tanstack/react-query';
import type { components } from '@dialer/api-client';
import { api } from './api';
import { isLive } from './backend';
import type { StartedCall } from './calling';

export type Pairing = components['schemas']['Pairing'];
export type PairedCall = NonNullable<Pairing['call']>;

export const pairingKey = (as: 'laptop' | 'phone') => ['pairing', as] as const;

/**
 * The link between laptop and phone. The phone polls every second (that is
 * its check-in, so the call ends if it goes away); the laptop every two.
 */
export function usePairing(as: 'laptop' | 'phone', on = true) {
  return useQuery({
    queryKey: pairingKey(as),
    queryFn: () => api.get<Pairing>(`/pairing?as=${as}`),
    enabled: isLive() && on,
    refetchInterval: as === 'phone' ? 1000 : 2000,
    refetchIntervalInBackground: true,
  });
}

export const createPairing = () => api.post<Pairing>('/pairing');
export const joinPairing = (code: string, phoneName: string) => api.post<Pairing>('/pairing/join', { code, phone_name: phoneName });
export const mutePairing = (muted: boolean) => api.post<void>('/pairing/mute', { muted });
export const endPairing = () => api.delete<void>('/pairing');

/** "482913" → "482 913", as the laptop shows it. */
export function prettyCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/** The address the QR code opens on the phone. */
export function linkUrl(code: string, origin = window.location.origin): string {
  return `${origin}/link?code=${code}`;
}

/** A short name for this phone, from its browser: "Android phone", "iPhone". */
export function phoneName(ua = navigator.userAgent): string {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  const android = /Android[^;)]*;\s*([^;)]+?)(?:\s+Build|[;)])/.exec(ua);
  if (android?.[1] && !/^(K|wv|Linux)$/.test(android[1].trim())) return android[1].trim().slice(0, 60);
  if (/Android/.test(ua)) return 'Android phone';
  return 'This phone';
}

/** What the phone's softphone needs to dial a call the laptop started. */
export function toStarted(c: PairedCall, phone: Pairing['phone'], token = ''): StartedCall {
  return {
    call_id: c.id, lead_id: '', lead_name: c.lead_name, from: c.from, to: c.to, price_per_minute_microdollars: c.price_per_minute_microdollars,
    held_microdollars: 0, token, client_state: c.client_state, her_time_zone: '', phone,
  };
}
