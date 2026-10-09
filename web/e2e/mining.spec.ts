import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { History, Mining, OverviewResponse, Section } from '../src/types';
import { navigate, signIn } from './fixtures';

test('backend exports and persists network hashrate and difficulty for the charts', async ({
  page,
  request,
}) => {
  expect((await request.get('/api/v1/mining')).status()).toBe(401);
  await signIn(page);
  await navigate(page, 'Mining');
  const charts = page.getByRole('region', { name: 'Network mining' });
  await expect(charts.getByText('910.00 EH/s', { exact: true })).toBeVisible();
  await expect(charts.getByText('895.00 EH/s', { exact: true })).toBeVisible();
  await expect(charts.getByText('123.40T', { exact: true })).toBeVisible();
  const response = await page.request.get('/api/v1/mining');
  expect(response.ok()).toBe(true);
  const mining: Section<Mining> = await response.json();
  expect(mining.stale).toBe(false);
  expect(mining.data).toEqual({ height: 900123, hashrate_144: 910e18, hashrate_1008: 895e18 });

  for (const [metric, value] of [
    ['hashrate_144', 910e18],
    ['hashrate_1008', 895e18],
    ['difficulty', 123.4e12],
  ] as const) {
    const historyResponse = await page.request.get(`/api/v1/history?metric=${metric}&range=24h`);
    expect(historyResponse.ok()).toBe(true);
    const history: History = await historyResponse.json();
    expect(
      history.points.some(
        (point) => point.value !== null && Math.abs(point.value - value) < value * 1e-12,
      ),
    ).toBe(true);

    expect(history.points.some((point) => point.value === null)).toBe(true);
  }
});

test('mining charts support ranges, accessible data, themes, German, outages and syncing', async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let failed = false;
  let syncing = false;
  let empty = false;
  const now = Date.now();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/v1/mining', (route) =>
    failed
      ? route.fulfill({ status: 503, json: { error: 'Refresh failed' } })
      : route.fulfill({
          json: {
            data: { height: 900123, hashrate_144: 910e18, hashrate_1008: 895e18 },
            stale: false,
            updated_at: new Date().toISOString(),
          },
        }),
  );

  await page.route('**/api/v1/overview', async (route) => {
    const response = await route.fetch();
    const body: OverviewResponse = await response.json();
    body.overview.data!.blockchain.initialblockdownload = syncing;
    await route.fulfill({ json: body });
  });

  await page.route('**/api/v1/history?**', (route) => {
    const url = new URL(route.request().url());
    const metric = url.searchParams.get('metric')!;

    if (!['hashrate_144', 'hashrate_1008', 'difficulty'].includes(metric)) return route.continue();

    if (failed)
      return route.fulfill({ status: 503, json: { error: 'History storage unavailable' } });

    const base = metric === 'difficulty' ? 123.4e12 : metric === 'hashrate_144' ? 910e18 : 895e18;
    const span =
      { '1h': 3600000, '24h': 86400000, '7d': 604800000, '30d': 2592000000, '1y': 31536000000 }[
        url.searchParams.get('range')!
      ] ?? 86400000;

    const step = span / 48;

    return route.fulfill({
      json: {
        metric,
        range: url.searchParams.get('range'),
        interval_seconds: step / 1000,
        total: 0,
        points: Array.from({ length: 49 }, (_, i) => ({
          at: now - (48 - i) * step,
          value:
            empty || i === 20
              ? null
              : base * (metric === 'difficulty' ? (i < 24 ? 0.97 : 1) : 1 + 0.04 * Math.sin(i / 4)),
          peak: base,
          total: 0,
          coverage: empty || i === 20 ? 0 : 1,
          samples: empty || i === 20 ? 0 : 180,
        })),
      },
    });
  });

  await signIn(page);
  await navigate(page, 'Mining');
  const charts = page.getByRole('region', { name: 'Network mining' });
  await expect(charts.locator('.chart-empty')).toHaveCount(0);
  await expect(charts.getByRole('img')).toHaveCount(2);

  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);
    const audit = await new AxeBuilder({ page })
      .include('.mining-charts')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(audit.violations).toEqual([]);
    // Axe may focus the skip link; restore an ordinary viewing state for capture.
    await charts.getByRole('heading').first().click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );

    await charts.screenshot({
      path: `../.impeccable/review/mining-${info.project.name}-${theme}.png`,
    });
  }

  await page.getByRole('button', { name: '7d', exact: true }).click();
  await expect(charts.getByRole('img').first()).toHaveAttribute('aria-label', /7d/);
  await charts.locator('summary').first().click();
  await expect(charts.getByRole('table')).toBeVisible();
  await expect(charts.getByRole('table').getByText('No reading', { exact: true })).toHaveCount(2);
  await expect(charts.getByRole('columnheader', { name: '1,008 blocks' })).toBeVisible();
  await page.getByLabel('Language', { exact: true }).selectOption('de');
  const german = page.getByRole('region', { name: 'Netzwerk-Mining' });
  await expect(
    german.locator('.chart-readings').getByText('910,00 EH/s', { exact: true }),
  ).toBeVisible();

  await expect(german.getByRole('columnheader', { name: '1.008 Blöcke' })).toBeVisible();
  await german.locator('summary').first().click();
  await german.getByRole('heading').first().click();
  await german.screenshot({ path: `../.impeccable/review/mining-${info.project.name}-de.png` });
  failed = true;
  await page.getByRole('button', { name: 'Node-Daten aktualisieren' }).click();
  await expect(german.getByRole('alert')).toContainText('letzten bekannten');
  await expect(german.getByText('910,00 EH/s', { exact: true })).toBeVisible();
  await expect(german.locator('.chart-error')).toHaveCount(2);
  failed = false;
  syncing = true;
  await page.getByRole('button', { name: 'Node-Daten aktualisieren' }).click();
  await expect(german.getByRole('alert').first()).toContainText('Synchronisierung');
  await expect(
    german.locator('.chart-readings').first().getByText('—', { exact: true }),
  ).toHaveCount(2);

  empty = true;
  syncing = false;
  await page.getByRole('button', { name: 'Node-Daten aktualisieren' }).click();
  await expect(german.locator('.chart-empty')).toHaveCount(2);
  expect(errors).toEqual([]);
});
