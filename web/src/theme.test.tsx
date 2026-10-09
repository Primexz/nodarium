import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, useTheme, initializeTheme, themeStorageKey } from './theme';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function Probe() {
  const { theme, effective, setTheme } = useTheme();

  return (
    <>
      <span>
        {theme}/{effective}
      </span>
      <button onClick={() => setTheme('light')}>Light</button>
      <button onClick={() => setTheme('system')}>System</button>
    </>
  );
}

describe('theme preferences', () => {
  it('follows system changes until an explicit choice and supports returning to system', () => {
    let dark = true;
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', () => ({
      get matches() {
        return dark;
      },
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }));

    initializeTheme();
    expect(document.documentElement.dataset.theme).toBe('dark');
    const view = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByText('system/dark')).toBeTruthy();
    expect(localStorage.getItem(themeStorageKey)).toBeNull();
    act(() => {
      dark = false;
      listeners.forEach((fn) => fn());
    });

    expect(screen.getByText('system/light')).toBeTruthy();
    fireEvent.click(screen.getByText('Light'));
    expect(localStorage.getItem(themeStorageKey)).toBe('light');
    act(() => {
      dark = true;
      listeners.forEach((fn) => fn());
    });

    expect(document.documentElement.dataset.theme).toBe('light');
    fireEvent.click(screen.getByText('System'));
    expect(document.documentElement.dataset.theme).toBe('dark');
    view.unmount();
    expect(listeners.size).toBe(0);
  });

  it('restores saved preference before render and works when storage is blocked', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    localStorage.setItem(themeStorageKey, 'dark');
    initializeTheme();
    expect(document.documentElement.dataset.theme).toBe('dark');
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByText('Light'));
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
