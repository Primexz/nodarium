import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Fees, History, Section } from '../types';
import FeeEstimates from './FeeEstimates';
import HistoryChart from './HistoryChart';
import MiningCharts from './MiningCharts';
import {
  ChartSkeleton,
  LoadingSkeleton,
  MetricsSkeleton,
  ProjectionSkeleton,
  Skeleton,
  TableSkeleton,
} from './Skeleton';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, values?: { blocks?: string }) =>
      key === 'mining.window' ? `${key} ${values?.blocks}` : key,
  }),
}));

vi.mock('../theme', () => ({ useTheme: () => ({ effective: 'dark' }) }));
vi.mock('./useChart', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useChart')>()),
  useChart: () => ({ element: { current: null } }),
}));

const clients: QueryClient[] = [];

afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.unstubAllGlobals();
});

function client() {
  const value = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(value);

  return value;
}

function withQueries(children: ReactNode, queryClient = client()) {
  return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

function pendingResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });

  return { promise, resolve: (data: unknown) => resolve(new Response(JSON.stringify(data))) };
}

const history: History = {
  metric: 'difficulty',
  range: '24h',
  interval_seconds: 60,
  total: 0,
  points: [{ at: 1, value: 42, peak: 42, total: 0, coverage: 1, samples: 1 }],
};

const chart = (metrics = ['difficulty']) => (
  <HistoryChart title="Difficulty" metrics={metrics} labels={metrics} range="24h" />
);

it('announces one loading label and hides all decorative content', () => {
  const view = render(
    <LoadingSkeleton label="Loading readings">
      <Skeleton className="custom-shape" />
      <MetricsSkeleton />
      <TableSkeleton />
      <ChartSkeleton />
      <ProjectionSkeleton />
    </LoadingSkeleton>,
  );

  const status = screen.getByRole('status');

  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(status.closest('[aria-busy="true"]')).toBeNull();
  expect(status.parentElement?.querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe(
    'true',
  );

  expect(screen.getByText('Loading readings').className).toBe('sr-only');
  expect(status.parentElement?.querySelector(':scope > div')?.getAttribute('aria-hidden')).toBe(
    'true',
  );

  expect(view.container.querySelector('.custom-shape')?.getAttribute('aria-hidden')).toBe('true');
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByRole('img')).toBeNull();
});

it('supports the default and caller-specified metric count', () => {
  const view = render(<MetricsSkeleton />);
  expect(view.container.querySelectorAll('.metric')).toHaveLength(3);
  view.rerender(<MetricsSkeleton count={6} />);
  expect(view.container.querySelectorAll('.metric')).toHaveLength(6);
});

it('replaces the initial chart skeleton when history arrives without remounting the canvas', async () => {
  const response = pendingResponse();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => response.promise),
  );

  const view = withQueries(chart());
  const canvas = view.container.querySelector('.chart');

  expect(screen.getByText('history.loading')).toBeTruthy();
  expect(view.container.querySelector('.chart-wrap [aria-busy]')?.getAttribute('aria-busy')).toBe(
    'true',
  );

  expect(screen.queryByRole('img')).toBeNull();
  response.resolve(history);
  await waitFor(() => expect(screen.queryByText('history.loading')).toBeNull());
  expect(screen.getByRole('img')).toBe(canvas);
  expect(
    view.container.querySelector('.chart-wrap [aria-busy]')?.getAttribute('aria-busy'),
  ).toBeUndefined();
});

it('keeps cached chart data visible during refetch and while another series is missing', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => {})),
  );

  const queryClient = client();
  queryClient.setQueryData(['history', 'difficulty', '24h'], history);
  const view = withQueries(chart(['difficulty', 'missing']), queryClient);

  await waitFor(() => expect(queryClient.isFetching()).toBe(2));
  expect(screen.getByRole('img')).toBeTruthy();
  expect(screen.getByText('Difficulty — history.data')).toBeTruthy();
  expect(view.container.querySelector('.loading-skeleton')).toBeNull();
  expect(view.container.querySelector('[aria-busy="true"]')).toBeNull();
});

it('ends loading with an error even when another series is still pending', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string) =>
      path.includes('metric=failed')
        ? Promise.reject(new Error('offline'))
        : new Promise<Response>(() => {}),
    ),
  );

  const view = withQueries(chart(['failed', 'pending']));

  await screen.findByText('History is temporarily unavailable.');
  expect(view.container.querySelector('.loading-skeleton')).toBeNull();
  expect(view.container.querySelector('[aria-busy="true"]')).toBeNull();
});

it.each([{ points: [] }, { points: [{ ...history.points[0]!, value: null }] }])(
  'uses the empty state for settled history without usable readings (%j)',
  async ({ points }) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ...history, points }))),
    );

    const view = withQueries(chart());

    await screen.findByText('history.empty');
    expect(view.container.querySelector('.loading-skeleton')).toBeNull();
    expect(view.container.querySelector('[aria-busy="true"]')).toBeNull();
  },
);

it('applies chart loading and settled missing-series states to mining charts', async () => {
  const response = pendingResponse();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => response.promise.then((value) => value.clone())),
  );

  const view = withQueries(
    <MiningCharts mining={{ data: null, stale: false, updated_at: null }} range="24h" />,
  );

  expect(screen.getAllByText('history.loading')).toHaveLength(2);
  response.resolve(null);
  await waitFor(() => expect(screen.getAllByText('history.empty')).toHaveLength(2));
  expect(view.container.querySelector('.loading-skeleton')).toBeNull();
});

it('shows fee skeletons only during the initial request and retains cached fees after a failed refetch', async () => {
  const response = pendingResponse();
  const fetch = vi.fn(() => response.promise);
  vi.stubGlobal('fetch', fetch);
  const queryClient = client();
  const view = withQueries(<FeeEstimates />, queryClient);

  expect(view.container.querySelectorAll('.metrics-skeleton .metric')).toHaveLength(3);
  expect(
    view.container.querySelector('.fee-estimates [aria-busy]')?.getAttribute('aria-busy'),
  ).toBe('true');

  const fees: Section<Fees> = {
    stale: false,
    updated_at: null,
    data: {
      mode: 'conservative',
      targets: [2, 3, 6].map((blocks) => ({
        target_blocks: blocks,
        data: { fee_rate: blocks, estimated_blocks: blocks },
        updated_at: null,
        stale: false,
      })),
    },
  };

  response.resolve(fees);
  await screen.findByText('2.00 sat/vB');
  expect(view.container.querySelector('.loading-skeleton')).toBeNull();
  const refresh = pendingResponse();
  fetch.mockImplementation(() => refresh.promise);
  void queryClient.invalidateQueries({ queryKey: ['node', 'fees'] });
  await waitFor(() => expect(queryClient.isFetching()).toBe(1));
  expect(screen.getByText('2.00 sat/vB')).toBeTruthy();
  expect(view.container.querySelector('.loading-skeleton')).toBeNull();

  fetch.mockRejectedValue(new Error('offline'));
  await act(async () => {
    await queryClient.cancelQueries({ queryKey: ['node', 'fees'] });
    await queryClient.invalidateQueries({ queryKey: ['node', 'fees'] });
  });

  await screen.findByText('fees.stale');
  expect(screen.getByText('2.00 sat/vB')).toBeTruthy();
  expect(view.container.querySelector('[aria-busy="true"]')).toBeNull();
});

it('shows settled unavailable fees without leaving a loading skeleton', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ data: null, stale: false }))),
  );

  const view = withQueries(<FeeEstimates />);

  await waitFor(() => expect(view.container.querySelector('.loading-skeleton')).toBeNull());
  expect(screen.getAllByText('—')).toHaveLength(3);
  expect(view.container.querySelector('[aria-busy="true"]')).toBeNull();
});
