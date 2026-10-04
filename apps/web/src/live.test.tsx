import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { routes } from './routes';
import { PlanProvider } from '@/lib/plan';
import { fullPhone, problemOf } from '@/lib/forms';
import { ApiError } from '@/lib/api';
import { leftOutLine, listNameFromFile, readCsvFile, remap } from '@/lib/leads';
import { freshName, partsFromText } from '@/lib/scripts';
import { prettyNumber } from '@/lib/numbers';
import { callCost, callLength, initialsOf, relative, talkTime } from '@/lib/activity';
import { renderScript } from '@/lib/script';
import { callbackAt, callbackLabel, costOf } from '@/lib/calling';
import { callerLine, type IncomingCall } from '@/lib/incoming';

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

describe('live leads', () => {
  const CHECK = {
    columns: [
      { header: 'Name', sample: 'Lena Park', field: 'full_name' },
      { header: 'Phone', sample: '(646) 555-0110', field: 'phone' },
      { header: 'Business', sample: 'Sparkle Offices', field: 'company' },
    ],
    rows: 4, ready: 2, abroad: 1,
    left_out: { invalid: 0, premium: 0, duplicate: 1, dnc: 0, listed: 0, abroad: 1 },
    left_out_rows: [
      { row: 4, name: 'Kofi Asante', phone: '+233 24 555 0190', reason: 'abroad', same_as_row: null, list_name: null },
      { row: 5, name: 'Lena Park', phone: '646.555.0110', reason: 'duplicate', same_as_row: 2, list_name: null },
    ],
    problem: null,
  };
  const LIST = { id: 'l1', name: 'October leads', region: 'us_ca', status: 'active', lead_count: 40, called_count: 10, followup_count: 3, script: null, created_at: '2026-10-04T09:00:00Z' };

  it('the lists page shows the real lists, and an empty state', async () => {
    answers['GET /me'] = { status: 200, body: ME };
    answers['GET /lists'] = { status: 200, body: { lists: [LIST] } };
    renderAt('/leads');
    expect(await screen.findByText('October leads')).toBeTruthy();
    expect(screen.getByText('30 left')).toBeTruthy();
    expect(screen.getByText('In use')).toBeTruthy();
    expect(screen.getAllByText(/No script yet/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Dental offices NY')).toBeNull();
    cleanup();

    answers['GET /lists'] = { status: 200, body: { lists: [] } };
    renderAt('/leads');
    expect(await screen.findByText('No lists yet')).toBeTruthy();
  });

  it('upload checks the file, lets the rep fix columns, then adds the list', async () => {
    answers['GET /me'] = { status: 200, body: ME };
    answers['POST /imports/check'] = { status: 200, body: CHECK };
    answers['POST /imports'] = { status: 201, body: { lists: [{ ...LIST, called_count: 0, status: 'new', lead_count: 2 }] } };
    answers['GET /lists'] = { status: 200, body: { lists: [] } };
    const router = renderAt('/leads/upload');
    await screen.findByRole('button', { name: 'Choose file' });
    const csv = 'Name,Phone,Business\nLena Park,(646) 555-0110,Sparkle Offices\n';
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([csv], 'october-leads.csv', { type: 'text/csv' })] } });

    expect(await screen.findByText('october-leads.csv')).toBeTruthy();
    expect(calls.find(c => c.path === '/imports/check')?.body).toEqual({ csv });
    expect(screen.getByText('4 rows · 3 columns')).toBeTruthy();
    expect(screen.getByText('2 rows left out')).toBeTruthy();
    expect(screen.getByText('1 not US or Canada')).toBeTruthy();
    expect((screen.getByLabelText('List name') as HTMLInputElement).value).toBe('October leads');

    // Picking Phone for the Business column moves it off the Phone column.
    fireEvent.change(screen.getByLabelText('Save Business as'), { target: { value: 'phone' } });
    await waitFor(() => expect(calls.filter(c => c.path === '/imports/check')).toHaveLength(2));
    expect(calls.at(-1)?.body).toEqual({ csv, mapping: ['full_name', 'skip', 'phone'] });
    fireEvent.change(screen.getByLabelText('Save Business as'), { target: { value: 'company' } });
    fireEvent.change(screen.getByLabelText('Save Phone as'), { target: { value: 'phone' } });

    fireEvent.change(screen.getByLabelText('List name'), { target: { value: 'Dentists' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Add 2 leads' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/leads'));
    expect(calls.find(c => c.method === 'POST' && c.path === '/imports')?.body).toEqual({ csv, mapping: ['full_name', 'phone', 'company'], name: 'Dentists' });
  });

  it('shows why a file was refused and what to fix in the columns', async () => {
    answers['GET /me'] = { status: 200, body: ME };
    answers['POST /imports/check'] = { status: 422, body: { code: 'empty_file', error: 'That file has no leads in it.' } };
    renderAt('/leads/upload');
    await screen.findByRole('button', { name: 'Choose file' });
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['Name\n'], 'empty.csv')] } });
    expect(await screen.findByText('That file has no leads in it.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose another file' })).toBeTruthy();

    answers['POST /imports/check'] = { status: 200, body: {
      ...CHECK, ready: 0, abroad: 0, columns: CHECK.columns.map(c => ({ ...c, field: c.field === 'phone' ? 'skip' : c.field })),
      left_out: { ...CHECK.left_out, duplicate: 0, abroad: 0 }, left_out_rows: [],
      problem: { code: 'no_phone_column', error: 'Pick the column with the phone numbers.' },
    } };
    fireEvent.change(input, { target: { files: [new File(['Name,Phone\nLena,6465550110\n'], 'leads.csv')] } });
    expect(await screen.findByText('Pick the column with the phone numbers.')).toBeTruthy();
    expect((screen.getByRole('button', { name: /^Add/ }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('a new file shows its own columns, not the last file\'s', async () => {
    answers['GET /me'] = { status: 200, body: ME };
    answers['POST /imports/check'] = { status: 200, body: CHECK };
    renderAt('/leads/upload');
    await screen.findByRole('button', { name: 'Choose file' });
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['Name,Phone,Business\nA,6465550110,B\n'], 'first.csv')] } });
    expect(await screen.findByLabelText('Save Business as')).toBeTruthy();

    answers['POST /imports/check'] = { status: 200, body: { ...CHECK, columns: [{ header: 'Mobile', sample: '2125550188', field: 'phone' }] } };
    fireEvent.click(screen.getByRole('button', { name: 'Change file' }));
    fireEvent.change(input, { target: { files: [new File(['Mobile\n2125550188\n'], 'second.csv')] } });
    expect(await screen.findByLabelText('Save Mobile as')).toBeTruthy();
    expect(screen.queryByLabelText('Save Business as')).toBeNull();
    expect(screen.getByText('second.csv')).toBeTruthy();
  });
});

describe('live scripts', () => {
  const V2 = {
    id: 's2', name: 'Office cleaning v2', updated_at: '2026-10-04T09:00:00Z',
    parts: [{ title: 'Opening', body: 'Hi {first_name}, this is Tunde.' }],
    lists: [{ id: 'l1', name: 'October leads' }],
  };
  const LISTS = [
    { id: 'l1', name: 'October leads', region: 'us_ca', status: 'new', lead_count: 4, called_count: 0, followup_count: 0, script: { id: 's2', name: 'Office cleaning v2' }, created_at: '2026-10-04T09:00:00Z' },
    { id: 'l2', name: 'Dental offices', region: 'us_ca', status: 'new', lead_count: 9, called_count: 0, followup_count: 0, script: null, created_at: '2026-10-04T09:05:00Z' },
  ];

  it('loads saved scripts and saves changes with the lists that use them', async () => {
    answers['GET /me'] = { status: 200, body: ME };
    answers['GET /scripts'] = { status: 200, body: { scripts: [V2], fields: ['first_name', 'company', 'city', 'her_time'], on_screen_free_until: '2026-12-04' } };
    answers['GET /lists'] = { status: 200, body: { lists: LISTS } };
    answers['PUT /scripts/s2'] = { status: 200, body: { ...V2, name: 'Office cleaning v3', lists: [{ id: 'l1', name: 'October leads' }, { id: 'l2', name: 'Dental offices' }] } };
    renderAt('/scripts');
    expect(await screen.findByText('In use · October leads')).toBeTruthy();
    expect(screen.getByText(/shows on screen until 4 Dec/)).toBeTruthy();
    const october = screen.getByRole('checkbox', { name: /October leads/ }) as HTMLInputElement;
    const dental = screen.getByRole('checkbox', { name: /Dental offices/ }) as HTMLInputElement;
    expect(october.checked).toBe(true);
    expect(dental.checked).toBe(false);

    fireEvent.change(screen.getByLabelText('Script name'), { target: { value: 'Office cleaning v3' } });
    fireEvent.click(dental);
    expect(screen.getByText('Changes not saved')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save script' }));
    expect(await screen.findByText('Office cleaning v3 saved')).toBeTruthy();
    expect(calls.find(c => c.method === 'PUT')?.body).toEqual({ name: 'Office cleaning v3', parts: V2.parts, list_ids: ['l1', 'l2'] });
    expect(await screen.findByText('In use · October leads, Dental offices')).toBeTruthy();
  });

  it('a first script starts blank, uses the lists without a script, and shows server errors', async () => {
    answers['GET /me'] = { status: 200, body: ME };
    answers['GET /scripts'] = { status: 200, body: { scripts: [], fields: [], on_screen_free_until: null } };
    answers['GET /lists'] = { status: 200, body: { lists: LISTS } };
    answers['POST /scripts'] = { status: 422, body: { code: 'unknown_field', error: "{firstname} isn't a detail we can fill in." } };
    renderAt('/scripts');
    expect(await screen.findByText('Not saved yet')).toBeTruthy();
    expect((screen.getByLabelText('Script name') as HTMLInputElement).value).toBe('New script');
    expect((screen.getByRole('checkbox', { name: /Dental offices/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/uses Office cleaning v2/)).toBeTruthy();
    expect(screen.getByText(/always shows on screen/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Tap to write this part' }));
    fireEvent.change(screen.getByLabelText('Opening text'), { target: { value: 'Hi {firstname}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save script' }));
    expect(await screen.findByText("{firstname} isn't a detail we can fill in.")).toBeTruthy();
    expect(calls.find(c => c.method === 'POST' && c.path === '/scripts')?.body).toEqual({
      name: 'New script', parts: [{ title: 'Opening', body: 'Hi {firstname}' }], list_ids: ['l2'],
    });
  });

  it('deletes a script after asking', async () => {
    answers['GET /me'] = { status: 200, body: ME };
    answers['GET /scripts'] = { status: 200, body: { scripts: [V2], fields: [], on_screen_free_until: null } };
    answers['GET /lists'] = { status: 200, body: { lists: LISTS } };
    answers['DELETE /scripts/s2'] = { status: 204 };
    renderAt('/scripts');
    fireEvent.click(await screen.findByRole('button', { name: 'Delete script' }));
    expect(screen.getByText('Lists that use it will have no script until you pick another.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Office cleaning v2 deleted')).toBeTruthy();
    expect(calls.some(c => c.method === 'DELETE' && c.path === '/scripts/s2')).toBe(true);
    expect(screen.getByText('Not saved yet')).toBeTruthy();
  });
});

describe('live numbers', () => {
  const SEARCH = { monthly_price_microdollars: 1_500_000, numbers: [
    { number: '+16465550142', city: 'New York, NY' },
    { number: '+16465550149', city: 'New York, NY' },
  ] };
  const RENTED = {
    id: 'n1', number: '+16465550149', city: 'New York, NY', country: 'US', is_default: true, monthly_price_microdollars: 1_500_000,
    renews_on: '2026-11-04', cancel_on: null, renewal_failed_at: null, created_at: '2026-10-04T10:00:00Z',
  };

  it('searches an area code and rents the picked number', async () => {
    answers['GET /me'] = { status: 200, body: ME };
    answers['GET /numbers/available'] = { status: 200, body: SEARCH };
    answers['POST /numbers'] = { status: 201, body: RENTED };
    answers['GET /numbers'] = { status: 200, body: { numbers: [RENTED], monthly_total_microdollars: 1_500_000, monthly_price_microdollars: 1_500_000, max_numbers: 20 } };
    const router = renderAt('/numbers?from=settings');
    expect((await screen.findAllByText('+1 (646) 555-0142')).length).toBe(2); // in the list and the card
    expect(calls.find(c => c.path.startsWith('/numbers/available'))?.path).toBe('/numbers/available?country=US&area_code=646');
    expect(screen.getByText('$18.50')).toBeTruthy(); // balance after: $20.00 - $1.50
    fireEvent.click(screen.getByRole('radio', { name: /555-0149/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Rent for $1.50' }));
    await waitFor(() => expect(router.state.location.search).toBe('?tab=numbers'));
    expect(calls.find(c => c.method === 'POST' && c.path === '/numbers')?.body).toEqual({ number: '+16465550149', city: 'New York, NY', country: 'US' });
  });

  it('asks for a top-up first when the balance is short, and shows server errors', async () => {
    answers['GET /me'] = { status: 200, body: { ...ME, balance_microdollars: 1_000_000 } };
    answers['GET /numbers/available'] = { status: 200, body: SEARCH };
    renderAt('/numbers');
    expect(await screen.findByText(/Add \$0\.50 to your balance first/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Rent for $1.50' }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();

    answers['GET /me'] = { status: 200, body: ME };
    answers['POST /numbers'] = { status: 409, body: { code: 'number_gone', error: 'Someone just took that number. Pick another one.' } };
    renderAt('/numbers');
    const rent = await screen.findByRole('button', { name: 'Rent for $1.50' }) as HTMLButtonElement;
    await waitFor(() => expect(rent.disabled).toBe(false));
    fireEvent.click(rent);
    expect(await screen.findByText('Someone just took that number. Pick another one.')).toBeTruthy();
  });

  it('settings lists numbers and cancels, keeps and sets the default', async () => {
    const second = { ...RENTED, id: 'n2', number: '+13125550187', city: 'Chicago, IL', is_default: false, renews_on: '2026-11-09' };
    answers['GET /me'] = { status: 200, body: ME };
    answers['GET /subscription'] = { status: 200, body: { plan: 'free' } };
    answers['GET /plans'] = { status: 200, body: { plans: [] } };
    answers['GET /numbers'] = { status: 200, body: { numbers: [RENTED, second], monthly_total_microdollars: 3_000_000, monthly_price_microdollars: 1_500_000, max_numbers: 20 } };
    answers['DELETE /numbers/n2'] = { status: 200, body: { ...second, cancel_on: '2026-11-09' } };
    answers['PUT /numbers/n2/default'] = { status: 200, body: { ...second, is_default: true } };
    renderAt('/settings?tab=numbers');
    expect(await screen.findByText('2 numbers · $3.00 a month')).toBeTruthy();
    expect(screen.getByText('New York, NY · default · renews 4 Nov · $1.50')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Make default' }));
    expect(await screen.findByText('+1 (312) 555-0187 is your default now')).toBeTruthy();
    expect(calls.some(c => c.method === 'PUT' && c.path === '/numbers/n2/default')).toBe(true);

    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[1] as HTMLElement);
    expect(screen.getByText(/You keep it until 8 Nov, the end of the month you paid for/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel number' }));
    expect(await screen.findByText(/cancelled\. It's yours until 8 Nov/)).toBeTruthy();
    expect(calls.some(c => c.method === 'DELETE' && c.path === '/numbers/n2')).toBe(true);
  });

  it('formats numbers', () => {
    expect(prettyNumber('+16465550142')).toBe('+1 (646) 555-0142');
    expect(prettyNumber('+442079460958')).toBe('+442079460958');
  });
});

describe('live activity', () => {
  const LENA = { id: 'l1', name: 'Lena Park', company: 'Sparkle Offices', phone: '+16465550110', her_time_zone: 'America/New_York' };
  const FOLLOWUP = { id: 'f1', lead: LENA, due_at: new Date(Date.now() + 2 * 3600_000).toISOString(), reason: 'Asked for a call back', last_note: 'After 3 pm her time', last_outcome: 'callback' };
  const TOTALS = { calls: 0, talk_seconds: 0, spent_microdollars: 0, interested: 0 };

  it('Today shows the real day, the list to call and follow-ups due', async () => {
    answers['GET /me'] = { status: 200, body: ME };
    answers['GET /numbers'] = { status: 200, body: { numbers: [], monthly_total_microdollars: 0, monthly_price_microdollars: 1_500_000, max_numbers: 20 } };
    answers['GET /today'] = { status: 200, body: {
      dials_today: 12, dial_limit: 30, today: { calls: 12, talk_seconds: 6720, spent_microdollars: 2_240_000, interested: 2 },
      yesterday: { ...TOTALS, calls: 86, interested: 6 }, followups_due: 1, due: [FOLLOWUP],
      ready_list: { id: 'list1', name: 'October leads', left: 37, script_name: 'Office cleaning v2' },
    } };
    const router = renderAt('/');
    expect(await screen.findByText('October leads')).toBeTruthy();
    expect(screen.getByText('37 left · script: Office cleaning v2')).toBeTruthy();
    expect(screen.getByText('1h 52m')).toBeTruthy();
    expect(screen.getByText('$2.24')).toBeTruthy();
    expect(screen.getByText(/Sparkle Offices · \d+:\d\d (am|pm) their time/)).toBeTruthy();
    expect(screen.getByText('No number yet')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /^Good (morning|afternoon|evening), Ada$/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start calling' }));
    await waitFor(() => expect(router.state.location.search).toBe('?list=list1'));
  });

  it('Today with nothing to call offers an upload', async () => {
    answers['GET /me'] = { status: 200, body: ME };
    answers['GET /today'] = { status: 200, body: { dials_today: 0, dial_limit: null, today: TOTALS, yesterday: TOTALS, followups_due: 0, due: [], ready_list: null } };
    renderAt('/');
    expect(await screen.findByText('No leads to call')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload a list' })).toBeTruthy();
    expect(screen.getByText(/Nothing due today/)).toBeTruthy();
  });

  it('Follow-ups shows tabs with counts and switches tabs', async () => {
    answers['GET /me'] = { status: 200, body: ME };
    answers['GET /followups'] = { status: 200, body: { counts: { today: 1, tomorrow: 0, week: 2, later: 0 }, followups: [FOLLOWUP] } };
    renderAt('/followups');
    expect(await screen.findByText('Lena Park')).toBeTruthy();
    expect(screen.getByText('After 3 pm her time')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Call all 1 in order/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /This week/ }));
    await waitFor(() => expect(calls.some(c => c.path === '/followups?tab=week')).toBe(true));
  });

  it('History lists real calls, filters on the server and pages', async () => {
    answers['GET /me'] = { status: 200, body: ME };
    const call = { id: 'c1', lead: LENA, to: '+16465550110', started_at: new Date().toISOString(), seconds: 252, cost_microdollars: 105_000, outcome: 'interested', note: '' };
    answers['GET /history'] = { status: 200, body: { calls: [call, { ...call, id: 'c2', lead: null, outcome: null, seconds: 31 }], next_cursor: 'abc', week: { calls: 412, talk_seconds: 34800, spent_microdollars: 11_600_000, interested: 3 } } };
    renderAt('/history');
    expect(await screen.findByText('Lena Park')).toBeTruthy();
    expect(screen.getByText('4:12')).toBeTruthy();
    expect(screen.getByText('412 calls')).toBeTruthy();
    expect(screen.getAllByText('+1 (646) 555-0110').length).toBeGreaterThan(0); // a call without a lead shows the number
    expect(screen.getByText('No result')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show more calls' }));
    await waitFor(() => expect(calls.some(c => c.path === '/history?cursor=abc')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Interested' }));
    await waitFor(() => expect(calls.some(c => c.path === '/history?outcome=interested')).toBe(true));
  });

  it('Setup ticks off what the rep has done', async () => {
    answers['GET /me'] = { status: 200, body: ME };
    answers['GET /wallet'] = { status: 200, body: { balance_microdollars: 10_000_000, held_microdollars: 0, activity: [], next_cursor: '', spent_this_month: { calls: 0, plan: 0, numbers: 0, total: 0 }, min_topup_microdollars: 5_000_000, max_topup_microdollars: 500_000_000, topup_provider: 'paystack' } };
    answers['GET /numbers'] = { status: 200, body: { numbers: [{ id: 'n1' }], monthly_total_microdollars: 1_500_000, monthly_price_microdollars: 1_500_000, max_numbers: 20 } };
    answers['GET /lists'] = { status: 200, body: { lists: [] } };
    answers['GET /scripts'] = { status: 200, body: { scripts: [], fields: [], on_screen_free_until: null } };
    const router = renderAt('/setup');
    expect(await screen.findByText('4 of 6 done')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Upload leads' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/leads/upload'));
  });

  it('formats talk time, call length, initials and relative times', () => {
    expect(talkTime(6720)).toBe('1h 52m');
    expect(talkTime(29)).toBe('29s');
    expect(talkTime(0)).toBe('0m');
    expect(callCost(1_667)).toBe('<$0.01');
    expect(callCost(0)).toBe('$0.00');
    expect(callCost(52_084)).toBe('$0.05');
    expect(callLength(252)).toBe('4:12');
    expect(initialsOf('Lena Park')).toBe('LP');
    expect(initialsOf('Sparkle')).toBe('SP');
    const now = new Date('2026-10-04T12:00:00Z');
    expect(relative('2026-10-04T14:00:00Z', now)).toBe('in 2 h');
    expect(relative('2026-10-04T11:45:00Z', now)).toBe('15 min ago');
  });
});

describe('script helpers', () => {
  it('names new scripts so they never clash', () => {
    expect(freshName([])).toBe('New script');
    expect(freshName(['new script', 'New script 2'])).toBe('New script 3');
  });

  it('splits pasted text into parts at blank lines', () => {
    expect(partsFromText('Hi {first_name}.\r\n\r\n  \nWhy I call.\nSecond line.\n\n')).toEqual([
      { title: 'Part 1', body: 'Hi {first_name}.' },
      { title: 'Part 2', body: 'Why I call.\nSecond line.' },
    ]);
  });

  it('fills known words and leaves unknown ones as written', () => {
    const { container } = render(<p>{renderScript('Hi {first_name} at {firm}.', t => t.toUpperCase())}</p>);
    expect(container.textContent).toBe('Hi FIRST_NAME at {firm}.');
  });
});

describe('lead helpers', () => {
  it('remap keeps each field on one column', () => {
    expect(remap(['first_name', 'phone', 'skip'], 2, 'phone')).toEqual(['first_name', 'skip', 'phone']);
    expect(remap(['first_name', 'last_name', 'phone'], 0, 'full_name')).toEqual(['full_name', 'skip', 'phone']);
    expect(remap(['full_name', 'skip', 'phone'], 1, 'last_name')).toEqual(['skip', 'last_name', 'phone']);
    expect(remap(['skip', 'skip', 'phone'], 0, 'skip')).toEqual(['skip', 'skip', 'phone']);
  });

  it('names a list after its file', () => {
    expect(listNameFromFile('october-leads.csv')).toBe('October leads');
    expect(listNameFromFile('dental_offices__NY.CSV')).toBe('Dental offices NY');
    expect(listNameFromFile('.csv')).toBe('New list');
  });

  it('reads Excel files saved as Windows Latin-1', async () => {
    const latin1 = new Blob([new Uint8Array([0x5a, 0x6f, 0xeb])]); // "Zoë"
    expect(await readCsvFile(latin1)).toBe('Zoë');
    expect(await readCsvFile(new Blob(['Zoë']))).toBe('Zoë');
    await expect(readCsvFile(new Blob([new Uint8Array(3 << 20)]))).rejects.toThrow(/too big/);
  });

  it('says why a row was left out', () => {
    expect(leftOutLine({ row: 23, name: 'Lena Park', phone: '(646) 555-0110', reason: 'duplicate', same_as_row: 4, list_name: null }))
      .toBe('Row 23 · Lena Park · (646) 555-0110 · duplicate of row 4');
    expect(leftOutLine({ row: 9, name: '', phone: '', reason: 'invalid', same_as_row: null, list_name: null })).toBe('Row 9 · no phone number');
    expect(leftOutLine({ row: 3, name: 'Tom', phone: '917-555-0142', reason: 'listed', same_as_row: null, list_name: 'September' }))
      .toBe('Row 3 · Tom · 917-555-0142 · already in September');
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

describe('live calling', () => {
  const LEAD = (id: string, name: string, phone: string, zone: string, extra: Record<string, unknown> = {}) => ({
    id, name, first_name: name.split(' ')[0], company: `${name.split(' ')[1]} Co`, city: 'Brooklyn', email: '', phone, notes: '',
    her_time_zone: zone, attempts: 0, list_name: 'October leads', script_id: 's1', last_call: null, ...extra,
  });
  const QUEUE = {
    title: 'October leads', list_id: 'l1', script_free_until: '2026-12-04', dials_today: 3, dial_limit: 30,
    balance_microdollars: 13_990_000, price_per_minute_microdollars: 25_000, live_call_id: null,
    scripts: [{ id: 's1', name: 'Office cleaning', parts: [{ title: 'Open', body: 'Hi {first_name}, is now ok at {her_time}?' }] }],
    leads: [LEAD('ray', 'Ray Cole', '+12135550101', 'America/Los_Angeles'), LEAD('kim', 'Kim Park', '+16465550102', 'America/New_York')],
  };
  const CALL = { id: 'c1', lead_id: 'kim', from: '+16465550000', to: '+16465550102', price_per_minute_microdollars: 25_000,
    started_at: '2026-10-04T13:00:00Z', ended_at: null, seconds: 0, cost_microdollars: 0, low_balance: false, outcome: null, note: '' };

  beforeEach(() => {
    answers['GET /me'] = { status: 200, body: ME };
    answers['GET /queue'] = { status: 200, body: QUEUE };
  });

  it('shows the list, the script filled in, and the server\'s reason when a call is refused', async () => {
    answers['POST /calls'] = { status: 403, body: {
      code: 'calling_hours', error: 'Call between 8 am and 9 pm their time. Try the next lead.', title: "It's 5:54 am for Ray Cole", action: 'skip',
    } };
    renderAt('/call?list=l1');
    expect(await screen.findByRole('heading', { name: 'Ray Cole' })).toBeTruthy();
    expect(calls.some(c => c.path === '/queue?list=l1')).toBe(true);
    expect(screen.getByText('YOUR SCRIPT · OFFICE CLEANING')).toBeTruthy();
    expect(screen.getByText('Free until 4 Dec')).toBeTruthy();
    expect(screen.getByText('US rate $0.025 / min')).toBeTruthy();
    expect(screen.getByText('$13.99')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Call Ray/ }));
    expect(await screen.findByText("It's 5:54 am for Ray Cole")).toBeTruthy();
    expect(calls.find(c => c.method === 'POST' && c.path === '/calls')?.body).toEqual({ lead_id: 'ray', via: 'laptop' });
    fireEvent.click(screen.getByRole('button', { name: 'Skip to next lead' }));
    expect(await screen.findByText('Too early or late · skipped')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Kim Park' })).toBeTruthy();
  });

  it('calls, shows the live call, saves the result on hang up, and Undo changes it', async () => {
    answers['POST /calls'] = { status: 201, body: {
      call_id: 'c1', lead_id: 'kim', lead_name: 'Kim Park', from: '+16465550000', to: '+16465550102', price_per_minute_microdollars: 25_000,
      held_microdollars: 25_000, token: 't', client_state: 'x', her_time_zone: 'America/New_York', phone: 'fake',
    } };
    answers['POST /dev/calls/c1/events/initiated'] = { status: 200, body: { ...CALL, status: 'ringing', answered_at: null } };
    answers['GET /calls/c1'] = { status: 200, body: { ...CALL, status: 'answered', answered_at: '2026-10-04T13:00:03Z' } };
    const ended = { ...CALL, status: 'ended', answered_at: '2026-10-04T13:00:03Z', ended_at: '2026-10-04T13:00:08Z', seconds: 5, cost_microdollars: 2084 };
    answers['POST /calls/c1/hangup'] = { status: 200, body: ended };
    answers['POST /calls/c1/outcome'] = { status: 200, body: { ...ended, outcome: 'interested' } };
    answers['GET /queue'] = { status: 200, body: { ...QUEUE, list_id: null, leads: [QUEUE.leads[1]] } };
    renderAt('/call/kim');
    expect(await screen.findByRole('heading', { name: 'Kim Park' })).toBeTruthy();
    expect(calls.some(c => c.path === '/queue?lead=kim')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^Call Kim/ }));
    expect(await screen.findByText('CONNECTED')).toBeTruthy();
    expect(calls.some(c => c.path === '/dev/calls/c1/events/initiated')).toBe(true);
    expect(screen.getByRole('button', { name: 'They hang up' })).toBeTruthy();

    fireEvent.keyDown(window, { key: '1' });
    fireEvent.click(screen.getByRole('button', { name: /^Hang up/ }));
    expect(await screen.findByText('Saved: Interested · Kim Park')).toBeTruthy();
    expect(calls.find(c => c.path === '/calls/c1/outcome')?.body).toEqual({ outcome: 'interested', note: '' });
    expect(await screen.findByText('Your list is done')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('CALL ENDED')).toBeTruthy();
    expect(screen.getByText('Call ended after 0:05.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Call back' }));
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'After 3 pm' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.filter(c => c.path === '/calls/c1/outcome')).toHaveLength(2));
    const again = calls.filter(c => c.path === '/calls/c1/outcome')[1]?.body as { outcome: string; note: string; follow_up_at: string };
    expect(again.outcome).toBe('callback');
    expect(again.note).toBe('After 3 pm');
    const inHours = (new Date(again.follow_up_at).getTime() - Date.now()) / 3_600_000;
    expect(inHours).toBeGreaterThan(23);
    expect(inHours).toBeLessThan(25);
  });

  it('offers to end a call left open from before', async () => {
    answers['GET /queue'] = { status: 200, body: { ...QUEUE, live_call_id: 'old' } };
    answers['POST /calls/old/hangup'] = { status: 200, body: { ...CALL, id: 'old', status: 'ended', answered_at: null } };
    renderAt('/call?list=l1');
    fireEvent.click(await screen.findByRole('button', { name: 'End that call' }));
    await waitFor(() => expect(calls.some(c => c.method === 'POST' && c.path === '/calls/old/hangup')).toBe(true));
  });

  it('works out when a call back lands', () => {
    const now = new Date('2026-10-04T13:00:00Z');
    expect(callbackAt('Tomorrow', now).toISOString()).toBe('2026-10-05T13:00:00.000Z');
    expect(callbackAt('Next week', now).toISOString()).toBe('2026-10-11T13:00:00.000Z');
    expect(callbackAt('2026-10-09', now).getDate()).toBe(9);
    expect(callbackAt('2026-01-01', now).getTime()).toBeGreaterThan(now.getTime());
    expect(callbackLabel('2026-10-09')).toBe('Fri 9 Oct');
    expect(callbackLabel('Tomorrow')).toBe('Tomorrow');
    expect(costOf(25_000, 5)).toBe(2084);
  });
});

describe('live ID check', () => {
  const V = { status: 'none', id_type: '', country: '', reason: '', submitted_at: null, decided_at: null };
  beforeEach(() => { answers['GET /me'] = { status: 200, body: { ...ME, plan: 'starter', country: 'NG' } }; });

  it('starts with the ID choice, the rep\'s name and a code for the phone', async () => {
    answers['GET /verification'] = { status: 200, body: V };
    renderAt('/verify');
    expect(await screen.findByText('Ada Obi')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ghana Card' })).toBeTruthy();
    const qr = screen.getByRole('img', { name: 'Code to open the ID check on your phone' });
    expect(qr.getAttribute('data-qr')).toMatch(/\/verify$/);
  });

  it('after a failed check says why and lets the rep try again', async () => {
    answers['GET /verification'] = { status: 200, body: { ...V, status: 'rejected', reason: 'Document not verified', submitted_at: '2026-10-04T12:00:00Z' } };
    renderAt('/verify');
    expect(await screen.findByText(/Your last check didn't pass \(Document not verified\)/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Take a photo of it|Start on this laptop|Use this laptop instead/ }).length).toBeGreaterThan(0);
  });

  it('shows a check in progress, by hand, and done', async () => {
    answers['GET /verification'] = { status: 200, body: { ...V, status: 'pending', submitted_at: '2026-10-04T12:00:00Z' } };
    renderAt('/verify');
    expect(await screen.findByText("We're checking your ID")).toBeTruthy();
    answers['POST /dev/verification/approve'] = { status: 200, body: { ...V, status: 'approved', submitted_at: '2026-10-04T12:00:00Z', decided_at: '2026-10-04T12:05:00Z' } };
    fireEvent.click(screen.getByRole('button', { name: 'Pass it' }));
    expect(await screen.findByText('Your ID is verified')).toBeTruthy();
    cleanup();

    answers['GET /verification'] = { status: 200, body: { ...V, status: 'review', submitted_at: '2026-10-04T12:00:00Z' } };
    renderAt('/verify');
    expect(await screen.findByText("We're checking your ID by hand")).toBeTruthy();
    expect(screen.getByText(/doesn't match Ada Obi/)).toBeTruthy();
  });

  it('Settings shows the real status', async () => {
    answers['GET /verification'] = { status: 200, body: { ...V, status: 'approved' } };
    renderAt('/settings?tab=verify');
    expect(await screen.findByText('Verified · new account limits are off')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Verify my ID' })).toBeNull();
  });
});

describe('live auto-dial', () => {
  const LEAD = (id: string, name: string, phone: string) => ({
    id, name, first_name: name.split(' ')[0], company: '', city: '', email: '', phone, notes: '',
    her_time_zone: 'America/New_York', attempts: 0, list_name: 'October leads', script_id: null, last_call: null,
  });
  const QUEUE = {
    title: 'October leads', list_id: 'l1', script_free_until: null, dials_today: 3, dial_limit: 120,
    balance_microdollars: 13_990_000, price_per_minute_microdollars: 20_000, live_call_id: null, scripts: [],
    leads: [LEAD('ray', 'Ray Cole', '+18085550101'), LEAD('kim', 'Kim Park', '+16465550102'), LEAD('lou', 'Lou Ray', '+16465550103')],
  };
  const STARTED = { call_id: 'c1', lead_id: 'kim', lead_name: 'Kim Park', from: '+16465550000', to: '+16465550102', price_per_minute_microdollars: 20_000,
    held_microdollars: 20_000, token: 't', client_state: 'x', her_time_zone: 'America/New_York', phone: 'fake' };
  const CALL = { id: 'c1', lead_id: 'kim', from: '+16465550000', to: '+16465550102', price_per_minute_microdollars: 20_000,
    started_at: '2026-10-04T13:00:00Z', low_balance: false, outcome: null, note: '' };
  const ENDED = { ...CALL, status: 'ended', answered_at: '2026-10-04T13:00:03Z', ended_at: '2026-10-04T13:00:08Z', seconds: 5, cost_microdollars: 1667 };

  beforeEach(() => {
    window.localStorage.setItem('dialer.autodialGap', '3');
    answers['GET /me'] = { status: 200, body: { ...ME, plan: 'starter' } };
    answers['GET /queue'] = { status: 200, body: QUEUE };
    answers['POST /dev/calls/c1/events/initiated'] = { status: 200, body: { ...CALL, status: 'ringing', answered_at: null } };
    answers['GET /calls/c1'] = { status: 200, body: { ...CALL, status: 'answered', answered_at: '2026-10-04T13:00:03Z', ended_at: null, seconds: 0, cost_microdollars: 0 } };
    answers['POST /calls/c1/hangup'] = { status: 200, body: ENDED };
    answers['POST /calls/c1/outcome'] = { status: 200, body: { ...ENDED, outcome: 'interested' } };
    // The first lead is out of calling hours; every call after that starts.
    let dials = 0;
    Object.defineProperty(answers, 'POST /calls', {
      configurable: true, enumerable: true,
      get: () => (++dials === 1
        ? { status: 403, body: { code: 'calling_hours', error: 'Call between 8 am and 9 pm their time. Try the next lead.', title: "It's 5:15 am for Ray Cole", action: 'skip' } }
        : { status: 201, body: STARTED }),
    });
  });
  afterEach(() => { window.localStorage.clear(); });

  it('skips a lead it may not call, then counts down to the next call after a result', async () => {
    renderAt('/call?list=l1');
    fireEvent.click(await screen.findByRole('button', { name: /^Start calling/ }));
    // Ray was refused for the hour: skipped without stopping, Kim is called.
    expect(await screen.findByText('Too early or late · skipped')).toBeTruthy();
    expect(screen.queryByText("It's 5:15 am for Ray Cole")).toBeNull();
    expect(await screen.findByText('CONNECTED')).toBeTruthy();
    expect(calls.filter(c => c.method === 'POST' && c.path === '/calls').map(c => c.body)).toEqual([{ lead_id: 'ray', via: 'laptop' }, { lead_id: 'kim', via: 'laptop' }]);

    fireEvent.keyDown(window, { key: '1' });
    fireEvent.click(screen.getByRole('button', { name: /^Hang up/ }));
    expect(await screen.findByText(/^Calling Lou in [123]$/)).toBeTruthy();
    // Nothing is saved until the countdown ends, so the result can still change.
    expect(calls.some(c => c.path === '/calls/c1/outcome')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Call now' }));
    await waitFor(() => expect(calls.find(c => c.path === '/calls/c1/outcome')?.body).toEqual({ outcome: 'interested', note: '' }));
    await waitFor(() => expect(calls.filter(c => c.method === 'POST' && c.path === '/calls')).toHaveLength(3));
    expect(calls.filter(c => c.method === 'POST' && c.path === '/calls')[2]?.body).toEqual({ lead_id: 'lou', via: 'laptop' });
  });

  it('Pause stops the countdown and leaves the result to save by hand', async () => {
    renderAt('/call?list=l1');
    fireEvent.click(await screen.findByRole('button', { name: /^Start calling/ }));
    expect(await screen.findByText('CONNECTED')).toBeTruthy();
    fireEvent.keyDown(window, { key: '3' });
    fireEvent.click(screen.getByRole('button', { name: /^Hang up/ }));
    expect(await screen.findByText(/^Calling Lou in/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Pause' })[0]!);
    expect(await screen.findByRole('button', { name: 'Save and pause' })).toBeTruthy();
    await new Promise(r => setTimeout(r, 1200));
    expect(calls.some(c => c.path === '/calls/c1/outcome')).toBe(false);
    expect(screen.queryByText(/^Calling Lou in/)).toBeNull();
  });
});

describe('live phone as headset', () => {
  const QUEUE = {
    title: 'October leads', list_id: 'l1', script_free_until: null, dials_today: 3, dial_limit: 120,
    balance_microdollars: 13_990_000, price_per_minute_microdollars: 20_000, live_call_id: null, scripts: [],
    leads: [{ id: 'kim', name: 'Kim Park', first_name: 'Kim', company: '', city: '', email: '', phone: '+16465550102', notes: '',
      her_time_zone: 'America/New_York', attempts: 0, list_name: 'October leads', script_id: null, last_call: null }],
  };
  const NONE = { id: null, status: 'none', phone_name: '', muted: false, expires_at: null, phone_seen_at: null, call: null, phone: 'fake' };

  it('laptop: makes a code, sees the phone link, then calls through it', async () => {
    answers['GET /me'] = { status: 200, body: { ...ME, plan: 'starter' } };
    answers['GET /queue'] = { status: 200, body: QUEUE };
    answers['GET /pairing'] = { status: 200, body: NONE };
    answers['POST /pairing'] = { status: 201, body: { ...NONE, id: 'p1', status: 'waiting', code: '482913', expires_at: new Date(Date.now() + 600_000).toISOString() } };
    renderAt('/call?list=l1');
    fireEvent.click(await screen.findByText('Use my phone to talk'));
    expect(await screen.findByText('482 913')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Code to link your phone' }).getAttribute('data-qr')).toMatch(/\/link\?code=482913$/);
    expect(calls.some(c => c.method === 'POST' && c.path === '/pairing')).toBe(true);

    answers['GET /pairing'] = { status: 200, body: { ...NONE, id: 'p1', status: 'linked', phone_name: 'Pixel 6a', phone_seen_at: new Date().toISOString() } };
    expect(await screen.findByText(/^Linked: Pixel 6a\./, {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.queryByText('482 913')).toBeNull();

    answers['POST /calls'] = { status: 409, body: { code: 'phone_not_linked', error: 'Scan the code again with your phone, or talk on this laptop.', title: "Your phone isn't connected", action: '' } };
    fireEvent.click(screen.getByRole('button', { name: /^Start calling/ }));
    await waitFor(() => expect(calls.find(c => c.method === 'POST' && c.path === '/calls')?.body).toEqual({ lead_id: 'kim', via: 'phone' }));
    expect(await screen.findByText("Your phone isn't connected")).toBeTruthy();
  });

  it('phone: joins with the code from the link, then asks for the mic', async () => {
    answers['GET /me'] = { status: 200, body: { ...ME, plan: 'starter' } };
    answers['POST /pairing/join'] = { status: 200, body: { ...NONE, id: 'p1', status: 'linked', phone_name: 'This phone', token: 't' } };
    renderAt('/link?code=482913');
    expect(await screen.findByText('Let them hear you')).toBeTruthy();
    expect(calls.find(c => c.path === '/pairing/join')?.body).toMatchObject({ code: '482913' });
  });

  it('phone: a wrong code says why', async () => {
    answers['GET /me'] = { status: 200, body: { ...ME, plan: 'starter' } };
    answers['POST /pairing/join'] = { status: 404, body: { code: 'pairing_code', error: 'Codes last 10 minutes and only work for the account that made them. Make a new one on your laptop.', title: "That code didn't work" } };
    renderAt('/link');
    fireEvent.change(await screen.findByLabelText('Code from your laptop'), { target: { value: '123 456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Link this phone' }));
    expect(await screen.findByText(/^That code didn't work\. Codes last 10 minutes/)).toBeTruthy();
    expect(calls.find(c => c.path === '/pairing/join')?.body).toMatchObject({ code: '123456' });
  });

  it('phone: signed out goes to sign in and comes back to the link', async () => {
    answers['GET /me'] = { status: 401, body: { code: 'signed_out', error: 'Sign in to carry on.' } };
    const router = renderAt('/link?code=482913');
    await waitFor(() => expect(router.state.location.pathname).toBe('/signin'));
    expect((router.state.location.state as { from?: string }).from).toBe('/link?code=482913');
  });
});

describe('live incoming calls', () => {
  const MARK = {
    id: 'mark', name: 'Mark Reyes', first_name: 'Mark', company: 'Reyes Home Care', city: 'Queens', email: '', phone: '+16465550199', notes: '',
    her_time_zone: 'America/New_York', attempts: 1, list_name: 'October leads', script_id: 's1',
    last_call: { at: new Date(Date.now() - 86_400_000).toISOString(), outcome: 'callback', note: 'Asked for prices by email first.' },
  };
  const RINGING: IncomingCall = {
    id: 'in1', status: 'ringing', started_at: new Date().toISOString(), ring_until: new Date(Date.now() + 30_000).toISOString(),
    caller: '+16465550199', to: '+16465550000', price_per_minute_microdollars: 20_000, phone: 'fake', lead: MARK,
    script: { id: 's1', name: 'Office cleaning', parts: [{ title: 'Open', body: 'Thanks for calling back, {first_name}.' }] },
  };
  const CALL = { id: 'in1', lead_id: 'mark', from: '+16465550000', to: '+16465550199', price_per_minute_microdollars: 20_000,
    started_at: RINGING.started_at, low_balance: false, outcome: null, note: '' };
  const TOTALS = { calls: 0, talk_seconds: 0, spent_microdollars: 0, interested: 0 };

  beforeEach(() => {
    answers['GET /me'] = { status: 200, body: { ...ME, plan: 'starter' } };
    answers['GET /today'] = { status: 200, body: { dials_today: 0, dial_limit: 120, today: TOTALS, yesterday: TOTALS, followups_due: 0, due: [], ready_list: null } };
    answers['GET /incoming'] = { status: 200, body: { call: RINGING } };
  });

  it('a lead calling back rings on any screen; Answer takes the call to the call screen', async () => {
    answers['POST /dev/calls/in1/events/answered'] = { status: 200, body: { ...CALL, status: 'answered', answered_at: new Date().toISOString() } };
    answers['GET /calls/in1'] = { status: 200, body: { ...CALL, status: 'answered', answered_at: new Date().toISOString(), ended_at: null, seconds: 0, cost_microdollars: 0 } };
    answers['GET /queue'] = { status: 200, body: {
      title: 'October leads', list_id: null, script_free_until: null, dials_today: 0, dial_limit: 120, balance_microdollars: 9_000_000,
      price_per_minute_microdollars: 20_000, live_call_id: 'in1', scripts: [], leads: [{ ...MARK, last_call: null }],
    } };
    const ended = { ...CALL, status: 'ended', answered_at: '2026-10-04T13:00:00Z', ended_at: '2026-10-04T13:01:00Z', seconds: 60, cost_microdollars: 20_000 };
    answers['POST /calls/in1/hangup'] = { status: 200, body: ended };
    answers['POST /calls/in1/outcome'] = { status: 200, body: { ...ended, outcome: 'interested' } };
    const router = renderAt('/');
    const alert = await screen.findByRole('dialog', { name: 'Mark Reyes is calling you back' });
    expect(alert.textContent).toContain('Reyes Home Care · last call yesterday');
    expect(alert.textContent).toContain('Last note: Asked for prices by email first.');

    answers['GET /incoming'] = { status: 200, body: { call: null } };
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/call/mark'));
    expect(calls.some(c => c.method === 'POST' && c.path === '/dev/calls/in1/events/answered')).toBe(true);
    expect(await screen.findByText('CONNECTED')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Mark Reyes' })).toBeTruthy();
    expect(screen.getByText('YOUR SCRIPT · OFFICE CLEANING')).toBeTruthy(); // the caller's own script
    expect(screen.queryByText(/A call from before is still open/)).toBeNull();

    fireEvent.keyDown(window, { key: '1' });
    fireEvent.click(screen.getByRole('button', { name: /^Hang up/ }));
    await waitFor(() => expect(calls.find(c => c.path === '/calls/in1/outcome')?.body).toEqual({ outcome: 'interested', note: '' }));
    expect(calls.some(c => c.method === 'POST' && c.path === '/calls')).toBe(false);
  });

  it('"Not now" ends the call and sends the lead to Follow-ups', async () => {
    answers['POST /calls/in1/hangup'] = { status: 200, body: { ...CALL, status: 'ended', answered_at: null, ended_at: null, seconds: 0, cost_microdollars: 0 } };
    renderAt('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Not now, add to follow-ups' }));
    await waitFor(() => expect(calls.some(c => c.method === 'POST' && c.path === '/calls/in1/hangup')).toBe(true));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Mark Reyes is calling you back' })).toBeNull());
  });

  it('Free has no alert: the app does not check for calls', async () => {
    answers['GET /me'] = { status: 200, body: ME };
    renderAt('/');
    expect(await screen.findByText('No leads to call')).toBeTruthy();
    expect(calls.some(c => c.path === '/incoming')).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('missed calls show on Follow-ups, Today and History', async () => {
    answers['GET /incoming'] = { status: 200, body: { call: null } };
    const lead = { id: 'mark', name: 'Mark Reyes', company: 'Reyes Home Care', phone: '+16465550199', her_time_zone: 'America/New_York' };
    const missed = { id: 'f1', lead, due_at: new Date(Date.now() - 600_000).toISOString(), reason: 'Missed call', missed: true, last_note: 'Old note', last_outcome: 'callback' };
    answers['GET /followups'] = { status: 200, body: { counts: { today: 1, tomorrow: 0, week: 0, later: 0 }, followups: [missed] } };
    renderAt('/followups');
    expect(await screen.findByText('Called your number back. No message.')).toBeTruthy();
    expect(screen.getAllByText('Missed call').length).toBe(2); // when, and the result
    cleanup();

    answers['GET /history'] = { status: 200, body: { calls: [
      { id: 'c1', lead, to: '+16465550199', incoming: true, answered: false, started_at: new Date().toISOString(), seconds: 0, cost_microdollars: 0, outcome: null, note: '' },
    ], next_cursor: '', week: TOTALS } };
    renderAt('/history');
    expect(await screen.findByText('Called you · Reyes Home Care')).toBeTruthy();
    expect(screen.getByText('Missed call')).toBeTruthy();
  });

  it('describes the caller from their last call', () => {
    const now = new Date();
    const line = callerLine({ ...RINGING, lead: { ...MARK, last_call: { at: now.toISOString(), outcome: null, note: '' } } }, now);
    expect(line).toMatch(/^Reyes Home Care · last call today \d+:\d\d (am|pm)$/);
    expect(callerLine({ ...RINGING, lead: { ...MARK, company: '', last_call: null } })).toBe('October leads');
  });
});
