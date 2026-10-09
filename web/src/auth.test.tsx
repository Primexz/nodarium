import { StrictMode } from 'react';
import { afterEach, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './auth';
import { useReadings } from './state';
import { api } from './api';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Readings() {
  const node = useReadings();

  return (
    <span>
      {node.peers.stale ? 'stale' : 'fresh'}:{node.peers.data?.length ?? 0}
    </span>
  );
}

function Probe() {
  const auth = useAuth();

  return (
    <>
      <span>{auth.checking ? 'checking' : auth.authenticated ? 'signed in' : 'signed out'}</span>
      <button onClick={() => void auth.login('secret')}>Login</button>
      <button onClick={() => void auth.logout()}>Logout</button>
      <span>{auth.error}</span>
      {auth.authenticated && <Readings />}
    </>
  );
}

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });

  const result = render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>
    </StrictMode>,
  );

  return { ...result, client };
}

it('retains readings on independent failures and clears caches on session expiry', async () => {
  let failed = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (input: string) =>
        new Response(
          JSON.stringify(
            input.endsWith('auth/session')
              ? {}
              : input.endsWith('auth/logout')
                ? {}
                : failed
                  ? { error: 'down' }
                  : { data: [{ id: 1 }], updated_at: '2026-10-09T12:00:00Z', stale: false },
          ),
          {
            status: failed && !input.includes('auth/') ? 503 : 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
    ),
  );

  const { client } = setup();
  await screen.findByText('fresh:1');
  failed = true;
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['node'] });
  });

  await screen.findByText('stale:1');
  act(() => window.dispatchEvent(new Event('session-expired')));
  await screen.findByText('signed out');
  expect(client.getQueryCache().getAll()).toHaveLength(0);
  expect(screen.queryByText('stale:1')).toBeNull();
});

it('keeps the session after failed logout and cancels in-flight data on successful logout', async () => {
  let logoutFails = true;
  const signals: AbortSignal[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, options: RequestInit) => {
      if (input.endsWith('auth/session')) return Promise.resolve(new Response('{}'));

      if (input.endsWith('auth/logout'))
        return Promise.resolve(
          new Response(JSON.stringify(logoutFails ? { error: 'failed' } : {}), {
            status: logoutFails ? 503 : 200,
          }),
        );

      signals.push(options.signal as AbortSignal);

      return new Promise<Response>((_, reject) =>
        options.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        ),
      );
    }),
  );

  const { client } = setup();
  await screen.findByText('signed in');
  await waitFor(() => expect(signals.length).toBeGreaterThan(0));
  fireEvent.click(screen.getByText('Logout'));
  await screen.findByText('Could not sign out. Please try again.');
  expect(screen.getByText('signed in')).toBeTruthy();
  logoutFails = false;
  fireEvent.click(screen.getByText('Logout'));
  await screen.findByText('signed out');
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(client.getQueryCache().getAll()).toHaveLength(0);
});

it('unauthorized node requests signal session expiry without exposing the key in storage', async () => {
  const expired = vi.fn();
  window.addEventListener('session-expired', expired);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{"error":"Authentication required"}', { status: 401 })),
  );

  await expect(api('peers')).rejects.toMatchObject({ status: 401 });
  expect(expired).toHaveBeenCalledOnce();
  window.removeEventListener('session-expired', expired);
  expect(localStorage.getItem('secret')).toBeNull();
});
