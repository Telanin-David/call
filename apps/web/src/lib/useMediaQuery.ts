import { useSyncExternalStore } from 'react';

/** Phones: below Tailwind's `md` breakpoint. */
export const PHONE = '(max-width: 767px)';

/** True while the media query matches; updates on resize and rotation. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    notify => {
      const m = window.matchMedia(query);
      m.addEventListener('change', notify);
      return () => m.removeEventListener('change', notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
