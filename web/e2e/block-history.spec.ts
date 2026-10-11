import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';
import type { Block, BlockIndexStatus, BlockHistoryPage } from '../src/types';
import { navigate, signIn } from './fixtures';

const tip = 900123;
const hash = (height: number) => height.toString(16).padStart(64, '0');

function block(height: number): Block {
  return {
    hash: hash(height),
    height,
    time: Math.floor(Date.now() / 1000) - (tip - height) * 600,
    previousblockhash: hash(height - 1),
    confirmations: tip - height + 1,
    subsidy_sats: '312500000',
    total_fees_sats: '12567890',
    total_transaction_amount_sats: '123456789012',
    transaction_count: 2500,
    average_fee_rate: 12,
    median_fee_rate: 8,
    size_bytes: 1750000,
    weight_units: 3800000,
    capacity_percent: 95,
  };
}

async function mockArchive(page: Page, frontier?: number, delay = 0) {
  const requests: number[] = [];
  const status: BlockIndexStatus = {
    status: frontier == null ? 'ready' : 'indexing',
    height: tip,
    tip: hash(tip),
    target: tip + 1,
    headers: frontier == null ? tip + 1 : tip - frontier + 1,
    statistics: frontier == null ? tip + 1 : tip - frontier + 1,
    pools: tip + 1,
    pruned: 0,
    oldest_height: frontier ?? 0,
    updated_at: new Date().toISOString(),
    stale: false,
  };

  await page.route('**/api/1.0/blocks/index', (route) => route.fulfill({ json: status }));
  await page.route('**/api/1.0/blocks/history?*', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const cursor = params.get('cursor');
    const [direction, cursorHeight] = cursor?.split(':') ?? [];
    const start = cursor ? Number(cursorHeight) : Number(params.get('start_height') ?? tip);
    const first = direction === 'newer' ? Math.min(tip, start + 50) : start;
    requests.push(first);
    const blocks = Array.from({ length: Math.min(50, first + 1) }, (_, index) =>
      block(first - index),
    ).filter((item) => item.height >= (frontier ?? 0));

    const result: BlockHistoryPage = {
      blocks,
      anchor_height: tip,
      total: status.headers,
      older_cursor:
        blocks.length && blocks.at(-1)!.height > 0 ? `older:${blocks.at(-1)!.height - 1}` : '',
      newer_cursor: blocks.length && first < tip ? `newer:${first}` : '',
      backfill_pending: frontier != null,
      stale: false,
    };

    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));

    return route.fulfill({ json: result });
  });

  await page.route(/\/api\/1\.0\/blocks\/[0-9a-f]{64}$/, (route) => {
    const height = parseInt(route.request().url().split('/').at(-1)!, 16);

    return route.fulfill({ json: { ...block(height), pool: { status: 'unknown', pool: null } } });
  });

  return { requests, status };
}

test('the persisted index APIs are authenticated, bounded, and expose exact summaries', async ({
  page,
  request,
}) => {
  for (const path of [
    'blocks/index',
    'blocks/history',
    'blocks/economics?range=all',
    `blocks/${hash(tip)}`,
  ])
    expect((await request.get(`/api/1.0/${path}`)).status()).toBe(401);

  await signIn(page);
  const history = await page.request.get('/api/1.0/blocks/history?limit=3');
  expect(history.ok()).toBe(true);
  const result: BlockHistoryPage = await history.json();
  expect(result.blocks).toHaveLength(3);
  expect(result.blocks[0]!.height).toBe(tip);
  const older = await page.request.get(
    `/api/1.0/blocks/history?cursor=${result.older_cursor}&limit=3`,
  );

  expect((await older.json()).blocks[0].height).toBe(tip - 3);
  const summary = await page.request.get(`/api/1.0/blocks/${hash(tip)}`);
  expect((await summary.json()).total_fees_sats).toBe('12567890');

  for (const path of [
    'history?limit=101',
    'history?limit=0',
    'history?start_height=-1',
    'history?cursor=bad',
    'economics?range=bad',
  ])
    expect((await page.request.get(`/api/1.0/blocks/${path}`)).status()).toBe(400);

  const economics = await page.request.get('/api/1.0/blocks/economics?range=all');
  const data = await economics.json();
  expect(economics.ok()).toBe(true);
  expect(data.points.length).toBeLessThanOrEqual(1000);
  expect(data.points.some((point: { fees_btc: number | null }) => point.fees_btc != null)).toBe(
    true,
  );
});

test('historical scrolling bounds the cache, reloads newer pages, and keeps goggles selected', async ({
  page,
}) => {
  test.setTimeout(60000);
  const { requests } = await mockArchive(page);
  await signIn(page);
  await navigate(page, 'Blocks');
  const strip = page.locator('.virtual-block-strip');
  await expect(page.locator('.virtual-block-strip li[data-index]').first()).toBeVisible();
  await strip.evaluate((node) => {
    node.scrollLeft = 172 * 50;
  });

  await page.getByRole('button', { name: 'Inspect block 900,073', exact: true }).click();
  await expect(page.locator('.selected-block-panel .transaction-mosaic canvas')).toBeVisible();

  for (let pageNumber = 0; pageNumber < 12; pageNumber++) {
    const before = requests.length;
    await strip.evaluate((node) => {
      node.scrollLeft = node.scrollWidth;
    });

    await expect.poll(() => requests.length).toBeGreaterThan(before);
    await expect(page.locator('.block-history').getByText('Loading block history…')).toHaveCount(0);
  }

  expect(await page.locator('.virtual-block-strip li[data-index]').count()).toBeLessThan(40);
  expect(await strip.evaluate((node) => node.scrollWidth)).toBeLessThan(87000);
  await expect(page.locator('.selected-block-panel')).toContainText('900,073');
  await expect(page.locator('.selected-block-panel .transaction-mosaic canvas')).toBeVisible();
  const before = requests.length;
  await strip.evaluate((node) => {
    node.scrollLeft = 0;
  });

  await expect.poll(() => requests.length).toBeGreaterThan(before);
  await expect(page.locator('.block-history').getByText('Loading block history…')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);
});

test('keyboard traversal crosses a fetched page boundary without losing focus', async ({
  page,
}) => {
  const { requests } = await mockArchive(page, undefined, 750);
  await signIn(page);
  await navigate(page, 'Blocks');
  await expect.poll(() => requests.length).toBeGreaterThanOrEqual(1);
  await expect(page.locator('.block-history').getByText('Loading block history…')).toHaveCount(0);
  const first = page.getByRole('button', { name: 'Inspect block 900,123', exact: true });
  await first.focus();
  await first.press('End');
  // Automatic prefetch can already have added another page before End is handled.
  // Follow the actual cached boundary instead of assuming a fixed page count.
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label')))
    .toMatch(/^Inspect block (?!900,123)[\d,]+$/);

  const label = await page.evaluate(() => document.activeElement!.getAttribute('aria-label')!);
  const height = Number(label.replace('Inspect block ', '').replaceAll(',', ''));
  await page.keyboard.press('ArrowRight');
  const next = page.getByRole('button', {
    name: `Inspect block ${(height - 1).toLocaleString('en-US')}`,
    exact: true,
  });

  await expect(next).toBeFocused();
});

test('backfill frontier waits for progress instead of repeatedly fetching empty pages', async ({
  page,
}) => {
  const { requests, status } = await mockArchive(page, tip - 49);
  await signIn(page);
  await navigate(page, 'Blocks');
  await expect(page.locator('.virtual-block-strip li').first()).toBeVisible();
  await page.locator('.virtual-block-strip').evaluate((node) => {
    node.scrollLeft = node.scrollWidth;
  });

  await expect(page.locator('.block-history')).toContainText('You’ve reached the indexed history');
  const count = requests.length;
  await page.waitForTimeout(1200);
  expect(requests.length).toBe(count);
  status.headers = 100;
  // Explicitly refreshing fetches the new progress, allowing one more frontier request.
  await page.getByRole('button', { name: 'Refresh node data' }).click();
  await expect.poll(() => requests.length).toBeGreaterThan(count);
});

test('historical goggles and long-term economics remain accessible in both themes and languages', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  await mockArchive(page);
  await signIn(page);
  await navigate(page, 'Blocks');
  await page.getByLabel('Block height', { exact: true }).fill(String(tip - 200));
  await page.locator('.block-height-form').getByRole('button', { name: 'Go', exact: true }).click();
  const choose = page.getByRole('button', { name: 'Inspect block 899,923', exact: true });
  await expect(choose).toBeVisible();
  await choose.focus();
  await choose.press('Enter');
  await expect(page.locator('.selected-block-panel')).toBeFocused();
  await expect(page.locator('.selected-block-panel .transaction-mosaic canvas')).toBeVisible();
  await page.locator('.view-navigation').getByRole('link', { name: 'Analytics' }).click();
  const economics = page.locator('.block-economics');
  await economics.getByLabel('Chart time range').selectOption('all');
  await expect(economics.getByRole('img')).toHaveCount(4);
  await expect(economics).toContainText('Mean block median fee rate');
  await expect(page.locator('.block-history table')).toHaveCount(0);
  await mkdir('../.impeccable/review', { recursive: true });

  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `../.impeccable/review/blocks-browser-${info.project.name}-${theme}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }

  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByLabel('Language').selectOption('de');
  await page.locator('.view-navigation').getByRole('link', { name: 'Explorer' }).click();
  await expect(page.locator('.block-history')).toContainText('Blöcke entdecken');
  await page.locator('.view-navigation').getByRole('link', { name: 'Analyse' }).click();
  await expect(economics).toContainText('Gesamte Historie');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('height search validates input and reaches genesis without a duplicate block table', async ({
  page,
}) => {
  await mockArchive(page);
  await signIn(page);
  await navigate(page, 'Blocks');
  const input = page.getByLabel('Block height', { exact: true });
  const go = page.locator('.block-height-form').getByRole('button', { name: 'Go', exact: true });

  for (const invalid of ['-1', '1.5', '900124', '']) {
    await input.fill(invalid);
    await go.click();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('alert')).toContainText('Enter a whole block height');
  }

  await input.fill('0');
  await go.click();
  await expect(page.getByRole('button', { name: 'Inspect block 0', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Scroll to older blocks' })).toBeDisabled();
  await expect(page.locator('.block-history table')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
