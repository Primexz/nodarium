import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { navigate, signIn } from './fixtures';
import type { DatabaseSize, Section } from '../src/types';

test('node overview reports real database storage with localized responsive readings', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page);
  await navigate(page, 'My node');
  const response = await page.request.get('/api/1.0/overview');
  const body = await response.json();
  expect(body.database.data.size_bytes).toBeGreaterThan(0);
  expect(body.database.data.driver).toBe('sqlite');
  expect(body.database.data.in_memory).toBe(false);
  expect(body.database.updated_at).toBeTruthy();
  expect(body.database.stale).toBe(false);
  const widths = info.project.name === 'desktop' ? [1440, 2048] : [390];

  for (const width of widths) {
    await page.setViewportSize({ width, height: info.project.name === 'desktop' ? 1100 : 844 });

    for (const language of ['en', 'de']) {
      await page.locator('.preference-picker select').first().selectOption(language);
      const label = language === 'en' ? 'Nodarium database' : 'Nodarium-Datenbank';
      const metric = page.locator('.node-metrics .metric').filter({ hasText: label });
      await expect(metric.locator('dd > span')).toHaveText(/\d.*(?:KiB|MiB|GiB)/);

      for (const theme of ['light', 'dark']) {
        await page.locator('.preference-picker select').nth(1).selectOption(theme);
        await expect(page.locator('.node-metrics .metric')).toHaveCount(6);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );

        const labelsFit = await page
          .locator('.node-metrics dt')
          .evaluateAll((labels) => labels.every((label) => label.scrollWidth <= label.clientWidth));

        expect(labelsFit).toBe(true);
        const accessibility = await new AxeBuilder({ page }).include('#content').analyze();
        expect(accessibility.violations).toEqual([]);
        await page.evaluate(() => window.scrollTo(0, 0));
        const device = width === 2048 ? 'user-2048' : info.project.name;
        await page.screenshot({
          path: `../.impeccable/review/database-${device}-${language}-${theme}.png`,
          fullPage: true,
        });
      }
    }
  }
});

test('database readings distinguish PostgreSQL, memory, stale, zero, and unavailable sizes', async ({
  page,
}) => {
  let database: Section<DatabaseSize> = {
    data: { size_bytes: 134217728, driver: 'postgres', in_memory: false },
    updated_at: new Date().toISOString(),
    stale: false,
  };

  await page.route('**/api/1.0/overview', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ json: { ...body, database } });
  });

  await signIn(page);
  await navigate(page, 'My node');
  const metric = page.locator('.node-metrics .metric').filter({ hasText: 'Nodarium database' });
  await expect(metric).toContainText('128.00 MiB');
  await expect(metric).toContainText('Configured PostgreSQL database');
  database = { ...database, data: { ...database.data!, driver: 'sqlite', in_memory: true } };
  await page.getByRole('button', { name: 'Refresh node data' }).click();
  await expect(metric).toContainText('SQLite · in memory');
  database = { ...database, stale: true, error: 'database size unavailable' };
  await page.getByRole('button', { name: 'Refresh node data' }).click();
  await expect(metric).toContainText('128.00 MiB');
  await expect(metric).toContainText('Could not refresh · last available reading');
  database = { ...database, data: null };
  await page.getByRole('button', { name: 'Refresh node data' }).click();
  await expect(metric.locator('dd > span')).toHaveText('—');
  await expect(metric).toContainText('Database size unavailable');
  database = {
    ...database,
    data: { size_bytes: 0, driver: 'postgres', in_memory: false },
    stale: false,
    error: undefined,
  };

  await page.getByRole('button', { name: 'Refresh node data' }).click();
  await expect(metric.locator('dd > span')).toHaveText('0 B');
  await expect(metric).toContainText('Configured PostgreSQL database');
});
