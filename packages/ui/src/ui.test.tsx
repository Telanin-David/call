import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { cn } from './cn';
import { buttonClass } from './Button';
import { Progress } from './Badge';
import { CodeBoxes } from './Form';

afterEach(cleanup);

describe('cn', () => {
  it.each([
    ['keeps a numeric text size next to a text colour', ['text-13', 'text-muted'], 'text-13 text-muted'],
    ['later numeric text size wins', ['text-13', 'text-15'], 'text-15'],
    ['later colour wins', ['text-muted', 'text-ink'], 'text-ink'],
    ['later padding wins', ['px-2', 'px-4'], 'px-4'],
  ])('%s', (_, input, expected) => {
    expect(cn(...input)).toBe(expected);
  });
});

describe('buttonClass', () => {
  it('lets a caller override height without losing the variant', () => {
    const c = buttonClass({ variant: 'primary', className: 'h-[38px]' });
    expect(c).toContain('bg-brand');
    expect(c).toContain('h-[38px]');
    expect(c).not.toMatch(/\bh-10\b/);
  });

  it('defaults to the secondary medium button', () => {
    expect(buttonClass()).toContain('bg-sunk');
    expect(buttonClass()).toContain('h-10');
  });
});

describe('Progress', () => {
  it.each([[-5, '0'], [42.4, '42'], [180, '100']])('clamps %d to %s', (value, now) => {
    render(<Progress value={value} label="p" />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(now);
  });
});

describe('CodeBoxes', () => {
  it('shows typed digits and six boxes', () => {
    const { container } = render(<CodeBoxes digits="307" />);
    const boxes = container.querySelectorAll('[aria-label="6-digit code"] > span');
    expect(boxes).toHaveLength(6);
    expect([...boxes].map(b => b.textContent).join('')).toBe('307');
  });
});
