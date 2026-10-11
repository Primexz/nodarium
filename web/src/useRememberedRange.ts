import { useState } from 'react';

// View-specific ranges survive route changes and reloads within this browser tab.
// Storage is optional; the controls still work when it is unavailable.
export function useRememberedRange<T extends string>(
  scope: string,
  values: readonly T[],
  fallback: T,
) {
  const key = `nodarium-range-${scope}`;
  const [range, setRange] = useState<T>(() => {
    try {
      const saved = sessionStorage.getItem(key);

      return values.find((value) => value === saved) ?? fallback;
    } catch {
      return fallback;
    }
  });

  function changeRange(value: T) {
    setRange(value);

    try {
      sessionStorage.setItem(key, value);
    } catch {
      /* Remembering the range is optional. */
    }
  }

  return [range, changeRange] as const;
}
