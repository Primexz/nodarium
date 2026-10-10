import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { useBlockIndexStatus, useReadings } from './state';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Probe() {
  useReadings();

  return null;
}

it('polls each section every ten seconds and never overlaps a pending request', async () => {
  vi.useFakeTimers();
  const counts = new Map<string, number>();
  const signals: AbortSignal[] = [];

  let pending = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, options: RequestInit) => {
      counts.set(path, (counts.get(path) ?? 0) + 1);
      signals.push(options.signal as AbortSignal);

      if (pending) return new Promise<Response>(() => {});

      return new Response(JSON.stringify({ data: [], stale: false, updated_at: null }));
    }),
  );

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });

  const view = render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });

  expect(counts.size).toBe(7);
  expect([...counts.values()]).toEqual([1, 1, 1, 1, 1, 1, 1]);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(9998);
  });

  expect([...counts.values()]).toEqual([1, 1, 1, 1, 1, 1, 1]);
  pending = true;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2);
  });

  expect([...counts.values()]).toEqual([2, 2, 2, 2, 2, 2, 2]);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30000);
  });

  expect([...counts.values()]).toEqual([2, 2, 2, 2, 2, 2, 2]);
  view.unmount();
  expect(signals.slice(-7).every((signal) => signal.aborted)).toBe(true);
  client.clear();
});

function IndexProbe() {
  useBlockIndexStatus();
  const page = useBlockIndexStatus(false);

  return <output aria-label="Indexed blocks">{page.data?.headers}</output>;
}

it('polls the shared block index once while page observers receive fresh cached progress', async () => {
  vi.useFakeTimers();
  let calls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      calls++;

      return new Response(JSON.stringify({ status: 'indexing', headers: calls * 10, target: 100 }));
    }),
  );

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });

  const view = render(
    <QueryClientProvider client={client}>
      <IndexProbe />
    </QueryClientProvider>,
  );

  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });

  expect(calls).toBe(1);
  expect(screen.getByLabelText('Indexed blocks').textContent).toBe('10');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });

  expect(calls).toBe(2);
  expect(screen.getByLabelText('Indexed blocks').textContent).toBe('20');
  view.unmount();
  client.clear();
});
