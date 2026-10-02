export const MICRO = 1_000_000;

export function formatUsd(micro: number): string {
  const sign = micro < 0 ? '-' : '';
  const cents = Math.round(Math.abs(micro) / 10_000);
  const dollars = Math.floor(cents / 100);
  return `${sign}$${dollars.toLocaleString('en-US')}.${String(cents % 100).padStart(2, '0')}`;
}

export function usd(dollars: number, cents = 0): number {
  return dollars * MICRO + Math.round(cents * 10_000);
}

export function formatUsd3(micro: number): string {
  return `$${(Math.round(micro / 1_000) / 1_000).toFixed(3)}`;
}
