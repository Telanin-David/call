import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { cn } from './cn';
import { buttonClass } from './Button';
import { Progress } from './Badge';
import { CodeBoxes, CodeInput, Field } from './Form';
import { Modal, Toggle } from './Overlay';
import { QrCode } from './Qr';
import { CallbackAlert } from './Call';

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

describe('Modal', () => {
  it('renders nothing when closed', () => {
    render(<Modal open={false} onClose={() => {}} title="Hidden">x</Modal>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is labelled by its title and closes on Escape and the close button', () => {
    let closed = 0;
    render(<Modal open onClose={() => { closed++; }} title="Move to Free?">body</Modal>);
    expect(screen.getByRole('dialog', { name: 'Move to Free?' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(closed).toBe(2);
  });
});

describe('Toggle', () => {
  it('reports the flipped value', () => {
    const seen: boolean[] = [];
    render(<Toggle checked={false} onChange={v => seen.push(v)} label="Dial 2 at once" />);
    const sw = screen.getByRole('switch', { name: 'Dial 2 at once' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(seen).toEqual([true]);
  });
});

describe('CodeInput', () => {
  it('keeps digits only, at most six, and shows them in the boxes', () => {
    let code = '';
    const { container, rerender } = render(<CodeInput value={code} onChange={v => { code = v; }} />);
    const input = container.querySelector('input')!;
    fireEvent.change(input, { target: { value: '12a 34-5678' } });
    expect(code).toBe('123456');
    rerender(<CodeInput value={code} onChange={v => { code = v; }} />);
    expect(container.textContent).toBe('123456');
    expect(input.getAttribute('autocomplete')).toBe('one-time-code');
  });
});

describe('Field', () => {
  it('shows an error instead of the hint and announces it', () => {
    const { getByRole, queryByText } = render(<Field label="Email" hint="We never share it" error="Enter a valid email address."><input /></Field>);
    expect(getByRole('alert').textContent).toBe('Enter a valid email address.');
    expect(queryByText('We never share it')).toBeNull();
  });
});

describe('QrCode', () => {
  it('draws a labelled code for its value, with a quiet zone', () => {
    render(<QrCode value="https://dialer.app/verify" label="Scan me" size={100} />);
    const svg = screen.getByRole('img', { name: 'Scan me' });
    expect(svg.getAttribute('data-qr')).toBe('https://dialer.app/verify');
    const n = Number(svg.getAttribute('viewBox')?.split(' ')[2]);
    // 25 bytes fit version 2 (25 modules) at level M; 4 modules of quiet zone each side.
    expect(n).toBe(33);
    expect(svg.querySelector('path')?.getAttribute('d')).toMatch(/^M\d+ \d+h1v1h-1z/);
  });
});

describe('CallbackAlert', () => {
  it('names the caller, shows the last note only when there is one, and answers or declines', () => {
    const calls: string[] = [];
    const lead = { name: 'Mark Reyes', initials: 'MR', tone: 'a' as const };
    const { rerender } = render(<CallbackAlert open lead={lead} sub="Reyes Home Care" note="Prices by email."
      onAnswer={() => calls.push('answer')} onLater={() => calls.push('later')} />);
    expect(screen.getByRole('dialog', { name: 'Mark Reyes is calling you back' })).toBeTruthy();
    expect(screen.getByText('Prices by email.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Not now, add to follow-ups' }));
    expect(calls).toEqual(['answer', 'later']);
    rerender(<CallbackAlert open lead={lead} sub="" note="" onAnswer={() => {}} onLater={() => {}} />);
    expect(screen.queryByText('Last note:')).toBeNull();
  });
});
