import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Fees, History, OverviewResponse, Section } from '../src/types';
import { navigate, signIn } from './fixtures';

test('backend exports local fee estimates and persists their history', async ({
  page,
  request,
}) => {
  expect((await request.get('/api/v1/fees')).status()).toBe(401);
  await signIn(page);
  await navigate(page, 'Mempool');
  const panel = page.getByRole('region', { name: 'Fee estimates', exact: true });
  const response = await page.request.get('/api/v1/fees');
  expect(response.ok()).toBe(true);
  const section: Section<Fees> = await response.json();
  expect(section.stale).toBe(false);
  expect(section.data?.mode).toBe('conservative');
  expect(section.data?.targets.map((target) => target.target_blocks)).toEqual([2, 3, 6]);

  for (const [blocks, rate] of [
    [2, 12],
    [3, 8],
    [6, 4],
  ]) {
    await expect(panel.getByText(`${rate.toFixed(2)} sat/vB`, { exact: true })).toBeVisible();
    const target = section.data!.targets.find((value) => value.target_blocks === blocks)!;
    expect(target.stale).toBe(false);
    expect(target.data?.fee_rate).toBeCloseTo(rate);
    expect(target.data?.estimated_blocks).toBe(blocks);
    const historyResponse = await page.request.get(
      `/api/v1/history?metric=fee_estimate_${blocks}&range=24h`,
    );

    expect(historyResponse.ok()).toBe(true);
    const history: History = await historyResponse.json();
    expect(
      history.points.some((point) => point.value !== null && Math.abs(point.value - rate) < 1e-10),
    ).toBe(true);

    expect(history.points.some((point) => point.value === null)).toBe(true);
  }
});

test('fee estimates and history support ranges, themes, German and partial observations', async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const now = Date.now();
  const observedAt = new Date(now).toISOString();
  let state: 'ready' | 'partial' | 'clamped' | 'failed' | 'empty' = 'ready';
  let historyFailed = false;
  let syncing = false;

  await page.route('**/api/v1/fees', (route) => {
    if (state === 'failed')
      return route.fulfill({ status: 503, json: { error: 'Refresh failed' } });

    return route.fulfill({
      json: {
        updated_at: observedAt,
        stale: false,
        data: {
          mode: 'conservative',
          targets: [2, 3, 6].map((blocks, i) => ({
            target_blocks: blocks,
            data:
              state === 'empty'
                ? null
                : {
                    fee_rate: [12, 8, 4][i],
                    estimated_blocks: state === 'clamped' && blocks === 6 ? 3 : blocks,
                  },
            updated_at: observedAt,
            stale: state === 'partial' && blocks === 3,
            error:
              state === 'empty'
                ? 'Not enough data to estimate this fee rate.'
                : state === 'partial' && blocks === 3
                  ? 'RPC estimatesmartfee failed (code -1)'
                  : undefined,
          })),
        },
      },
    });
  });

  await page.route('**/api/v1/overview', async (route) => {
    const response = await route.fetch();
    const body: OverviewResponse = await response.json();
    body.overview.data!.blockchain.initialblockdownload = syncing;
    await route.fulfill({ json: body });
  });

  await page.route('**/api/v1/history?**', (route) => {
    const url = new URL(route.request().url());
    const metric = url.searchParams.get('metric')!;

    if (!metric.startsWith('fee_estimate_')) return route.continue();

    // The first series can fail without hiding the other series in the data table.
    if (historyFailed && metric === 'fee_estimate_2')
      return route.fulfill({ status: 503, json: { error: 'History storage unavailable' } });

    const blocks = Number(metric.split('_').at(-1));
    const base = blocks === 2 ? 12 : blocks === 3 ? 8 : 4;
    const range = url.searchParams.get('range')!;
    const span = (
      {
        '1h': 3600000,
        '24h': 86400000,
        '7d': 604800000,
        '30d': 2592000000,
        '1y': 31536000000,
      } as Record<string, number>
    )[range];

    const step = span / 48;

    return route.fulfill({
      json: {
        metric,
        range,
        interval_seconds: step / 1000,
        total: 0,
        points: Array.from({ length: 49 }, (_, i) => ({
          at: now - (48 - i) * step,
          value: state === 'empty' || i === 20 ? null : base * (1 + 0.25 * Math.sin(i / 5)),
          peak: base,
          total: 0,
          coverage: state === 'empty' || i === 20 ? 0 : 1,
          samples: state === 'empty' || i === 20 ? 0 : 180,
        })),
      },
    });
  });

  await signIn(page);
  await navigate(page, 'Mempool');
  const panel = page.locator('.fee-estimates');
  const chart = page.locator('.fee-history');
  await expect(panel.getByText('12.00 sat/vB', { exact: true })).toBeVisible();
  await expect(chart.locator('.chart-empty')).toHaveCount(0);
  await expect(chart.getByRole('img')).toBeVisible();

  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);
    const audit = await new AxeBuilder({ page })
      .include('.fee-estimates')
      .include('.fee-history')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(audit.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );

    await page.getByRole('heading', { name: 'Fee estimates', exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `../.impeccable/review/fees-${info.project.name}-${theme}.png`,
      fullPage: true,
    });
  }

  await page.getByLabel('Language', { exact: true }).selectOption('de');
  await expect(panel).toContainText('Gebührenschätzungen');
  await expect(panel.getByText('12,00 sat/vB', { exact: true })).toBeVisible();
  await expect(chart.getByRole('heading')).toHaveText('Verlauf der Gebührenschätzungen');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `../.impeccable/review/fees-${info.project.name}-de.png`,
    fullPage: true,
  });

  await page.getByLabel('Sprache', { exact: true }).selectOption('en');
  await page.getByRole('button', { name: '7d', exact: true }).click();
  await expect(chart.getByRole('img')).toHaveAttribute('aria-label', /7d/);
  await chart.locator('summary').click();
  await expect(chart.getByRole('table')).toBeVisible();
  await expect(chart.getByRole('columnheader', { name: '6-block target' })).toBeVisible();
  await expect(chart.getByText('No reading', { exact: true })).toHaveCount(3);
  const refresh = page.getByRole('button', { name: 'Refresh node data' });
  state = 'partial';
  await refresh.click();
  await expect(panel.locator('.metric').nth(1)).toContainText('Last known reading');
  await expect(panel.locator('.metric').nth(2)).not.toContainText('Last known reading');
  state = 'clamped';
  await refresh.click();
  await expect(panel.locator('.metric').nth(2)).toContainText('Core returned a 3-block estimate');
  state = 'failed';
  await refresh.click();
  await expect(panel.getByRole('alert')).toContainText('could not be refreshed');
  await expect(panel.getByText('12.00 sat/vB', { exact: true })).toBeVisible();
  await expect(panel.locator('.metric').first()).toContainText('Last known reading');
  state = 'empty';
  await refresh.click();
  await expect(panel.getByText('—', { exact: true })).toHaveCount(3);
  await expect(
    panel.getByText('Not enough data to estimate this fee rate.', { exact: true }),
  ).toHaveCount(3);

  await expect(chart.getByText('Your history starts here')).toBeVisible();
  // Change range to discard the cached first series, then verify partial history still has an accessible table.
  state = 'ready';
  historyFailed = true;
  await page.getByRole('button', { name: '30d', exact: true }).click();
  await expect(chart.locator('.chart-empty')).toHaveCount(0);
  await expect(chart.getByText('History is temporarily unavailable.')).toBeVisible();
  await chart.locator('summary').click();
  await expect(chart.getByRole('table')).toBeVisible();
  await expect(chart.getByRole('row').nth(1).getByRole('cell').nth(1)).toHaveText('No reading');
  await expect(chart.getByRole('row').nth(1).getByRole('cell').nth(2)).toHaveText('8.00 sat/vB');
  syncing = true;
  await refresh.click();
  await expect(panel.getByRole('alert')).toContainText('while the node is syncing');
  await expect(panel.getByText('—', { exact: true })).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('missing fee readings stay empty and collection errors explain recovery', async ({ page }) => {
  let failed = false;
  await page.route('**/api/v1/fees', (route) =>
    route.fulfill({
      json: {
        data: null,
        updated_at: null,
        stale: failed,
        error: failed ? 'RPC estimatesmartfee failed (code -28)' : undefined,
      },
    }),
  );

  await signIn(page);
  await navigate(page, 'Mempool');
  const panel = page.locator('.fee-estimates');
  await expect(panel.getByText('—', { exact: true })).toHaveCount(3);
  await expect(
    panel.getByText('Waiting for a fee estimate from your node.', { exact: true }),
  ).toHaveCount(3);

  failed = true;
  await page.getByRole('button', { name: 'Refresh node data' }).click();
  await expect(panel.getByRole('alert')).toContainText('RPC estimatesmartfee failed (code -28)');
  await expect(panel.getByText('—', { exact: true })).toHaveCount(3);
});
