import type { Plan } from './plan';
import { usd } from './money';

// Micro-dollars. Rates follow docs/PLANS_SPEC.md multipliers on a $0.01/min provider cost.
export const RATE_PER_MIN: Record<Plan, number> = { free: usd(0, 2.5), starter: usd(0, 2), pro: usd(0, 1.7) };
export const FEE_INTRO: Record<Plan, number> = { free: 0, starter: usd(10), pro: usd(21) };
export const FEE_LATER: Record<Plan, number> = { free: 0, starter: usd(15), pro: usd(35) };
export const DIALS_PER_DAY: Record<Plan, number | null> = { free: 30, starter: 120, pro: null };
export const NUMBER_MONTHLY = usd(1, 50);

export function minutesFor(balance: number, plan: Plan): number {
  return Math.floor(balance / RATE_PER_MIN[plan]);
}

export function formatRate(plan: Plan): string {
  return `$${(RATE_PER_MIN[plan] / 1_000_000).toFixed(3)}`;
}
