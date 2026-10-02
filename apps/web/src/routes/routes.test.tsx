import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { Suspense } from 'react';
import { routes } from './index';
import { PlanProvider, DevPlanSwitcher, type Plan } from '@/lib/plan';

afterEach(cleanup);

function renderAt(path: string, plan: Plan = 'starter') {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <PlanProvider initial={plan}>
      <Suspense fallback={null}><RouterProvider router={router} /></Suspense>
      <DevPlanSwitcher />
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
