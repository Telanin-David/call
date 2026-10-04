import { useEffect, useState } from 'react';

/** A countdown in seconds for "Send again in 0:42". start(n) begins one. */
export function useCooldown(initial = 0) {
  const [left, setLeft] = useState(initial);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft(l => l - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return { left, start: setLeft, clock: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` };
}
