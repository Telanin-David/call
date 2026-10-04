import { useQuery } from '@tanstack/react-query';
import type { components } from '@dialer/api-client';
import { api } from './api';
import { isLive } from './backend';

type S = components['schemas'];
export type Script = S['Script'];
export type ScriptRequest = S['ScriptRequest'];
export type ScriptsResponse = { scripts: Script[]; fields: string[]; on_screen_free_until: string | null };

export const scriptKeys = {
  scripts: ['scripts'] as const,
};

export function useScripts() {
  return useQuery({ queryKey: scriptKeys.scripts, queryFn: () => api.get<ScriptsResponse>('/scripts'), enabled: isLive() });
}

/** "New script", or "New script 2" when that name is taken. */
export function freshName(taken: readonly string[], base = 'New script'): string {
  const lower = new Set(taken.map(n => n.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!lower.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

/** Splits pasted or uploaded text into parts at blank lines. */
export function partsFromText(text: string): { title: string; body: string }[] {
  return text.replace(/\r\n/g, '\n').split(/\n\s*\n/).map(b => b.trim()).filter(Boolean)
    .map((body, i) => ({ title: `Part ${i + 1}`, body }));
}
