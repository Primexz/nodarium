import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { OverviewResponse } from '../src/types';
import { navigate, signIn } from './fixtures';

test('difficulty period updates at the boundary and explains syncing, stale and regtest states', async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let height = 900123;
  let network = 'main';
  let syncing = false;
  let failed = false;
  let observedAt: string | null = '2026-10-09T12:00:00Z';
  await page.route('**/api/1.0/overview', async (route) => {
    if (failed) return route.fulfill({ status: 503, body: 'Unavailable' });

    const response = await route.fetch();
    const body: OverviewResponse = await response.json();
    body.overview.updated_at = observedAt;
    Object.assign(body.overview.data!.blockchain, {
      chain: network,
      blocks: height,
      headers: syncing ? height + 3000 : height,
      initialblockdownload: syncing,
    });

    await route.fulfill({ json: body });
  });

  await signIn(page);
  await navigate(page, 'Mining');
  const panel = page.getByRole('region', { name: 'Difficulty period', exact: true });
  const progress = panel.getByRole('progressbar', { name: 'Period progress' });
  await expect(panel.getByText('48.96%', { exact: true })).toBeVisible();
  await expect(panel.getByText('1,029', { exact: true })).toBeVisible();
  await expect(panel.getByText('901,152', { exact: true })).toBeVisible();
  await expect(progress).toHaveAttribute('value', '987');
  await expect(progress).toHaveAttribute('max', '2016');
  await expect(panel.locator('time')).toHaveAttribute('datetime', '2026-10-16T15:30:00.000Z');
  await expect(panel.locator('.difficulty-estimate')).toContainText('10 minutes per block');

  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);
    const audit = await new AxeBuilder({ page })
      .include('.difficulty-panel')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(audit.violations).toEqual([]);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      fullPage: true,
      path: `../.impeccable/review/difficulty-${info.project.name}-${theme}.png`,
    });
  }

  await page.getByLabel('Language', { exact: true }).selectOption('de');
  const germanEstimate = page.locator('.difficulty-estimate');
  await expect(germanEstimate).toContainText('Nächste Anpassung (geschätzt)');
  await expect(germanEstimate).toContainText('10 Minuten pro Block');
  await expect(germanEstimate.locator('time')).toHaveAttribute(
    'datetime',
    '2026-10-16T15:30:00.000Z',
  );

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    fullPage: true,
    path: `../.impeccable/review/difficulty-${info.project.name}-de-estimate.png`,
  });

  await page.getByLabel('Sprache', { exact: true }).selectOption('en');

  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  const refresh = page.getByRole('button', { name: 'Refresh node data' });
  height = 901151;
  await refresh.click();
  await expect(panel.getByText('99.95%', { exact: true })).toBeVisible();
  await expect(panel.locator('.metric').nth(1).locator('dd')).toHaveText('1');
  await expect(panel.locator('time')).toHaveAttribute('datetime', '2026-10-09T12:10:00.000Z');
  height = 901152;
  await refresh.click();
  await expect(progress).toHaveAttribute('value', '0');
  await expect(panel.getByText('0.00%', { exact: true })).toBeVisible();
  await expect(panel.getByText('903,168', { exact: true })).toBeVisible();
  await expect(panel.locator('time')).toHaveAttribute('datetime', '2026-10-23T12:00:00.000Z');
  failed = true;
  await refresh.click();
  await expect(panel.getByRole('alert')).toContainText('last known difficulty period');
  await expect(panel.locator('time')).toHaveAttribute('datetime', '2026-10-23T12:00:00.000Z');
  failed = false;
  syncing = true;
  await refresh.click();
  await expect(panel.locator('.difficulty-note')).toContainText('Your node is syncing');
  await expect(progress).toHaveAttribute('value', '0');
  await expect(panel.locator('time')).toHaveCount(0);
  failed = true;
  await refresh.click();
  await expect(panel.getByRole('alert')).toContainText('last known difficulty period');
  await expect(panel.getByText('903,168', { exact: true })).toBeVisible();
  await page.getByLabel('Language', { exact: true }).selectOption('de');
  const german = page.getByRole('region', { name: 'Schwierigkeitsperiode', exact: true });
  await expect(german.getByText('0,00%', { exact: true })).toBeVisible();
  await expect(german.getByRole('alert')).toContainText('letzte bekannte');
  await german.screenshot({
    path: `../.impeccable/review/difficulty-${info.project.name}-de-stale.png`,
  });

  failed = false;
  syncing = false;
  observedAt = null;
  await page.getByRole('button', { name: 'Node-Daten aktualisieren' }).click();
  await expect(german.locator('time')).toHaveCount(0);
  await expect(german.locator('.difficulty-estimate')).toContainText('gültigen Messwert');
  network = 'regtest';
  await page.getByRole('button', { name: 'Node-Daten aktualisieren' }).click();
  await expect(
    german.getByText('Die Schwierigkeitsanpassung ist im Regtest deaktiviert.'),
  ).toBeVisible();

  await expect(german.getByRole('progressbar')).toHaveCount(0);
  await expect(german.getByRole('alert')).toHaveCount(0);
});

test('difficulty period leaves missing readings empty and identifies a failed collection', async ({
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
  const panel = page.getByRole('region', { name: 'Difficulty period', exact: true });
  await expect(panel.getByText('Waiting for block height')).toBeVisible();
  await expect(panel.getByRole('progressbar')).toHaveCount(0);
  state.error = 'RPC getblockchaininfo failed (code -28)';
  await page.getByRole('button', { name: 'Refresh node data' }).click();
  await expect(panel.locator('.empty-state strong')).toHaveText('Difficulty period unavailable');
  await expect(panel.getByRole('alert')).toContainText(state.error);
  await expect(panel.getByRole('progressbar')).toHaveCount(0);
});
