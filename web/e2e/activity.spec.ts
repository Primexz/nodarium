import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signIn, navigate } from './fixtures';
import type { ActivityEvent, ActivityLive } from '../src/activity';

const blockHash = (900123).toString(16).padStart(64, '0');
const txs = Array.from({ length: 80 }, (_, i) => ({
  txid:
    '93be2ff2d70dd37501fe8f028e19ca8bb2137d1454191644ae74fd3a1b4fbd1d8'.slice(0, 56) +
    (100000000 + i).toString(16).padStart(8, '0'),
  at: Date.now() - i * 100,
  vsize: i % 7 ? 120 + i * 40 : null,
  fee_rate: i % 7 ? [2, 8, 25][i % 3]! : null,
  output_sats:
    i % 7
      ? i === 1
        ? '0'
        : i === 2
          ? '1'
          : i === 3
            ? '2100000000000000'
            : String(123456789 + i * 100000000)
      : null,
}));

const live: ActivityLive = {
  source: 'zmq',
  status: 'ready',
  at: Date.now(),
  generation: 1,
  count: 1842,
  arrivals: 80,
  transactions: txs,
  block: {
    hash: blockHash,
    height: 900123,
    time: Math.floor(Date.now() / 1000),
    transactions: txs.slice(0, 20).map((tx) => ({ ...tx, txid: `f${tx.txid.slice(1)}` })),
  },
  persistence_error: false,
};

async function activityFixture(page: import('@playwright/test').Page) {
  await page.addInitScript((value) => {
    class FixtureEventSource extends EventTarget {
      onopen: (() => void) | null = null;

      onerror: (() => void) | null = null;

      private timer: number;

      constructor() {
        super();
        this.timer = window.setTimeout(() => {
          this.onopen?.();
          this.dispatchEvent(new MessageEvent('snapshot', { data: JSON.stringify(value) }));
        }, 50);

        (window as unknown as { activityStream: FixtureEventSource }).activityStream = this;
      }

      close() {
        clearTimeout(this.timer);
      }
    }

    window.EventSource = FixtureEventSource as unknown as typeof EventSource;
  }, live);

  const events: ActivityEvent[] = Array.from({ length: 180 }, (_, i) => ({
    id: String(i).padStart(32, '0'),
    at: Date.now() - i * 600000,
    kind: i % 8 === 1 ? 'connection' : i % 8 === 2 ? 'reorg' : 'block',
    status: 'connected',
    previous_status: 'disconnected',
    hash: i % 8 === 1 ? undefined : blockHash,
    height: 900123 - i,
    block_time: null,
    depth: i % 8 === 2 ? 1 : null,
  }));

  await page.route('**/api/1.0/activity/events?*', async (route) => {
    const url = new URL(route.request().url());
    const kind = url.searchParams.get('kind');
    const filtered = events.filter((e) => !kind || e.kind === kind);
    const start = Number(url.searchParams.get('cursor') || 0);
    const next = start + 50;
    await route.fulfill({
      json: {
        events: filtered.slice(start, next),
        cursor: next < filtered.length ? String(next) : undefined,
        persistence_error: false,
      },
    });
  });
}

test('live activity can pause, inspect blocks, browse history and reset coverage', async ({
  page,
}, info) => {
  await activityFixture(page);
  await signIn(page);
  await navigate(page, 'Activity');
  await expect(page.getByRole('heading', { name: 'Activity, as it happens.' })).toBeVisible();
  await expect(page.getByText('ZMQ · live events')).toBeVisible();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByText('Paused', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByText('ZMQ · live events')).toBeVisible();
  await page.getByText('Sampled transaction details', { exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'Virtual size' })).toBeVisible();
  await expect(page.locator('.activity-transactions-table th').first()).toHaveText('Amount');
  await expect(page.locator('.activity-amount').nth(0)).toHaveText('—');
  await expect(page.locator('.activity-amount').nth(1)).toHaveText('0.00000000 BTC');
  await expect(page.locator('.activity-amount').nth(2)).toHaveText('0.00000001 BTC');
  await expect(page.locator('.activity-amount').nth(3)).toHaveText('21,000,000.00000000 BTC');
  const assertSampleFits = async () => {
    expect(
      await page
        .locator('.activity-transactions-table tbody tr[data-index]')
        .evaluateAll((rows) =>
          rows.every((row) =>
            [...row.children].every((cell) => cell.scrollWidth <= cell.clientWidth),
          ),
        ),
    ).toBe(true);
  };

  await assertSampleFits();
  await page.getByText('Sampled transaction details', { exact: true }).click();
  await page.getByRole('button', { name: 'Inspect block 900,123' }).click();
  const panel = page.locator('.selected-block-panel');
  await expect(panel).toBeFocused();
  await expect(panel.getByRole('heading', { name: 'Block transaction mosaic' })).toBeVisible();
  await page.getByRole('button', { name: 'Close block details' }).click();
  await expect(page.getByRole('button', { name: 'Inspect block 900,123' })).toBeFocused();
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'Observed at' })).toBeVisible();
  await expect(page.locator('tbody tr tr')).toHaveCount(0);
  const table = page.locator('.table-scroll');
  await table.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });

  await expect(page.locator('.table-scroll-note')).toContainText('180');
  await page.getByLabel('Event category').selectOption('reorg');
  await expect(page.getByText('Chain reorganized to', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });

  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Theme').selectOption(theme);
    await page.evaluate(async () => {
      window.scrollTo(0, 0);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `../.impeccable/review/activity-${info.project.name}-${theme}.png`,
      fullPage: true,
    });

    await page.getByText('Sampled transaction details', { exact: true }).click();
    await assertSampleFits();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `../.impeccable/review/activity-${info.project.name}-${theme}-sample.png`,
      fullPage: true,
    });

    await page.getByText('Sampled transaction details', { exact: true }).click();

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );

    const result = await new AxeBuilder({ page }).include('#content').analyze();
    expect(result.violations).toEqual([]);
  }

  await page.getByLabel('Language').selectOption('de');
  await expect(
    page.getByRole('heading', { name: 'Aktivität, während sie passiert.' }),
  ).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `../.impeccable/review/activity-${info.project.name}-de.png`,
    fullPage: true,
  });

  await page.getByText('Details der Transaktionsstichprobe', { exact: true }).click();
  await expect(page.locator('.activity-transactions-table th').first()).toHaveText('Betrag');
  await expect(page.locator('.activity-amount').nth(2)).toHaveText('0,00000001 BTC');
  await assertSampleFits();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `../.impeccable/review/activity-${info.project.name}-de-sample.png`,
    fullPage: true,
  });

  await page.getByText('Details der Transaktionsstichprobe', { exact: true }).click();
  await page.getByRole('button', { name: 'Ereignisse', exact: true }).click();
  expect(
    await page
      .locator('.activity-events-table tbody tr')
      .first()
      .evaluate((row) => {
        const cells = [...row.children] as HTMLElement[];

        return cells.every((cell) => cell.scrollWidth <= cell.clientWidth);
      }),
  ).toBe(true);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `../.impeccable/review/activity-${info.project.name}-timeline.png`,
    fullPage: true,
  });

  if (info.project.name === 'desktop') {
    await page.getByRole('button', { name: 'Live', exact: true }).click();
    await page.getByText('Details der Transaktionsstichprobe', { exact: true }).click();
    await page.setViewportSize({ width: 2048, height: 1100 });
    await assertSampleFits();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: '../.impeccable/review/activity-user-2048.png', fullPage: true });
  }
});

test('real activity stream boots from RPC and resumes without counting its baseline', async ({
  page,
}) => {
  await signIn(page);
  await navigate(page, 'Activity');
  await expect(page.getByText('RPC · observed every 5 seconds')).toBeVisible();
  await page.getByText('Sampled transaction details', { exact: true }).click();
  await expect(
    page.locator('.activity-amount').filter({ hasText: '1.00000000 BTC' }).first(),
  ).toBeVisible();

  await page.getByText('Sampled transaction details', { exact: true }).click();
  await expect(
    page.getByRole('img', {
      name: 'Sampled transactions waiting and moving into a verified block',
    }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByText('Paused', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByText('RPC · observed every 5 seconds')).toBeVisible();
});

test('rapid ZMQ arrivals do not resize or blank the waiting mosaic', async ({ page }) => {
  await activityFixture(page);
  await signIn(page);
  await navigate(page, 'Activity');
  await expect(page.locator('.activity-canvas')).toBeVisible();
  await expect(page.getByText('ZMQ · live events')).toBeVisible();
  const result = await page.locator('.activity-canvas').evaluate(async (element, value) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext('2d')!;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width')!;
    let resizes = 0;
    Object.defineProperty(canvas, 'width', {
      get() {
        return descriptor.get!.call(this);
      },
      set(width: number) {
        resizes++;
        descriptor.set!.call(this, width);
      },
      configurable: true,
    });

    let blankFrames = 0;
    let frames = 0;
    const started = performance.now();
    let updates = 0;
    const interval = window.setInterval(() => {
      updates++;
      const transaction = {
        ...value.transactions[0]!,
        txid: updates.toString(16).padStart(64, 'b'),
      };

      value = {
        ...value,
        at: Date.now(),
        arrivals: value.arrivals + 1,
        transactions: [...value.transactions.slice(-199), transaction],
      };

      const stream = (window as unknown as { activityStream: EventTarget }).activityStream;
      stream.dispatchEvent(new MessageEvent('live', { data: JSON.stringify(value) }));
    }, 100);

    await new Promise<void>((resolve) => {
      function sample() {
        const pixels = context.getImageData(
          0,
          0,
          canvas.width,
          Math.round(canvas.height * 0.58),
        ).data;

        let painted = false;

        for (let i = 3; i < pixels.length; i += 4) {
          if (pixels[i]! > 0) {
            painted = true;
            break;
          }
        }

        frames++;

        if (!painted) blankFrames++;

        if (performance.now() - started < 1500) requestAnimationFrame(sample);
        else resolve();
      }

      requestAnimationFrame(sample);
    });

    clearInterval(interval);
    delete (canvas as unknown as { width?: number }).width;

    return { resizes, blankFrames, frames, updates };
  }, live);

  expect(result.updates).toBeGreaterThanOrEqual(10);
  expect(result.frames).toBeGreaterThan(20);
  expect(result.resizes).toBe(0);
  expect(result.blankFrames).toBe(0);
});
