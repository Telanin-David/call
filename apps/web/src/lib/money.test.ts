import { describe, expect, it } from 'vitest';
import { MICRO, formatUsd, formatUsd3, usd } from './money';
import { formatRate, minutesFor, RATE_PER_MIN } from './pricing';

describe('usd', () => {
  it.each([
    [0, 0, 0],
    [1, 0, MICRO],
    [24, 51, 24_510_000],
    [0, 2.5, 25_000],
    [0, 1.7, 17_000],
  ])('usd(%d, %d) = %d micro-dollars', (dollars, cents, micro) => {
    expect(usd(dollars, cents)).toBe(micro);
    expect(Number.isInteger(usd(dollars, cents))).toBe(true);
  });
});

describe('formatUsd', () => {
  it.each([
    [0, '$0.00'],
    [24_510_000, '$24.51'],
    [1_234_500_000, '$1,234.50'],
    [-2_240_000, '-$2.24'],
    [4_999, '$0.00'],
    [5_000, '$0.01'],
  ])('formats %d as %s', (micro, text) => {
    expect(formatUsd(micro)).toBe(text);
  });

  it('formats sub-cent call costs to three places', () => {
    expect(formatUsd3(44_667)).toBe('$0.045');
  });
});

describe('pricing', () => {
  it('rates are integer micro-dollars per minute', () => {
    for (const rate of Object.values(RATE_PER_MIN)) expect(Number.isInteger(rate)).toBe(true);
  });

  it.each([
    ['free', '$0.025', 980],
    ['starter', '$0.020', 1225],
    ['pro', '$0.017', 1441],
  ] as const)('%s: %s a minute, $24.51 buys %d minutes', (plan, rate, minutes) => {
    expect(formatRate(plan)).toBe(rate);
    expect(minutesFor(usd(24, 51), plan)).toBe(minutes);
  });
});
