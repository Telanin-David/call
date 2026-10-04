import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { routes } from './routes';
import { PlanProvider } from '@/lib/plan';
import { fullPhone, problemOf } from '@/lib/forms';
import { ApiError } from '@/lib/api';

// Live mode: the screens talk to an api. Here the api is a table of answers.
type Answer = { status: number; body?: unknown };
let answers: Record<string, Answer>;
let calls: { method: string; path: string; body: unknown }[];

const ME = {
  user_id: 'u1', name: 'Ada Obi', email: 'ada@example.test', phone: '+2348031234567', country: 'NG', timezone: 'Africa/Lagos',
  email_confirmed: true, phone_confirmed: true, confirmed: true, rules_accepted_at: '2026-10-04T00:00:00Z', created_at: '2026-10-04T00:00:00Z',
  plan: 'free', balance_microdollars: 20_000_000, held_microdollars: 0,
};

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', '/api');
  calls = [];
  answers = {};
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace(/^\/api/, '');
    const method = init?.method ?? 'GET';
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const a = answers[`${method} ${path.split('?')[0]}`] ?? { status: 404, body: { code: 'not_found', error: 'Not found' } };
    return new Response(a.status === 204 ? null : JSON.stringify(a.body ?? {}), { status: a.status, headers: { 'Content-Type': 'application/json' } });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PlanProvider>
        <Suspense fallback={null}><RouterProvider router={router} /></Suspense>
      </PlanProvider>
    </QueryClientProvider>,
  );
  return router;
}

describe('live mode', () => {
  it('sends signed-out reps to sign in', async () => {
    answers['GET /me'] = { status: 401, body: { code: 'signed_out', error: 'Sign in to carry on.' } };
    const router = renderAt('/wallet');
    await waitFor(() => expect(router.state.location.pathname).toBe('/signin'));
  });

  it('sends unconfirmed reps to the confirm steps', async () => {
    answers['GET /me'] = { status: 200, body: { ...ME, phone_confirmed: false, confirmed: false } };
    const router = renderAt('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/confirm'));
  });

  it('sign up sends the form and shows the server message under the field', async () => {
    answers['GET /me'] = { status: 401, body: { code: 'signed_out', error: 'Sign in to carry on.' } };
    answers['POST /auth/signup'] = { status: 409, body: { code: 'email_taken', error: 'That email already has an account. Sign in instead.' } };
    renderAt('/signup');
    fireEvent.change(await screen.findByLabelText('Full name'), { target: { value: 'Ada Obi' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.test' } });
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '0803 123 4567' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('That email already has an account. Sign in instead.')).toBeTruthy();
    const sent = calls.find(c => c.path === '/auth/signup')?.body as Record<string, unknown>;
    expect(sent).toMatchObject({ name: 'Ada Obi', phone: '+2348031234567', country: 'NG', accept_rules: true });
  });

  it('the wallet shows the real balance, spending and activity', async () => {
    answers['GET /me'] = { status: 200, body: ME };
    answers['GET /wallet'] = { status: 200, body: {
      balance_microdollars: 9_968_750, held_microdollars: 20_000, next_cursor: '', min_topup_microdollars: 5_000_000, max_topup_microdollars: 500_000_000, topup_provider: 'paystack',
      spent_this_month: { calls: 31_250, plan: 10_000_000, numbers: 0, total: 10_031_250 },
      activity: [
        { id: 'e2', type: 'plan', amount_microdollars: -10_000_000, description: 'Starter plan, first month (intro price)', created_at: '2026-10-04T10:00:00Z' },
        { id: 'e1', type: 'topup', amount_microdollars: 20_000_000, description: 'Top-up, card ending 4242', created_at: '2026-10-04T09:00:00Z' },
      ],
    } };
    renderAt('/wallet');
    expect(await screen.findByText('$9.97')).toBeTruthy();
    expect(screen.getByText('$0.02 held for a call in progress')).toBeTruthy();
    expect(screen.getByText('Card ending 4242')).toBeTruthy();
    expect(screen.getByText('Starter plan, first month (intro price)')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Download statement' }).getAttribute('href')).toBe('/api/wallet/statement');
  });

  it('an upgrade the balance can not cover asks for a top-up first', async () => {
    answers['GET /me'] = { status: 200, body: { ...ME, balance_microdollars: 5_000_000 } };
    answers['GET /plans'] = { status: 200, body: { intro_eligible: true, plans: [
      { id: 'free', monthly_fee_microdollars: 0, intro_fee_microdollars: 0, intro_months: 0, rate_multiplier_pct: 250, us_price_per_minute_microdollars: 25_000, dials_per_day: 30, features: [] },
      { id: 'starter', monthly_fee_microdollars: 15_000_000, intro_fee_microdollars: 10_000_000, intro_months: 3, rate_multiplier_pct: 200, us_price_per_minute_microdollars: 20_000, dials_per_day: 120, features: [] },
      { id: 'pro', monthly_fee_microdollars: 35_000_000, intro_fee_microdollars: 21_000_000, intro_months: 3, rate_multiplier_pct: 170, us_price_per_minute_microdollars: 17_000, dials_per_day: null, features: [] },
    ] } };
    answers['GET /subscription'] = { status: 200, body: { plan: 'free' } };
    answers['POST /subscription/quote'] = { status: 200, body: {
      from: 'free', to: 'starter', kind: 'upgrade', due_today_microdollars: 10_000_000, intro_price: true, starts_on: '2026-10-04',
      next_renewal: '2026-11-04', next_charge_microdollars: 10_000_000, balance_microdollars: 5_000_000, balance_after_microdollars: -5_000_000,
    } };
    renderAt('/plans');
    fireEvent.click(await screen.findByRole('button', { name: 'Move to Starter' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Starter' }));
    expect(await screen.findByText(/Add \$5\.00 to your balance first/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /and upgrade/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(calls.some(c => c.method === 'POST' && c.path === '/subscription')).toBe(false);
  });
});

describe('form helpers', () => {
  it.each([
    ['0803 123 4567', '234', '+2348031234567'],
    ['803-123-4567', '234', '+2348031234567'],
    ['(415) 555 0100', '1', '+14155550100'],
    ['+44 20 7946 0958', '234', '+44 20 7946 0958'],
  ])('fullPhone(%s, +%s) = %s', (national, dial, want) => {
    expect(fullPhone(national, dial)).toBe(want);
  });

  it('places api errors under the right field', () => {
    expect(problemOf(new ApiError(409, 'phone_taken', 'Taken'))).toEqual({ field: 'phone', message: 'Taken' });
    expect(problemOf(new ApiError(429, 'too_many', 'Wait'))).toEqual({ field: undefined, message: 'Wait' });
    expect(problemOf(new Error('boom'))?.message).toBe('Something went wrong. Try again.');
    expect(problemOf(null)).toBeNull();
  });
});
