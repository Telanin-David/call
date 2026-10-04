import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@dialer/api-client';
import { api } from './api';
import { isLive } from './backend';

type S = components['schemas'];
export type Me = S['MeResponse'];
export type User = S['User'];
export type Wallet = S['WalletResponse'];
export type Entry = S['LedgerEntry'];
export type PlanInfo = S['Plan'];
export type Subscription = S['Subscription'];
export type PlanQuote = S['PlanQuote'];
export type TopUp = S['TopupResponse'];

export const keys = {
  me: ['me'] as const,
  wallet: ['wallet'] as const,
  plans: ['plans'] as const,
  subscription: ['subscription'] as const,
};

/** The signed-in rep. In demo mode it never loads. */
export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: () => api.get<Me>('/me'), enabled: isLive(), retry: false });
}

export function useWallet() {
  return useQuery({ queryKey: keys.wallet, queryFn: () => api.get<Wallet>('/wallet'), enabled: isLive() });
}

export function usePlans() {
  return useQuery({ queryKey: keys.plans, queryFn: () => api.get<{ plans: PlanInfo[]; intro_eligible?: boolean }>('/plans'), enabled: isLive() });
}

export function useSubscription() {
  return useQuery({ queryKey: keys.subscription, queryFn: () => api.get<Subscription>('/subscription'), enabled: isLive() });
}

/** After anything that moves money or changes the plan, reload what shows it. */
export function useRefreshMoney() {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: keys.me }),
    qc.invalidateQueries({ queryKey: keys.wallet }),
    qc.invalidateQueries({ queryKey: keys.subscription }),
    qc.invalidateQueries({ queryKey: keys.plans }),
  ]);
}

/** Sign in or sign up set the session cookie; this loads the new rep. */
export function useSetMe() {
  const qc = useQueryClient();
  return (u: User) => qc.invalidateQueries({ queryKey: keys.me }).then(() => u);
}

export function useSignout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>('/auth/signout'),
    onSuccess: () => qc.clear(),
  });
}

/** Where a rep belongs after signing in: the confirm steps until done, then the app. */
export function homeFor(u: Pick<User, 'email_confirmed' | 'phone_confirmed'>): string {
  if (!u.email_confirmed) return '/check-email';
  if (!u.phone_confirmed) return '/confirm';
  return '/';
}

/** Ask what a change of plan would cost, without making it. */
export function useQuote(to: string | null) {
  return useQuery({
    queryKey: ['quote', to],
    queryFn: () => api.post<PlanQuote>('/subscription/quote', { plan_id: to }),
    enabled: isLive() && to !== null,
    staleTime: 0,
  });
}

/** Change plan: up is paid now, down is booked for renewal, same cancels a booked move. */
export function useChangePlan() {
  const refresh = useRefreshMoney();
  return useMutation({
    mutationFn: (to: string) => api.post<PlanQuote>('/subscription', { plan_id: to }),
    onSuccess: () => refresh(),
  });
}
