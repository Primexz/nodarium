import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { navigate, signIn } from './fixtures';
import type {
  Block,
  PoolDetail,
  PoolHistoryRange,
  PoolMetrics,
  PoolTrends,
  PoolTrendPoint,
} from '../src/types';

// Synthetic observations exercise history, coverage and layouts independently
// of the fixture indexer's backfill speed. Pool IDs and logos use bundled data.
function history(range: PoolHistoryRange): PoolTrends {
  const now = Date.now();
  const points: PoolTrendPoint[] = Array.from({ length: 90 }, (_, i) => ({
    at: now - (89 - i) * 8 * 3600000,
    blocks: i === 20 ? 0 : 48,
    counts:
      i === 20
        ? {}
        : {
            'pool-36': 10 + (i % 8),
            'pool-44': 10,
            'pool-73': 8,
            'pool-111': 6,
            'pool-1': 4,
            unknown: 5 - (i % 4),
            unavailable: 0,
          },
  }));

  // Keep the same denominator in every observed bucket.
  for (const point of points) {
    if (point.blocks)
      point.counts.unavailable =
        point.blocks -
        Object.values(point.counts).reduce((sum, count) => sum + count, 0) +
        point.counts.unavailable!;
  }

  const pools: PoolMetrics[] = [
    { id: 36, name: 'F2Pool', link: 'https://f2pool.com' },
    { id: 44, name: 'AntPool', link: 'https://antpool.com' },
    { id: 73, name: 'ViaBTC', link: 'https://viabtc.com' },
    { id: 111, name: 'Foundry USA', link: 'https://foundrydigital.com' },
    { id: 1, name: 'Unknown historic operator', link: '' },
    null,
    null,
  ].map((pool, index) => {
    const key = pool ? `pool-${pool.id}` : index === 5 ? 'unknown' : 'unavailable';
    const blocks = points.reduce((sum, point) => sum + (point.counts[key] ?? 0), 0);

    return {
      pool,
      key,
      blocks,
      share_percent: (blocks / (89 * 48)) * 100,
      transaction_blocks: Math.floor(blocks * 0.9),
      empty_blocks: 3,
      empty_percent: (3 / Math.floor(blocks * 0.9)) * 100,
      weight_blocks: blocks,
      capacity_percent: 92.6,
      fee_blocks: blocks - 10,
      average_fees_btc: 0.02749123,
    };
  });

  return {
    range,
    status: 'ready',
    start: points[0]!.at,
    end: now,
    height: 900123,
    interval_seconds: 28800,
    blocks: 89 * 48,
    attributed_blocks: pools.slice(0, 5).reduce((sum, pool) => sum + pool.blocks, 0),
    classified_blocks: pools.slice(0, 6).reduce((sum, pool) => sum + pool.blocks, 0),
    indexed_blocks: 900124,
    target_blocks: 900124,
    partial: true,
    stale: false,
    pools,
    points,
    definitions: {
      source: 'https://github.com/mempool/mining-pools',
      commit: '9db63a82a46a75c6320a6aa5801afcdb35306aa7',
      sha256: '',
    },
  };
}

async function mockHistory(page: Page, blocks: () => Block[] = () => []) {
  await page.route('**/api/1.0/mining/pools/history?**', (route) => {
    const range = new URL(route.request().url()).searchParams.get('range') as PoolHistoryRange;

    return route.fulfill({ json: history(range) });
  });

  await page.route('**/api/1.0/mining/pools/36?**', (route) => {
    const range = new URL(route.request().url()).searchParams.get('range') as PoolHistoryRange;
    const data: PoolDetail = {
      pool: { id: 36, name: 'F2Pool', link: 'https://f2pool.com' },
      history: history(range),
      recent_blocks: blocks(),
    };

    return route.fulfill({ json: data });
  });
}

test('historical trends link to shareable pool pages and inspect pool blocks', async ({ page }) => {
  let blocks: Block[] = [];
  await mockHistory(page, () => blocks);
  await signIn(page);
  blocks = (await (await page.request.get('/api/1.0/blocks')).json()).data.filter(
    (block: Block) => block.height % 5 === 3,
  );

  await navigate(page, 'Pools');
  const history = page.getByRole('region', { name: 'Historical mining pools', exact: true });
  await expect(history.locator('.chart canvas')).toBeVisible();
  await expect(history).toContainText('Unavailable');
  await expect(page.locator('.mining-pools table, .pool-history table')).toHaveCount(0);
  await history.getByLabel('Pool history range').selectOption('7d');
  await expect(history.getByLabel('Pool history range')).toHaveValue('7d');
  await history.getByText('Block share over time — Data table', { exact: true }).click();
  await expect(history.locator('table')).toHaveCount(1);
  await expect(history.locator('.chart-data')).toContainText('90');
  await history.getByRole('link', { name: 'F2Pool', exact: true }).last().click();
  await expect(page).toHaveURL(/\/mining\/pools\/36\?range=7d$/);
  await expect(page.getByRole('heading', { name: 'F2Pool', exact: true })).toBeVisible();
  await expect(page.locator('.pool-metrics')).toContainText('92.60%');
  await expect(page.locator('.pool-metrics')).toContainText('0.02749123 BTC');
  await page.getByLabel('Pool history range').selectOption('1y');
  await expect(page).toHaveURL(/range=1y$/);
  await page.reload();
  await expect(page.getByLabel('Pool history range')).toHaveValue('1y');
  await page.getByRole('button', { name: 'Inspect block 900,123', exact: true }).click();
  await expect(page.locator('.block-goggles')).toBeVisible();
  await expect(page.locator('.block-pool')).toContainText('F2Pool');
  await page.getByRole('link', { name: 'Back to pools' }).click();
  await expect(page).toHaveURL(/\/mining\/pools\?range=1y$/);
});

test('pool history and details retain accessible desktop and mobile layouts in both languages', async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let blocks: Block[] = [];
  await mockHistory(page, () => blocks);
  await signIn(page);
  blocks = (await (await page.request.get('/api/1.0/blocks')).json()).data.filter(
    (block: Block) => block.height % 5 === 3,
  );

  await navigate(page, 'Pools');
  await expect(page.locator('.pool-history .chart canvas')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `../.impeccable/review/pool-history-${info.project.name}.png`,
    fullPage: true,
  });

  await page
    .locator('.pool-history')
    .getByRole('link', { name: 'F2Pool', exact: true })
    .last()
    .click();

  await expect(page.locator('.pool-metrics')).toBeVisible();
  await expect(page.locator('.pool-trend-chart canvas')).toBeVisible();

  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );

    const audit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(
      audit.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })),
    ).toEqual([]);

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `../.impeccable/review/pool-detail-${info.project.name}-${theme}.png`,
      fullPage: true,
    });
  }

  await page.getByLabel('Language', { exact: true }).selectOption('de');
  await expect(page.getByRole('heading', { name: 'Pool-Aktivität' })).toBeVisible();
  await expect(page.getByLabel('Zeitraum der Pool-Historie')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `../.impeccable/review/pool-detail-${info.project.name}-german.png`,
    fullPage: true,
  });
});

test('pool history handles empty, offline, unsupported, failed and unknown pool states', async ({
  page,
}) => {
  await mockHistory(page);
  await signIn(page);
  await page.goto('/mining/pools/999999');
  await expect(page.getByText('Pool not found', { exact: true })).toBeVisible();
  let state: 'empty' | 'offline' | 'unsupported' | 'failed' = 'empty';
  await page.route('**/api/1.0/mining/pools/history?**', (route) => {
    if (state === 'failed') return route.fulfill({ status: 503, json: { error: 'Unavailable' } });

    const data = history('30d');

    if (state === 'empty') {
      data.blocks = 0;
      data.pools = [];
      data.points = [];
    }

    if (state === 'offline') {
      data.stale = true;
      data.status = 'offline';
    }

    if (state === 'unsupported') data.status = 'unsupported';

    return route.fulfill({ json: data });
  });

  await navigate(page, 'Pools');
  const region = page.getByRole('region', { name: 'Historical mining pools', exact: true });
  await expect(region).toContainText('No indexed blocks in this period');
  state = 'offline';
  await page.getByRole('button', { name: 'Refresh node data' }).click();
  await expect(region).toContainText('Your node is currently unavailable');
  state = 'failed';
  await page.getByRole('button', { name: 'Refresh node data' }).click();
  await expect(region).toContainText('could not be refreshed');
  await expect(region.locator('canvas')).toBeVisible();
  state = 'unsupported';
  await region.getByRole('button', { name: 'Try again' }).click();
  await expect(region).toContainText('Bitcoin mainnet');
  await expect(region.locator('canvas')).toHaveCount(0);
});
