import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { OverviewResponse } from '../src/types';
import { navigate, signIn } from './fixtures';

test('halving and issuance follow node height, preserve stale estimates and support both languages', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let height = 900123;
  let network = 'main';
  let syncing = false;
  let failed = false;
  let observedAt: string | null = '2026-10-09T12:00:00Z';
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/1.0/overview', async (route) => {
    if (failed) return route.fulfill({ status: 503, body: 'Unavailable' });

    const response = await route.fetch();
    const body: OverviewResponse = await response.json();
    body.overview.updated_at = observedAt;
    Object.assign(body.overview.data!.blockchain, {
      chain: network,
      blocks: height,
      headers: syncing ? height + 1000 : height,
      initialblockdownload: syncing,
    });

    await route.fulfill({ json: body });
  });

  await signIn(page);
  await navigate(page, 'Mining');
  const panel = page.getByRole('region', { name: 'Halving and issuance', exact: true });
  await expect(panel.getByText('149,877', { exact: true })).toBeVisible();
  await expect(panel.locator('dl').getByText('3.12500000 BTC', { exact: true })).toBeVisible();
  await expect(panel.locator('dl').getByText('1.56250000 BTC', { exact: true })).toBeVisible();
  await expect(panel.getByText('19,875,387.50000000 BTC', { exact: true })).toBeVisible();
  await expect(panel.getByText('1,124,612.47690000 BTC', { exact: true })).toBeVisible();
  await expect(panel).toContainText('20,999,999.97690000 BTC');
  await expect(panel).toContainText('not circulating supply');
  await expect(panel.locator('time')).toHaveAttribute('datetime', '2029-08-15T07:30:00.000Z');
  await expect(panel.getByRole('progressbar')).toHaveAttribute('value', '60123');
  await expect(panel.getByRole('table')).toBeHidden();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    fullPage: true,
    path: `../.impeccable/review/halving-workspace-${info.project.name}.png`,
  });

  for (const language of ['en', 'de']) {
    await page.getByRole('combobox', { name: /^(Language|Sprache)$/ }).selectOption(language);

    for (const theme of ['light', 'dark']) {
      await page.getByRole('combobox', { name: /^(Theme|Darstellung)$/ }).selectOption(theme);
      await expect(panel).toHaveCount(language === 'en' ? 1 : 0);
      const localized = page.getByRole('region', {
        name: language === 'en' ? 'Halving and issuance' : 'Halving und Ausgabe',
        exact: true,
      });

      await localized.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );

      const audit = await new AxeBuilder({ page })
        .include(
          'section[aria-label="' +
            (language === 'en' ? 'Halving and issuance' : 'Halving und Ausgabe') +
            '"]',
        )
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      expect(audit.violations).toEqual([]);
      await localized.getByRole('heading', { level: 2 }).click();
      await localized.screenshot({
        path: `../.impeccable/review/halving-${info.project.name}-${language}-${theme}.png`,
      });

      await localized.locator('summary').click();
      await expect(localized.getByRole('table').getByRole('row')).toHaveCount(34);
      await expect(
        localized.getByRole('row').filter({ hasText: language === 'en' ? 'Current' : 'Aktuell' }),
      ).toContainText(language === 'en' ? '3.12500000 BTC' : '3,12500000 BTC');

      if (language === 'en' && theme === 'light') {
        const expandedAudit = await new AxeBuilder({ page })
          .include('section[aria-label="Halving and issuance"]')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();

        expect(expandedAudit.violations).toEqual([]);
        await localized.getByRole('heading', { level: 2 }).click();
        await localized.screenshot({
          path: `../.impeccable/review/halving-epochs-${info.project.name}.png`,
        });
      }

      await localized.locator('summary').click();
    }
  }

  const german = page.getByRole('region', { name: 'Halving und Ausgabe', exact: true });
  await expect(german).toContainText('19.875.387,50000000 BTC');
  await page.getByLabel('Sprache', { exact: true }).selectOption('en');
  const refresh = page.getByRole('button', { name: 'Refresh node data' });
  height = 1049999;
  await refresh.click();
  await expect(panel.locator('dl').getByText('1', { exact: true })).toBeVisible();
  height = 1050000;
  await refresh.click();
  await expect(panel.getByRole('progressbar')).toHaveAttribute('value', '0');
  await expect(panel).toContainText('Subsidy epoch 6');
  await expect(panel.locator('dl').getByText('210,000', { exact: true })).toBeVisible();
  await expect(panel.locator('time')).toHaveAttribute('datetime', '2030-10-06T20:00:00.000Z');
  failed = true;
  await refresh.click();
  await expect(panel.getByRole('alert')).toContainText('last known halving');
  await expect(panel.locator('time')).toHaveAttribute('datetime', '2030-10-06T20:00:00.000Z');
  failed = false;
  syncing = true;
  await refresh.click();
  await expect(panel).toContainText('Your node is syncing');
  await expect(panel.locator('time')).toHaveCount(0);
  syncing = false;
  observedAt = null;
  await refresh.click();
  await expect(panel).toContainText('Waiting for a valid node reading');
  await expect(panel.locator('time')).toHaveCount(0);
  network = 'regtest';
  height = 149;
  await refresh.click();
  await expect(panel).toContainText('every 150 blocks');
  await expect(panel.getByText('7,500.00000000 BTC', { exact: true })).toBeVisible();
  await expect(panel.locator('time')).toHaveCount(0);
  height = 4950;
  await refresh.click();
  await expect(panel.getByText('Complete', { exact: true })).toBeVisible();
  await expect(panel.getByRole('progressbar')).toHaveCount(0);
  network = 'unknown';
  await refresh.click();
  await expect(panel).toContainText('No subsidy schedule can be calculated');
  await expect(panel.getByRole('progressbar')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('halving panel distinguishes waiting for data from an unavailable reading', async ({
  page,
}) => {
  const state = { error: undefined as string | undefined };
  await page.route('**/api/1.0/overview', (route) =>
    route.fulfill({
      json: {
        status: 'disconnected',
        checked_at: null,
        overview: { data: null, updated_at: null, stale: false, error: state.error },
      },
    }),
  );

  await signIn(page);
  await navigate(page, 'Mining');
  const panel = page.getByRole('region', { name: 'Halving and issuance', exact: true });
  await expect(panel.getByText('Waiting for block height')).toBeVisible();
  await expect(panel.getByRole('progressbar')).toHaveCount(0);
  state.error = 'RPC getblockchaininfo failed (code -28)';
  await page.getByRole('button', { name: 'Refresh node data' }).click();
  await expect(panel.getByRole('alert')).toContainText(state.error);
  await expect(panel.locator('.empty-state strong')).toHaveText('Halving and issuance unavailable');
});
