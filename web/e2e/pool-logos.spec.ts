import { test, expect } from '@playwright/test';
import type { PoolDistribution } from '../src/types';
import { navigate, signIn } from './fixtures';

test('unknown and missing pool logos use local theme-aware fallbacks without changing names', async ({
  page,
}) => {
  const outbound: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:18080/')) outbound.push(request.url());
  });

  await page.route('**/api/1.0/mining/pools?**', async (route) => {
    const response = await route.fetch();
    const body: PoolDistribution = await response.json();
    body.status = 'ready';
    body.scanned = 144;
    body.target = 144;
    body.shares = [
      {
        pool: { id: 9999, name: '../../New pool? #1', link: '' },
        blocks: 72,
        percent: 50,
      },
      { pool: null, blocks: 72, percent: 50 },
    ];

    await route.fulfill({ json: body });
  });

  await signIn(page);
  await navigate(page, 'Mining');
  const table = page.locator('.pool-table');
  const missing = table.getByRole('row').filter({ hasText: '../../New pool? #1' });
  const unknown = table.getByRole('row').filter({ hasText: 'Unknown' });

  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);
    const variant = theme === 'light' ? '\\.light' : '';
    await expect(missing.locator('img')).toHaveAttribute(
      'src',
      new RegExp(`^/assets/default${variant}-[^/]+\\.svg$`),
    );

    await expect(unknown.locator('img')).toHaveAttribute(
      'src',
      new RegExp(`^/assets/unknown${variant}-[^/]+\\.svg$`),
    );

    await expect(missing.locator('img')).toHaveJSProperty('complete', true);
    expect(
      await missing.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth),
    ).toBeGreaterThan(0);

    await expect(missing).toContainText('72');
    await expect(missing).toContainText('50.00%');
    await expect(missing.locator('.pool-swatch')).toBeVisible();
  }

  expect(outbound).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('failed images fall back locally, hide broken images, and recover on a theme change', async ({
  page,
}) => {
  await page.route('**/assets/foundryusa.light-*.svg', (route) => route.abort());
  await signIn(page);
  await navigate(page, 'Mining');
  const foundry = page.locator('.pool-name').filter({ hasText: 'Foundry USA' });
  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  await expect(foundry.locator('img')).toHaveAttribute('src', /^\/assets\/foundryusa-[^/]+\.svg$/);
  await expect(foundry).toContainText('Foundry USA');

  // Force a new fallback chain and make every source fail for this row.
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await page.route('**/assets/foundryusa-*.svg', (route) => route.abort());
  await page.route('**/assets/default*.svg', (route) => route.abort());
  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  // Discard already decoded images so the failure fixture reaches every source.
  await page.reload();
  await expect(foundry.locator('img')).toHaveCount(0);
  await expect(foundry).toContainText('Foundry USA');
  await expect(foundry.locator('.pool-logo')).toBeVisible();

  await page.unroute('**/assets/foundryusa.light-*.svg');
  await page.unroute('**/assets/foundryusa-*.svg');
  await page.unroute('**/assets/default*.svg');
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await expect(foundry.locator('img')).toHaveAttribute('src', /^\/assets\/foundryusa-[^/]+\.svg$/);
  await expect
    .poll(() => foundry.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
});
