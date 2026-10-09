import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Block, OverviewResponse, Section } from '../src/types';
import { navigate, signIn } from './fixtures';

test('Core block economics are exported through the existing authenticated blocks API', async ({
  page,
  request,
}) => {
  expect((await request.get('/api/v1/blocks')).status()).toBe(401);
  await signIn(page);
  const response = await page.request.get('/api/v1/blocks');
  expect(response.ok()).toBe(true);
  const section: Section<Block[]> = await response.json();
  expect(section.data).toHaveLength(10);
  expect(section.data![0].subsidy_sats).toBe('312500000');
  expect(section.data![0].average_fee_rate).toBe(12);
  await navigate(page, 'Recent blocks');
  const panel = page.locator('.block-economics');
  await expect(panel.getByRole('img')).toHaveCount(4);
  await panel.locator('summary').first().click();
  await expect(panel.getByRole('table')).toBeVisible();
  await expect(panel.getByText('3.12500000 BTC', { exact: true })).toHaveCount(10);
});

test('block economics preserve exact tables, gaps, zeroes, stale data and localized responsive charts', async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let mode: 'ready' | 'partial' | 'failed' | 'unavailable' | 'empty' = 'ready';
  let syncing = false;
  await page.route('**/api/v1/blocks', async (route) => {
    if (mode === 'failed')
      return route.fulfill({ status: 503, json: { error: 'RPC unavailable' } });

    const response = await route.fetch();
    const section: Section<Block[]> = await response.json();
    section.data =
      mode === 'empty'
        ? []
        : section.data!.map((block, i) => ({
            ...block,
            // These synthetic economics fixtures exercise variation across a halving.
            subsidy_sats: i < 5 ? '312500000' : '625000000',
            total_fees_sats: String(i * 1234567),
            average_fee_rate: i * 3,
            median_fee_rate: i * 2,
            capacity_percent: 100 - i * 7,
          }));

    if (mode === 'partial' || mode === 'unavailable') {
      for (const block of mode === 'partial' ? [section.data![4]] : section.data!) {
        block.subsidy_sats = null;
        block.average_fee_rate = null;
        block.median_fee_rate = null;
        block.capacity_percent = null;
      }
    }

    return route.fulfill({ json: section });
  });

  await page.route('**/api/v1/overview', async (route) => {
    const response = await route.fetch();
    const body: OverviewResponse = await response.json();
    body.overview.data!.blockchain.initialblockdownload = syncing;

    return route.fulfill({ json: body });
  });

  await signIn(page);
  await expect(page.locator('.block-economics')).toHaveCount(0);
  await navigate(page, 'Recent blocks');
  const panel = page.locator('.block-economics');
  await expect(panel.getByRole('img')).toHaveCount(4);
  await expect(panel.locator('.chart-empty')).toHaveCount(0);

  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);
    const audit = await new AxeBuilder({ page })
      .include('.block-economics')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(audit.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `../.impeccable/review/economics-${info.project.name}-${theme}.png`,
      fullPage: true,
    });
  }

  await page.getByLabel('Language', { exact: true }).selectOption('de');
  await expect(panel.getByRole('heading', { name: 'Blockökonomie', exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `../.impeccable/review/economics-${info.project.name}-de.png`,
    fullPage: true,
  });

  await page.getByLabel('Sprache', { exact: true }).selectOption('en');
  const reward = panel.getByRole('region', { name: 'Subsidy and fees', exact: true });
  await reward.locator('summary').click();
  const rows = reward.locator('tbody tr');
  await expect(rows).toHaveCount(10);
  const heights = await rows.locator('th').allTextContents();
  expect(heights.map((height) => Number(height.replaceAll(',', '')))).toEqual(
    heights.map((height) => Number(height.replaceAll(',', ''))).sort((a, b) => a - b),
  );

  await expect(rows.last()).toContainText('0.00000000 BTC');
  await expect(rows.first()).toContainText('6.36111103 BTC');
  const share = panel.getByRole('region', { name: 'Fee share of reward', exact: true });
  await share.locator('summary').click();
  await expect(share.locator('tbody tr').last()).toContainText('0.00%');
  const refresh = page.getByRole('button', { name: 'Refresh node data' });
  mode = 'partial';
  await refresh.click();
  await expect(panel.getByRole('status')).toContainText('Some block statistics are unavailable');
  await expect(reward.locator('tbody tr').nth(5)).toContainText('—');
  await expect(share.locator('tbody tr').nth(5)).toContainText('No reading');
  mode = 'failed';
  await refresh.click();
  await expect(panel.getByRole('alert')).toContainText(
    'Showing the last collected block statistics',
  );

  await expect(reward.locator('tbody tr')).toHaveCount(10);
  mode = 'unavailable';
  syncing = true;
  await refresh.click();
  await expect(panel.locator('.chart-empty')).toHaveCount(4);
  await expect(panel).toContainText('Your node is syncing');
  await expect(reward.locator('tbody tr')).toHaveCount(10);
  mode = 'empty';
  await refresh.click();
  await expect(panel.getByRole('img')).toHaveCount(0);
  await expect(panel).toContainText('No block headers yet');
  expect(errors).toEqual([]);
});
