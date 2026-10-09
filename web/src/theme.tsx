import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'system' | 'light' | 'dark';

export const themeStorageKey = 'nodarium-theme';

export function resolveTheme(saved: string | null): Theme {
  return saved === 'light' || saved === 'dark' ? saved : 'system';
}

export function readTheme(): Theme {
  try {
    return resolveTheme(localStorage.getItem(themeStorageKey));
  } catch {
    return 'system';
  }
}

export function applyTheme(theme: Theme, prefersDark: boolean) {
  const effective = theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
  document.documentElement.dataset.theme = effective;
  document.documentElement.style.colorScheme = effective;

  return effective;
}

export function initializeTheme() {
  applyTheme(readTheme(), window.matchMedia('(prefers-color-scheme: dark)').matches);
}

const ThemeContext = createContext<{
  theme: Theme;
  effective: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
} | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, update] = useState(readTheme);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  const effective = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const change = () => setSystemDark(media.matches);
    media.addEventListener('change', change);

    return () => media.removeEventListener('change', change);
  }, []);

  useEffect(() => {
    applyTheme(theme, systemDark);
  }, [theme, systemDark]);

  const setTheme = (next: Theme) => {
    update(next);
    applyTheme(next, systemDark);

    try {
      localStorage.setItem(themeStorageKey, next);
    } catch {
      /* Optional persistence. */
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, effective, setTheme }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const value = useContext(ThemeContext);

  if (!value) throw new Error('ThemeProvider is required');

  return value;
}
