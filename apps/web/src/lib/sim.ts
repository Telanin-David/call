import { create } from 'zustand';

/**
 * Dev-only switch for states that real services will trigger later
 * (an inbound callback, a blocked dial, a dropped connection). Lets
 * anyone clicking through D1 see every board without a backend.
 */
export const SIMS = {
  callback: 'Lead calls you back',
  limit: 'Daily limit hit',
  balance: 'Balance too low',
  tries: 'Same number, 3 tries',
  dnc: 'Do-not-call number',
  internet: 'Internet dropped',
  phone: 'Phone dropped',
  mic: 'Mic blocked',
  weak: 'Weak connection',
  script: 'Free script months over',
  oncall: 'On a call',
  wrapup: 'After a call (phone layout)',
  pairing: 'Scan with your phone',
  upgrade: 'Upgrade offer',
  movefree: 'Move to Free',
} as const;

export type Sim = keyof typeof SIMS;

/** Where each simulated state lives. Everything else is on the dial screen. */
export const SIM_ROUTE: Partial<Record<Sim, string>> = { movefree: '/settings' };

/** Sims that do one thing when picked and then clear themselves. */
export const ONE_SHOT = ['oncall', 'wrapup', 'pairing', 'upgrade', 'movefree'] as const satisfies readonly Sim[];

export const BLOCKS = ['limit', 'balance', 'tries', 'dnc'] as const satisfies readonly Sim[];
export const PROBLEMS = ['internet', 'phone', 'mic', 'weak'] as const satisfies readonly Sim[];
export type Block = (typeof BLOCKS)[number];
export type Problem = (typeof PROBLEMS)[number];

export function isBlock(s: Sim | null): s is Block {
  return (BLOCKS as readonly string[]).includes(s ?? '');
}

export function isProblem(s: Sim | null): s is Problem {
  return (PROBLEMS as readonly string[]).includes(s ?? '');
}

interface SimState {
  sim: Sim | null;
  setSim: (s: Sim | null) => void;
}

export const useSimStore = create<SimState>(set => ({
  sim: null,
  setSim: sim => set({ sim }),
}));
