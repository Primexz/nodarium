import { test, expect } from '@playwright/test';
import { navigate, signIn } from './fixtures';

test('expanded mempool details align both metric rows', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page);
  await page.getByLabel('Language', { exact: true }).selectOption('de');
  const details = page.locator('.mempool-policy');
  await details.locator('summary').click();
  const widths = info.project.name === 'desktop' ? [1440, 2048] : [390];

  for (const width of widths) {
    await page.setViewportSize({ width, height: info.project.name === 'desktop' ? 1100 : 844 });

    for (const theme of ['light', 'dark']) {
      await page.getByLabel('Darstellung', { exact: true }).selectOption(theme);
      const metrics = details.locator('.metric');
      await expect(metrics).toHaveCount(4);
      await expect(metrics.nth(2).locator('dt')).toHaveText('Speicherverbrauch');
      const positions = await metrics.evaluateAll((items) =>
        items.map((item) => ({
          left: item.querySelector('dt')!.getBoundingClientRect().left,
          top: item.getBoundingClientRect().top,
          bottom: item.getBoundingClientRect().bottom,
        })),
      );

      expect(positions[2]!.left).toBeCloseTo(positions[0]!.left, 1);
      expect(positions[3]!.left).toBeCloseTo(positions[1]!.left, 1);
      expect(positions[2]!.top - positions[0]!.bottom).toBeGreaterThanOrEqual(24);
      await expect(metrics.nth(2)).toHaveCSS('border-left-width', '0px');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );

      await page.evaluate(() => window.scrollTo(0, 0));
      const device = width === 2048 ? 'user-2048' : info.project.name;
      await page.screenshot({
        path: `../.impeccable/review/mempool-policy-${device}-${theme}.png`,
        fullPage: true,
      });
    }
  }
});

test('exploration leads four destinations and every feature has a focused view', async ({
  page,
}) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/mempool$/);
  await expect(page.locator('.view-navigation')).toHaveCSS('flex-direction', 'row');
  const menu = page.getByRole('button', { name: 'Open navigation' });

  if (await menu.isVisible()) await menu.click();

  await expect(page.getByRole('navigation', { name: 'Workspace' }).getByRole('link')).toHaveText([
    'Mempool',
    'Blocks',
    'Mining',
    'My node',
  ]);

  if (await menu.isVisible()) await page.getByRole('button', { name: 'Close navigation' }).click();

  await expect(page.locator('.fee-estimates')).toBeVisible();
  await expect(page.locator('.projected-section')).toBeVisible();
  await expect(page.locator('.activity-transactions-table')).toBeVisible();
  await expect(page.locator('.fee-history')).toHaveCount(0);
  await navigate(page, 'Trends');
  await expect(page.locator('.fee-history')).toBeVisible();
  await expect(page.locator('.activity-page')).toHaveCount(0);
  await navigate(page, 'Mining');
  await expect(page.getByRole('region', { name: 'Difficulty period', exact: true })).toBeVisible();
  await expect(page.locator('.mining-charts')).toBeVisible();
  await expect(page.locator('.mining-pools')).toHaveCount(0);
  await navigate(page, 'Pools');
  await expect(page.locator('.mining-pools')).toBeVisible();
  await expect(page.locator('.pool-history')).toBeVisible();
  await navigate(page, 'My node');
  await expect(page.getByRole('heading', { name: 'Node essentials' })).toBeVisible();
  await expect(page.locator('.node-details')).toContainText('Satoshi:28.1.0');
  await expect(page.locator('.node-details')).toContainText('Enabled');
  await expect(page.locator('.block-strip')).toHaveCount(0);
  await navigate(page, 'Peers');
  const tableTop = await page
    .locator('.peers-table')
    .evaluate((node) => node.getBoundingClientRect().top);

  const mapTop = await page
    .locator('.peer-map-panel')
    .evaluate((node) => node.getBoundingClientRect().top);

  const metricsTop = await page
    .locator('#content > .metrics-grid')
    .evaluate((node) => node.getBoundingClientRect().top);

  expect(metricsTop).toBeLessThan(mapTop);
  expect(mapTop).toBeLessThan(tableTop);
  await navigate(page, 'Traffic');
  await expect(page.locator('.chart-panel')).toHaveCount(1);
  const download = page
    .locator('.chart-legend')
    .getByRole('button', { name: 'Download', exact: true });

  await download.click();
  await expect(download).toHaveAttribute('aria-pressed', 'false');
  await download.click();
  await expect(download).toHaveAttribute('aria-pressed', 'true');
  await navigate(page, 'Events');
  await expect(page.locator('.activity-timeline')).toBeVisible();
  await expect(page.locator('.projected-section')).toHaveCount(0);
});

test('history ranges are independent and remembered through navigation and reload', async ({
  page,
}) => {
  await signIn(page);
  await navigate(page, 'Trends');
  await page.getByRole('button', { name: '7d', exact: true }).click();
  await navigate(page, 'Traffic');
  await expect(page.getByRole('button', { name: '24h', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByRole('button', { name: '1y', exact: true }).click();
  await navigate(page, 'Peers');
  await expect(page.getByRole('button', { name: '24h', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await navigate(page, 'Trends');
  await expect(page.getByRole('button', { name: '7d', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.reload();
  await expect(page.getByRole('button', { name: '7d', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await navigate(page, 'Traffic');
  await expect(page.getByRole('button', { name: '1y', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('block inspection and browser position survive analytics and browser Back', async ({
  page,
}) => {
  await signIn(page);
  await navigate(page, 'Blocks');
  await page.getByRole('button', { name: 'Inspect block 900,122', exact: true }).click();
  const browser = page.locator('.virtual-block-strip');
  await browser.evaluate((node) => {
    node.scrollLeft = 172;
  });

  const offset = await browser.evaluate((node) => node.scrollLeft);
  await page.locator('.view-navigation').getByRole('link', { name: 'Analytics' }).click();
  await expect(page.locator('.block-economics')).toBeVisible();
  await expect(page.locator('.selected-block-panel')).toBeHidden();
  await page.goBack();
  await expect(
    page.getByRole('region', { name: 'Block 900,122 details', exact: true }),
  ).toBeVisible();

  await expect.poll(() => browser.evaluate((node) => node.scrollLeft)).toBe(offset);
});

test('new routes reload, German navigation works, and old URLs have no redirects', async ({
  page,
}) => {
  await signIn(page);

  for (const route of [
    '/mempool/trends',
    '/blocks/analytics',
    '/mining/pools',
    '/node/peers',
    '/node/traffic',
    '/node/events',
  ]) {
    await page.goto(route);
    await expect(page.locator('.view-navigation a[aria-current="page"]')).toHaveCount(1);
    await page.reload();
    await expect(page.locator('.view-navigation a[aria-current="page"]')).toHaveCount(1);
  }

  await page.getByLabel('Language', { exact: true }).selectOption('de');
  await navigate(page, 'Mein Node');
  await expect(page.getByRole('heading', { name: 'Mein Node', exact: true })).toBeVisible();
  await expect(page.locator('.node-details')).toContainText('Bitcoin-Core-Version');
  await navigate(page, 'Peers');
  await expect(page.locator('.view-navigation a[aria-current="page"]')).toHaveText('Peers');
  await page.getByLabel('Sprache', { exact: true }).selectOption('en');

  for (const route of ['/overview', '/peers', '/traffic', '/activity', '/blocks/unknown']) {
    await page.goto(route);
    await expect(page).toHaveURL(new RegExp(`${route}$`));
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  }
});
