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
  await page.route('**/api/v1/overview', async (route) => {
    if (failed) return route.fulfill({ status: 503, body: 'Unavailable' });

    const response = await route.fetch();
    const body: OverviewResponse = await response.json();
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

  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);
    const audit = await new AxeBuilder({ page })
      .include('.difficulty-panel')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(audit.violations).toEqual([]);
    await panel.screenshot({
      path: `../.impeccable/review/difficulty-${info.project.name}-${theme}.png`,
    });
  }

  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  const refresh = page.getByRole('button', { name: 'Refresh node data' });
  height = 901151;
  await refresh.click();
  await expect(panel.getByText('99.95%', { exact: true })).toBeVisible();
  await expect(panel.locator('.metric').nth(1).locator('dd')).toHaveText('1');
  height = 901152;
  await refresh.click();
  await expect(progress).toHaveAttribute('value', '0');
  await expect(panel.getByText('0.00%', { exact: true })).toBeVisible();
  await expect(panel.getByText('903,168', { exact: true })).toBeVisible();
  syncing = true;
  await refresh.click();
  await expect(panel.locator('.difficulty-note')).toContainText('Your node is syncing');
  await expect(progress).toHaveAttribute('value', '0');
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
  await page.route('**/api/v1/overview', (route) =>
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
