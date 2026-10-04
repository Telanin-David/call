/**
 * Live or demo. With VITE_API_URL set, screens talk to the api: real sign
 * up, real balance, real plans. Without it (the hosted preview), every
 * screen shows fake data and nothing is sent anywhere.
 */
export function apiBase(): string | undefined {
  const url = import.meta.env.VITE_API_URL;
  return url ? url.replace(/\/$/, '') : undefined;
}

export function isLive(): boolean {
  return apiBase() !== undefined;
}
