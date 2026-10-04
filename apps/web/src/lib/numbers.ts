import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@dialer/api-client';
import { api } from './api';
import { isLive } from './backend';
import { useRefreshMoney } from './account';

type S = components['schemas'];
export type RentedNumber = S['RentedNumber'];
export type AvailableNumber = S['AvailableNumber'];
export type MyNumbers = { numbers: RentedNumber[]; monthly_total_microdollars: number; monthly_price_microdollars: number; max_numbers: number };
export type Search = { numbers: AvailableNumber[]; monthly_price_microdollars: number };

export const numberKeys = {
  mine: ['numbers'] as const,
  search: (country: string, area: string) => ['numbers', 'available', country, area] as const,
};

export function useMyNumbers() {
  return useQuery({ queryKey: numberKeys.mine, queryFn: () => api.get<MyNumbers>('/numbers'), enabled: isLive() });
}

/** Numbers for rent in a 3-digit area code; nothing is asked until it has 3 digits. */
export function useNumberSearch(country: 'US' | 'CA', area: string) {
  return useQuery({
    queryKey: numberKeys.search(country, area),
    queryFn: () => api.get<Search>(`/numbers/available?country=${country}&area_code=${area}`),
    enabled: isLive() && /^\d{3}$/.test(area),
    staleTime: 60_000,
    retry: false,
  });
}

/** Default, cancel and keep: each answers with the number as it is now. */
export function useNumberAction() {
  const qc = useQueryClient();
  const refresh = useRefreshMoney();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'default' | 'cancel' | 'keep' }) =>
      action === 'default' ? api.put<RentedNumber>(`/numbers/${id}/default`)
        : action === 'cancel' ? api.delete<RentedNumber>(`/numbers/${id}`)
          : api.post<RentedNumber>(`/numbers/${id}/keep`),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: numberKeys.mine }), refresh()]),
  });
}

/** "+16465550142" → "+1 (646) 555-0142". */
export function prettyNumber(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+1 (${m[1]}) ${m[2]}-${m[3]}` : e164;
}
