import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { Suspense } from 'react';
import { routes } from './index';
import { PlanProvider, type Plan } from '@/lib/plan';
import { useSimStore } from '@/lib/sim';
import { useDeviceStore } from '@/lib/store';
import { act } from 'react';

afterEach(() => {
  cleanup();
  useDeviceStore.setState({ talkVia: 'phone', phoneLinked: false });
});

function renderAt(path: string, plan: Plan = 'starter') {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <PlanProvider initial={plan}>
      <Suspense fallback={null}><RouterProvider router={router} /></Suspense>
    </PlanProvider>,
  );
}

describe('every route renders its screen', () => {
  it.each([
    ['/signin', 'Sign in'],
    ['/signup', 'Create your account'],
    ['/confirm', "Confirm it's you"],
    ['/forgot', 'Reset your password'],
    ['/setup', "Let's get you calling, Tunde"],
    ['/numbers', 'Get your number'],
    ['/', 'Good evening, Tunde'],
    ['/call', 'Lena Park'],
    ['/followups', 'Follow-ups'],
    ['/leads', 'Leads'],
    ['/leads/upload', 'Upload leads'],
    ['/scripts', 'Your script'],
    ['/history', 'History'],
    ['/wallet', 'Wallet'],
    ['/settings', 'Settings'],
    ['/plans', 'Pick your plan'],
    ['/rules', 'The rules'],
    ['/verify', 'Verify your ID'],
    ['/link', 'Use with laptop'],
    ['/pair', 'Use with laptop'],
    ['/check-email', 'Check your email'],
  ])('%s', async (path, heading) => {
    renderAt(path);
    expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
  });
});

describe('dev plan switcher', () => {
  it('changes plan-gated content on the call screen', async () => {
    renderAt('/call', 'starter');
    expect(await screen.findByRole('button', { name: /Start calling/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Free' }));
    expect(await screen.findByRole('button', { name: /^Call Lena/ })).toBeTruthy();
    expect(screen.getByText('Free plan')).toBeTruthy();
  });

  it('marks the current plan on the plans page', async () => {
    renderAt('/plans', 'pro');
    const proCard = await screen.findByRole('region', { name: 'Pro plan' });
    expect(proCard.textContent).toContain('Your plan');
  });
});

describe('app shell navigation', () => {
  it.each([
    ['/', 'Today'],
    ['/followups', 'Follow-ups'],
    ['/history', 'History'],
  ])('%s marks %s as current in both the top and bottom nav', async (path, label) => {
    renderAt(path);
    await screen.findAllByRole('navigation', { name: 'Main' });
    const navs = screen.getAllByRole('navigation', { name: 'Main' });
    expect(navs).toHaveLength(2);
    for (const nav of navs) {
      const links = nav.querySelectorAll('a');
      expect(Array.from(links, a => a.textContent)).toEqual(['Today', 'Calling', 'Follow-ups', 'Leads', 'History']);
      expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe(label);
    }
  });

  it('hides section navigation during onboarding', async () => {
    renderAt('/setup');
    await screen.findByRole('heading', { name: "Let's get you calling, Tunde" });
    expect(screen.queryAllByRole('navigation', { name: 'Main' })).toHaveLength(0);
  });
});

describe('D1 states', () => {
  afterEach(() => act(() => useSimStore.setState({ sim: null })));

  it('shows a recording with its transcript on Pro, and an upsell otherwise', async () => {
    renderAt('/history/ada', 'pro');
    expect(await screen.findByRole('heading', { name: 'Ada Obi' })).toBeTruthy();
    expect(screen.getByText('Thursday works. After 10 am, my time.')).toBeTruthy();
    cleanup();
    renderAt('/history/ada', 'starter');
    expect(await screen.findByRole('heading', { name: 'Recordings come with Pro' })).toBeTruthy();
  });

  it('walks a Free user from the locked phone option to a paid upgrade', async () => {
    renderAt('/call', 'free');
    fireEvent.click(await screen.findByRole('radio', { name: /Use my phone to talk/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade for $10.00' }));
    expect(screen.getByText('Balance after')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pay $10.00 and upgrade' }));
    expect(await screen.findByRole('button', { name: /Start calling/ })).toBeTruthy();
  });

  it('confirms before moving to Free and keeps the plan until renewal', async () => {
    renderAt('/settings', 'starter');
    fireEvent.click(await screen.findByRole('button', { name: 'Move to Free' }));
    const dialog = screen.getByRole('dialog', { name: 'Move to Free on 1 Nov?' });
    expect(dialog.textContent).toContain('Auto-dial');
    fireEvent.click(screen.getByRole('button', { name: 'Move to Free on 1 Nov' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Moving to Free')).toBeTruthy();
  });

  it.each([
    ['callback', /Mark Reyes is calling you back/],
    ['limit', /You've used your 120 dials for today/],
    ['dnc', /Skipped Mark Reyes/],
  ] as const)('simulated %s opens its dialog on the call screen', async (sim, name) => {
    renderAt('/call', 'starter');
    await screen.findByRole('heading', { name: 'Lena Park' });
    act(() => useSimStore.setState({ sim }));
    expect(await screen.findByRole('dialog', { name })).toBeTruthy();
  });

  it('replaces the call card when the phone drops mid-call', async () => {
    renderAt('/call', 'starter');
    await screen.findByRole('heading', { name: 'Lena Park' });
    act(() => useSimStore.setState({ sim: 'phone' }));
    const alert = await screen.findByRole('alert', { name: 'Call problem' });
    expect(alert.textContent).toContain('Lena is still on the line');
    fireEvent.click(screen.getByRole('button', { name: 'Use this laptop for sound' }));
    expect(screen.queryByRole('alert', { name: 'Call problem' })).toBeNull();
  });
});

describe('phone calling flow', () => {
  const desktop = window.matchMedia;
  beforeEach(() => {
    window.matchMedia = (query: string) => ({ ...desktop(query), matches: query.includes('max-width: 767px') });
  });
  afterEach(() => { window.matchMedia = desktop; });

  it('calls, wraps up and moves on to the next lead', async () => {
    renderAt('/call', 'starter');
    fireEvent.click(await screen.findByRole('button', { name: /Start calling/ }));
    const controls = screen.getByRole('navigation', { name: 'Call controls' });
    expect(screen.getByRole('heading', { name: 'Lena Park' })).toBeTruthy();
    fireEvent.click(within(controls).getByRole('button', { name: 'End' }));
    expect(screen.getByRole('heading', { name: 'How did it go?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Interested' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save · call Mark Reyes' }));
    expect(await screen.findByRole('heading', { name: 'Mark Reyes' })).toBeTruthy();
  });

  it('lets Free users tap any lead to call it', async () => {
    renderAt('/call', 'free');
    fireEvent.click(await screen.findByRole('button', { name: 'Call Rosa Diaz' }));
    expect(screen.getByRole('heading', { name: 'Rosa Diaz' })).toBeTruthy();
  });
});

describe('finished flows', () => {
  it('goes from sign-up to check email to confirm', async () => {
    renderAt('/signup');
    fireEvent.click(await screen.findByRole('button', { name: 'Create account' }));
    fireEvent.click(await screen.findByRole('button', { name: "I've opened the link" }));
    expect(await screen.findByRole('heading', { name: "Confirm it's you" })).toBeTruthy();
  });

  it('walks Verify ID through photo and face check', async () => {
    renderAt('/verify');
    fireEvent.click(await screen.findByRole('button', { name: 'Use this laptop instead' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start on this laptop' }));
    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use this photo' }));
    expect(screen.getByText('Look at the camera')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: "We're checking your ID" }, { timeout: 6000 })).toBeTruthy();
  }, 10000);

  it('changes a setting and confirms with a toast', async () => {
    renderAt('/settings');
    fireEvent.click(await screen.findByRole('button', { name: 'Account' }));
    const nameRow = screen.getByText('Name').closest('div')!;
    fireEvent.click(within(nameRow).getByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByLabelText('Name', { selector: 'input' }), { target: { value: 'Tunde B. Bakare' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Tunde B. Bakare')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Name updated');
  });

  it('opens the pairing dialog from Scan code', async () => {
    renderAt('/call', 'starter');
    fireEvent.click(await screen.findByRole('button', { name: 'Scan code' }));
    expect(screen.getByRole('dialog', { name: 'Scan with your phone' })).toBeTruthy();
    expect(screen.getByText('482 913')).toBeTruthy();
  });
});

describe('All screens page', () => {
  afterEach(() => act(() => useSimStore.setState({ sim: null })));

  it('opens a simulated state in the right plan with one click', async () => {
    renderAt('/screens', 'starter');
    fireEvent.click(await screen.findByRole('button', { name: /Upgrade to Starter/ }));
    expect(await screen.findByRole('button', { name: 'Upgrade for $10.00' })).toBeTruthy();
  });

  it('opens Move to Free on the settings page', async () => {
    renderAt('/screens', 'starter');
    fireEvent.click(await screen.findByRole('button', { name: /Move to Free/ }));
    expect(await screen.findByRole('dialog', { name: 'Move to Free on 1 Nov?' })).toBeTruthy();
  });
});

describe('laptop queue hover card', () => {
  it('shows a lead’s details on hover and lets you call them first', async () => {
    renderAt('/call', 'starter');
    const queue = await screen.findByRole('complementary', { name: 'Queue' });
    // The hover handlers sit on the row's wrapper, around the row button.
    fireEvent.mouseEnter(within(queue).getByRole('button', { name: /Rosa Diaz/ }).parentElement!);
    const card = await screen.findByRole('dialog', { name: 'Rosa Diaz details' });
    expect(card.textContent).toContain('+1 (718) 555-0162');
    fireEvent.click(within(card).getByRole('button', { name: 'Call first' }));
    expect(screen.getByRole('heading', { name: 'Rosa Diaz' })).toBeTruthy();
  });
});
