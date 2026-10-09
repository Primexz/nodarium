import { test, expect } from '@playwright/test';
import { navigate, signIn } from './fixtures';

test('overview stays compact and links to focused mining and node pages', async ({ page }) => {
  const historyRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/1.0/history')) historyRequests.push(request.url());
  });

  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Up to date', exact: true })).toBeVisible();
  await expect(page.locator('.metrics-grid .metric')).toHaveCount(4);
  await expect(
    page.getByRole('button', { name: 'Inspect block 900,123', exact: true }),
  ).toBeVisible();

  await expect(
    page.locator('.peer-map-panel, .mining-charts, .peers-table, .range-picker'),
  ).toHaveCount(0);

  expect(historyRequests).toEqual([]);

  await page.locator('.overview-links').getByRole('link', { name: 'Mining', exact: true }).click();
  await expect(page).toHaveURL(/\/mining$/);
  await expect(page.getByRole('region', { name: 'Difficulty period', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Network mining', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '7d', exact: true }).click();
  await navigate(page, 'Network traffic');
  await expect(page.getByRole('button', { name: '7d', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await navigate(page, 'Overview');
  await page
    .locator('.overview-links')
    .getByRole('link', { name: 'Node details', exact: true })
    .click();

  await expect(page).toHaveURL(/\/node$/);
  await expect(page.getByRole('heading', { name: 'Node essentials', exact: true })).toBeVisible();
  await expect(page.getByText('70,016', { exact: true })).toBeVisible();
  await expect(page.locator('.node-details')).toContainText('Satoshi:28.1.0');
  await expect(page.locator('.node-details')).toContainText('Enabled');
  await page.goBack();
  await expect(page).toHaveURL(/\/overview$/);
});

test('new pages support direct reloads and German navigation', async ({ page }) => {
  await signIn(page);

  for (const [route, heading] of [
    ['/mining', 'Mining across the network.'],
    ['/node', 'Your node, in detail.'],
  ]) {
    await page.goto(route!);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }

  await page.getByLabel('Language', { exact: true }).selectOption('de');
  await expect(
    page.getByRole('heading', { name: 'Dein Node im Detail.', exact: true }),
  ).toBeVisible();

  await navigate(page, 'Mining');
  await expect(
    page.getByRole('heading', { name: 'Mining im Netzwerk.', exact: true }),
  ).toBeVisible();

  await navigate(page, 'Node-Details');
  await expect(page.locator('.node-details')).toContainText('Bitcoin-Core-Version');
});
