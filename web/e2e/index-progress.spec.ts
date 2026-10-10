import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { navigate, signIn } from './fixtures';
import type { BlockIndexStatus } from '../src/types';

function index(): BlockIndexStatus {
  return {
    status: 'indexing',
    height: 1999999,
    tip: 'tip',
    target: 2000000,
    headers: 600000,
    statistics: 600000,
    pools: 600000,
    pruned: 0,
    oldest_height: 1400000,
    updated_at: new Date().toISOString(),
    stale: false,
  };
}

test('one top-bar index progress survives navigation, localizes, updates and disappears on completion', async ({
  page,
}, info) => {
  const data = index();
  await page.route('**/api/1.0/blocks/index', (route) => route.fulfill({ json: data }));
  await signIn(page);
  const progress = page
    .locator('.topbar')
    .getByRole('group', { name: /^(Block index|Block-Index)$/ });

  await expect(progress).toContainText('600,000 / 2,000,000 blocks · 30.0%');
  await expect(progress.getByRole('progressbar')).toHaveAttribute('value', '600000');

  for (const name of ['Mining', 'Blocks', 'Node details', 'Overview']) {
    await navigate(page, name);
    await expect(progress).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Block indexing progress' })).toHaveCount(1);
    await expect(page.locator('.page-content .pool-progress')).toHaveCount(0);
    await expect(page.locator('.page-content')).not.toContainText('Indexing block history:');
    await expect(page.locator('.page-content')).not.toContainText('Block indexing is incomplete:');
  }

  data.headers = 1234567;
  await page.getByRole('button', { name: 'Refresh node data' }).click();
  await expect(progress).toContainText('1,234,567 / 2,000,000 blocks · 61.7%');

  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );

    await page.screenshot({
      path: `../.impeccable/review/index-progress-${info.project.name}-${theme}.png`,
    });
  }

  await page.getByLabel('Language', { exact: true }).selectOption('de');
  await expect(progress).toContainText('1.234.567 / 2.000.000 Blöcke · 61,7%');
  data.status = 'paused';
  await page.getByRole('button', { name: 'Node-Daten aktualisieren' }).click();
  await expect(progress).toContainText('automatischer Wiederholungsversuch');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `../.impeccable/review/index-progress-${info.project.name}-german.png`,
  });

  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  data.status = 'ready';
  data.headers = data.target;
  await page.getByRole('button', { name: 'Node-Daten aktualisieren' }).click();
  await expect(progress).toHaveCount(0);
});

test('top-bar indexing distinguishes waiting, node sync, offline and failed status from live progress', async ({
  page,
}) => {
  const data = index();
  let failed = true;
  await page.route('**/api/1.0/blocks/index', (route) =>
    failed
      ? route.fulfill({ status: 503, json: { error: 'Unavailable' } })
      : route.fulfill({ json: data }),
  );

  await signIn(page);
  const progress = page
    .locator('.topbar')
    .getByRole('group', { name: /^(Block index|Block-Index)$/ });

  await expect(progress).toContainText('Indexing status unavailable');
  await expect(progress.getByRole('progressbar')).toHaveCount(0);
  failed = false;
  data.status = 'waiting';
  data.target = 0;
  data.headers = 0;
  await progress.getByRole('button', { name: 'Try again' }).click();
  await expect(progress).toContainText('Waiting for block indexing');
  await expect(progress.getByRole('progressbar')).toHaveCount(0);
  await expect(progress).not.toContainText('NaN');

  data.status = 'syncing';
  await page.getByRole('button', { name: 'Refresh node data' }).click();
  await expect(progress).toContainText('waits for node synchronization');
  data.status = 'offline';
  data.target = 2000000;
  data.headers = 600000;
  data.stale = true;
  await page.getByRole('button', { name: 'Refresh node data' }).click();
  await expect(progress).toContainText('Block indexing offline');
  await expect(progress.getByRole('progressbar')).toHaveAccessibleName(
    'Last known indexing progress',
  );

  data.status = 'ready';
  await page.getByRole('button', { name: 'Refresh node data' }).click();
  await expect(progress).toContainText('may be outdated');
  failed = true;
  await page.getByRole('button', { name: 'Refresh node data' }).click();
  await expect(progress).toContainText('Indexing status unavailable');
  await expect(progress).toContainText('600,000 / 2,000,000');
});
