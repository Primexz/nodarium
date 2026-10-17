import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signIn, navigate } from './fixtures';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

test('projection and fee skeletons reserve space and settle into error or empty states', async ({
  page,
}, testInfo) => {
  const fees = deferred();
  await page.route('**/api/1.0/fees', async (route) => {
    await fees.promise;
    await route.fulfill({ status: 503, json: { error: 'Fee estimates unavailable' } });
  });

  await page.addInitScript(() => {
    class PendingStream extends EventTarget {
      onopen: (() => void) | null = null;

      onerror: (() => void) | null = null;

      constructor() {
        super();
        (window as unknown as { loadingStream: PendingStream }).loadingStream = this;
      }

      close() {}
    }

    window.EventSource = PendingStream as unknown as typeof EventSource;
  });

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await signIn(page);
  const projection = page.locator('.projected-section');
  const feePanel = page.getByRole('region', { name: 'Fee estimates' });
  await expect(projection.locator('[aria-busy]')).toHaveAttribute('aria-busy', 'true');
  await expect(projection.locator('.skeleton-mosaic')).toHaveCount(4);
  await expect(feePanel.locator('.loading-skeleton')).toBeVisible();
  await expect(projection.locator('.skeleton').first()).toHaveCSS(
    'animation-name',
    'skeleton-pulse',
  );

  const feeMetrics = await feePanel.locator('.metrics-skeleton .metric').evaluateAll((elements) =>
    elements.map((el) => ({
      top: el.getBoundingClientRect().top,
      left: el.getBoundingClientRect().left,
    })),
  );

  if (testInfo.project.name === 'mobile') {
    expect(feeMetrics[1]!.top).toBeGreaterThan(feeMetrics[0]!.top);
    expect(feeMetrics[2]!.top).toBeGreaterThan(feeMetrics[1]!.top);
    expect(feeMetrics[1]!.left).toBe(feeMetrics[0]!.left);
  } else {
    expect(feeMetrics[1]!.top).toBe(feeMetrics[0]!.top);
  }

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('loading-light.png'), fullPage: true });
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await expect(projection.locator('.skeleton').first()).toHaveCSS(
    'animation-name',
    'skeleton-pulse',
  );

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.screenshot({ path: testInfo.outputPath('loading-dark.png'), fullPage: true });
  expect(
    await projection
      .locator('.skeleton')
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('none');

  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Pause live tracking' }).click();
  await expect(projection.locator('.loading-skeleton')).toHaveCount(0);
  await page.getByRole('button', { name: 'Resume live tracking' }).click();
  await expect(projection.locator('.loading-skeleton')).toBeVisible();
  fees.resolve();
  await expect(feePanel.locator('.loading-skeleton')).toHaveCount(0);
  await expect(feePanel.getByRole('alert')).toBeVisible();
  await page.evaluate(() => {
    const stream = (window as unknown as { loadingStream: EventSource }).loadingStream;
    stream.onopen?.(new Event('open'));
    stream.dispatchEvent(
      new MessageEvent('snapshot', {
        data: JSON.stringify({
          source: 'rpc',
          status: 'ready',
          at: Date.now(),
          generation: 1,
          count: 0,
          arrivals: 0,
          transactions: [],
          block: null,
          persistence_error: false,
          projection_error: false,
          projection: {
            at: Date.now(),
            count: 0,
            vsize: 0,
            weight: 0,
            min_rate: 0,
            max_rate: 0,
            remaining_count: 0,
            remaining_vsize: 0,
            blocks: [],
          },
        }),
      }),
    );
  });

  await expect(projection.locator('[aria-busy]')).toHaveCount(0);
  await expect(projection.locator('.loading-skeleton')).toHaveCount(0);
  await expect(projection.getByRole('status')).toContainText('empty');
});

test('peer requests load independently and successful empty responses end skeletons', async ({
  page,
}) => {
  const peers = deferred();
  const geography = deferred();
  await page.route('**/api/1.0/peers', async (route) => {
    await peers.promise;
    await route.fulfill({ json: { data: [], stale: false, updated_at: null } });
  });

  await page.route('**/api/1.0/peer-map', async (route) => {
    await geography.promise;
    await route.fulfill({ json: { data: null, stale: false, updated_at: null } });
  });

  await signIn(page);
  await navigate(page, 'Peers');
  await expect(page.locator('.country-panel .loading-skeleton')).toBeVisible();
  await expect(page.locator('.peer-map-stage .loading-skeleton')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Connections', exact: true })).toHaveCount(0);
  peers.resolve();
  geography.resolve();
  await expect(page.locator('.country-panel .loading-skeleton')).toHaveCount(0);
  await expect(page.locator('.peer-map-stage .loading-skeleton')).toHaveCount(0);
  await expect(page.getByText('No peers connected', { exact: true })).toBeVisible();
});

test('a partial chart becomes visible while another series is pending and stays visible during refresh', async ({
  page,
}) => {
  const upload = deferred();
  const refresh = deferred();
  let reloading = false;
  await page.route('**/api/1.0/history?**', async (route) => {
    const url = new URL(route.request().url());
    const metric = url.searchParams.get('metric');

    if (metric === 'tx_rate') await upload.promise;

    if (reloading) {
      await refresh.promise;
      await route.fulfill({ status: 503, json: { error: 'Refresh failed' } });

      return;
    }

    await route.fulfill({
      json: { metric, range: '24h', total: 12, points: [{ at: Date.now(), value: 0 }] },
    });
  });

  await signIn(page);
  await navigate(page, 'Traffic');
  const chart = page.locator('.chart-panel');
  await expect(chart.locator('.chart-data')).toBeVisible();
  await expect(chart.locator('.loading-skeleton')).toHaveCount(0);
  upload.resolve();
  reloading = true;
  await page.getByRole('button', { name: 'Refresh node data' }).click();
  await expect(chart.locator('.chart-data')).toBeVisible();
  await expect(chart.locator('.loading-skeleton')).toHaveCount(0);
  refresh.resolve();
  await expect(chart.locator('.chart-error')).toBeVisible();
  await expect(chart.locator('.chart-data')).toBeVisible();
});
