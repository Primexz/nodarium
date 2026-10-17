import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ProjectedBlocks from './ProjectedBlocks';
import type { MempoolProjection } from '../activity';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../theme', () => ({ useTheme: () => ({ effective: 'dark' }) }));
afterEach(cleanup);

const projection: MempoolProjection = {
  at: 1,
  count: 1000,
  vsize: 1200000,
  weight: 4800000,
  min_rate: 1,
  max_rate: 50,
  remaining_count: 200,
  remaining_vsize: 400000,
  blocks: [
    {
      count: 800,
      vsize: 800000,
      weight: 3200000,
      min_rate: 5,
      max_rate: 50,
      median_rate: 10,
      groups: [
        { count: 400, vsize: 600000, min_rate: 20, max_rate: 50 },
        { count: 400, vsize: 200000, min_rate: 5, max_rate: 10 },
      ],
    },
  ],
};

it('shows full backlog and retains unused virtual capacity in bounded fee-group tiles', () => {
  const view = render(<ProjectedBlocks projection={projection} error={false} stopped={false} />);
  expect(screen.getByText('1,000')).toBeTruthy();
  expect(screen.getByText('activity.remainingBacklog')).toBeTruthy();
  const rects = [...view.container.querySelectorAll('rect')];
  expect(rects.length).toBeLessThanOrEqual(32);
  // A partially filled block leaves blank capacity above its data. Every tile
  // stays inside the viewBox; the first fee group's area is three times the next.
  const n = (rect: Element, attr: string) => Number(rect.getAttribute(attr));
  const bounds = rects.map((r) => ({
    x: n(r, 'x'),
    y: n(r, 'y'),
    w: n(r, 'width'),
    h: n(r, 'height'),
  }));

  expect(bounds.every(({ x, y, w, h }) => x >= 0 && y > 40 && x + w <= 300 && y + h <= 220)).toBe(
    true,
  );

  const area = (rows: typeof bounds) =>
    rows.reduce((sum, { w, h }) => sum + (w + 1.5) * (h + 1.5), 0);

  expect(area(bounds.slice(0, 16)) / area(bounds.slice(16))).toBeCloseTo(3);
});

it('distinguishes loading, failed refresh, and an empty full snapshot', () => {
  const view = render(<ProjectedBlocks projection={null} error={false} stopped={false} />);
  expect(screen.getByText('activity.projectionLoading')).toBeTruthy();
  expect(
    view.container.querySelector('.loading-skeleton [aria-busy]')?.getAttribute('aria-busy'),
  ).toBe('true');

  expect(
    view.container.querySelector('.loading-skeleton [aria-busy]')?.getAttribute('aria-busy'),
  ).toBe('true');

  expect(view.container.querySelectorAll('.projection-skeleton .metric')).toHaveLength(3);
  expect(view.container.querySelectorAll('.skeleton-mosaic')).toHaveLength(4);
  expect(view.container.querySelectorAll('.projected-mosaic')).toHaveLength(0);
  view.rerender(<ProjectedBlocks projection={projection} error stopped={false} />);
  expect(screen.getByText('activity.projectionStale')).toBeTruthy();
  expect(view.container.querySelector('.loading-skeleton')).toBeNull();
  expect(
    view.container.querySelector('.loading-skeleton [aria-busy]')?.getAttribute('aria-busy'),
  ).toBeUndefined();

  expect(view.container.querySelector('svg')).not.toBeNull();
  view.rerender(
    <ProjectedBlocks
      projection={{ ...projection, count: 0, blocks: [], remaining_count: 0 }}
      error={false}
      stopped={false}
    />,
  );

  expect(screen.getByText('activity.emptyMempool')).toBeTruthy();
  expect(view.container.querySelector('svg')).toBeNull();
});

it('suppresses loading shapes on an initial error', () => {
  const view = render(<ProjectedBlocks projection={null} error stopped={false} loading />);

  expect(screen.getByText('activity.projectionError')).toBeTruthy();
  expect(screen.queryByText('activity.projectionLoading')).toBeNull();
  expect(view.container.querySelector('.loading-skeleton')).toBeNull();
  expect(view.container.querySelector('[aria-busy="true"]')).toBeNull();
});

it('uses a notice for settled null projections and resumes skeletons only when pending', () => {
  const view = render(<ProjectedBlocks projection={null} error={false} stopped loading={false} />);

  expect(screen.getByText('activity.waiting')).toBeTruthy();
  expect(view.container.querySelector('.loading-skeleton')).toBeNull();
  expect(view.container.querySelector('[aria-busy="true"]')).toBeNull();

  view.rerender(<ProjectedBlocks projection={null} error={false} stopped={false} loading />);
  expect(view.container.querySelector('.projection-skeleton')).not.toBeNull();

  view.rerender(<ProjectedBlocks projection={projection} error={false} stopped={false} loading />);
  expect(screen.getByText('1,000')).toBeTruthy();
  expect(view.container.querySelector('svg')).not.toBeNull();
  expect(view.container.querySelector('.loading-skeleton')).toBeNull();
  expect(view.container.querySelector('[aria-busy="true"]')).toBeNull();
});
