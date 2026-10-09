import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { navigate, signIn } from './fixtures';
import type { PoolDistribution } from '../src/types';

test('local coinbases build official pool shares for both block windows', async ({ page }) => {
  test.setTimeout(60000);
  expect((await page.request.get('/api/v1/mining/pools')).status()).toBe(401);
  const outbound: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:18080/')) outbound.push(request.url());
  });

  await signIn(page);
  await navigate(page, 'Mining');
  const pools = page.getByRole('region', { name: 'Mining pools', exact: true });
  await expect(pools.getByRole('button', { name: 'Last 144 blocks', exact: true })).toHaveClass(
    'active',
  );

  await expect(pools.locator('.pool-sample')).toContainText('144 / 144', { timeout: 30000 });
  await expect(pools.locator('.pool-table')).toContainText('Unknown');
  await expect(pools.locator('.pool-table')).toContainText('Foundry USA');
  await expect(pools.locator('.pool-table')).toContainText('F2Pool');
  await expect(
    pools.locator('.pool-name').filter({ hasText: 'F2Pool' }).locator('img'),
  ).toHaveAttribute('src', /^\/assets\/f2pool-[^/]+\.svg$/);

  await expect(pools.locator('.pool-pie canvas')).toBeVisible();
  const body: PoolDistribution = await (
    await page.request.get('/api/v1/mining/pools?blocks=144')
  ).json();

  expect(body.status).toBe('ready');
  expect(body.scanned).toBe(144);
  expect(body.shares.reduce((total, share) => total + share.blocks, 0)).toBe(144);
  expect(body.shares.reduce((total, share) => total + share.percent, 0)).toBeCloseTo(100);
  expect(body.definitions.source).toBe('https://github.com/mempool/mining-pools');
  expect(body.definitions.commit).toMatch(/^[0-9a-f]{40}$/);
  expect((await page.request.get('/api/v1/mining/pools?blocks=0')).status()).toBe(400);
  await pools.getByRole('button', { name: 'Last 1,008 blocks', exact: true }).click();
  await expect(pools.getByRole('button', { name: 'Last 1,008 blocks', exact: true })).toHaveClass(
    'active',
  );

  await expect(pools.getByRole('button', { name: 'Last 144 blocks', exact: true })).not.toHaveClass(
    'active',
  );

  await expect(pools.locator('.pool-sample')).toContainText('1,008 / 1,008', { timeout: 45000 });
  expect(outbound).toEqual([]);
  await navigate(page, 'Overview');
  await page.getByRole('button', { name: 'Inspect block 900,123', exact: true }).click();
  const miner = page.getByRole('group', { name: 'Mining pool', exact: true });
  await expect(miner).toContainText('F2Pool');
  await expect(miner).toContainText('Identified from a coinbase payout address');
  await expect(miner.locator('img')).toHaveAttribute('src', /^\/assets\/f2pool-[^/]+\.svg$/);
  await expect(miner.locator('img')).toHaveJSProperty('naturalWidth', 80);
  expect(outbound).toEqual([]);
  expect(
    (
      await (
        await page.request.get(
          `/api/v1/blocks/${(900123).toString(16).padStart(64, '0')}/transactions`,
        )
      ).json()
    ).mining_pool.pool.name,
  ).toBe('F2Pool');
});

test('pool chart shows partial, syncing, unsupported and failed refresh states', async ({
  page,
}) => {
  let status: PoolDistribution['status'] = 'indexing';
  let failed = false;
  await page.route('**/api/v1/mining/pools?**', async (route) => {
    if (failed) {
      await route.fulfill({ status: 503, json: { error: 'Unavailable' } });

      return;
    }

    const count = ['syncing', 'unsupported'].includes(status) ? 0 : 16;
    const view: PoolDistribution = {
      status,
      stale: false,
      window: 144,
      target: 144,
      scanned: count,
      height: 900123,
      tip: 'tip',
      updated_at: new Date().toISOString(),
      shares: count ? [{ pool: null, blocks: count, percent: 100 }] : [],
      definitions: {
        source: 'https://github.com/mempool/mining-pools',
        commit: '9db63a82a46a75c6320a6aa5801afcdb35306aa7',
        sha256: '',
      },
    };

    await route.fulfill({ json: view });
  });

  await signIn(page);
  await navigate(page, 'Mining');
  const pools = page.getByRole('region', { name: 'Mining pools', exact: true });
  await expect(pools.getByRole('progressbar')).toHaveAttribute('value', '16');
  status = 'partial';
  await page.getByRole('button', { name: 'Refresh node data' }).click();
  await expect(pools.getByRole('alert')).toContainText('only the blocks read successfully');
  failed = true;
  await page.getByRole('button', { name: 'Refresh node data' }).click();
  await expect(pools).toContainText('Showing an earlier sample');
  await expect(pools.locator('.pool-pie canvas')).toBeVisible();
  failed = false;

  for (const [nextStatus, note] of [
    ['syncing', 'synchronizing'],
    ['unsupported', 'Bitcoin mainnet'],
  ] as const) {
    status = nextStatus;
    await page.getByRole('button', { name: 'Refresh node data' }).click();
    await expect(pools).toContainText(note);
    await expect(pools.locator('.pool-pie')).toHaveCount(0);
  }
});

test('pool chart and block attribution support themes, German and accessible layouts', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page);
  await navigate(page, 'Mining');
  const pools = page.getByRole('region', { name: 'Mining pools', exact: true });
  await expect(pools.locator('.pool-sample')).toContainText('144 / 144', { timeout: 30000 });

  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);
    const foundry = pools.locator('.pool-name').filter({ hasText: 'Foundry USA' }).locator('img');
    await expect(foundry).toHaveAttribute(
      'src',
      theme === 'light'
        ? /^\/assets\/foundryusa\.light-[^/]+\.svg$/
        : /^\/assets\/foundryusa-[^/]+\.svg$/,
    );

    await expect(foundry).toHaveJSProperty('complete', true);
    expect(await foundry.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(
      0,
    );

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );

    const audit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(
      audit.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })),
    ).toEqual([]);

    await page.evaluate(async () => {
      window.scrollTo(0, 0);
      await document.fonts.ready;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });

    await page.screenshot({
      path: `../.impeccable/review/logos-${info.project.name}-${theme}.png`,
      fullPage: true,
    });
  }

  await page.getByLabel('Language', { exact: true }).selectOption('de');
  await expect(page.locator('.mining-pools .pool-table')).toContainText('Unbekannt');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `../.impeccable/review/logos-${info.project.name}-german.png`,
    fullPage: true,
  });

  await navigate(page, 'Übersicht');
  await page.getByRole('button', { name: 'Block 900.123 ansehen', exact: true }).click();
  await expect(page.locator('.block-pool')).toContainText('F2Pool');
  await expect(page.locator('.block-pool')).toContainText('Coinbase-Auszahlungsadresse');
  await expect(page.locator('.block-pool img')).toHaveJSProperty('naturalWidth', 80);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `../.impeccable/review/logos-${info.project.name}-block.png`,
    fullPage: true,
  });
});
