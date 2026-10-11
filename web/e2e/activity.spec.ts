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
  projection_error: false,
  projection: {
    at: Date.now(),
    count: 1842,
    vsize: 5300000,
    weight: 21200000,
    min_rate: 1,
    max_rate: 120,
    remaining_count: 442,
    remaining_vsize: 1304000,
    blocks: Array.from({ length: 4 }, (_, i) => ({
      count: 350,
      vsize: 999000,
      weight: 3996000,
      min_rate: [20, 8, 3, 1][i]!,
      max_rate: [120, 25, 12, 5][i]!,
      median_rate: [30, 12, 5, 2][i]!,
      groups: Array.from({ length: 12 }, (_, j) => ({
        count: j < 2 ? 30 : 29,
        vsize: 83250,
        min_rate: [20, 8, 3, 1][i]! + ((12 - j) * ([120, 25, 12, 5][i]! - [20, 8, 3, 1][i]!)) / 13,
        max_rate: [20, 8, 3, 1][i]! + ((13 - j) * ([120, 25, 12, 5][i]! - [20, 8, 3, 1][i]!)) / 13,
      })),
    })),
  },
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

test('transaction arrivals preserve the row being read', async ({ page }) => {
  await activityFixture(page);
  await signIn(page);
  await navigate(page, 'Mempool');
  await expect(page.locator('.activity-amount').first()).toHaveText('0.00000000 BTC');
  const viewport = page.locator('.table-scroll').first();
  await viewport.evaluate((element) => {
    element.scrollTop = 1000;
  });

  await page.waitForTimeout(200);

  const rows = page.locator('.activity-transactions-table tr[data-index]');
  await expect(rows.first()).toBeVisible();
  const viewportTop = (await viewport.boundingBox())!.y;
  const scrollBefore = await viewport.evaluate((element) => element.scrollTop);
  const anchor = await rows.evaluateAll((elements, top) => {
    const visible = elements.find((element) => element.getBoundingClientRect().top > top + 60)!;

    return {
      id: visible.querySelector('.activity-txid')!.textContent!,
      y: visible.getBoundingClientRect().top,
    };
  }, viewportTop);

  await page.evaluate((value) => {
    const row = [...document.querySelectorAll('.activity-txid')].find(
      (cell) => cell.textContent === value,
    )!.parentElement;

    (window as unknown as { readingRow: Element | null }).readingRow = row;
  }, anchor.id);

  await page.evaluate((value) => {
    const stream = (window as unknown as { activityStream: EventTarget }).activityStream;
    stream.dispatchEvent(
      new MessageEvent('live', {
        data: JSON.stringify({
          ...value,
          transactions: [
            { ...value.transactions[1]!, txid: 'a'.repeat(64), at: value.at + 1000 },
            ...value.transactions,
          ],
        }),
      }),
    );
  }, live);

  await page.waitForTimeout(600);
  const row = page
    .locator('.activity-transactions-table tr[data-index]')
    .filter({ has: page.getByText(anchor.id, { exact: true }) });

  expect(
    await row.evaluate(
      (element) => element === (window as unknown as { readingRow: Element }).readingRow,
    ),
  ).toBe(true);

  const scrollAfter = await viewport.evaluate((element) => element.scrollTop);

  expect(
    Math.abs((await row.boundingBox())!.y - anchor.y),
    `scroll before=${scrollBefore}, after=${scrollAfter}`,
  ).toBeLessThan(2);
});

test('ready transactions slide continuously and incomplete rows wait for metadata', async ({
  page,
}, info) => {
  await activityFixture(page);
  await signIn(page);
  await navigate(page, 'Mempool');
  await page.evaluate(() => {
    (document.activeElement as HTMLElement)?.blur();
    window.scrollTo(0, 0);
  });

  await expect(page.locator('.activity-amount').first()).toHaveText('0.00000000 BTC');
  const pending = {
    ...txs[1]!,
    txid: 'a'.repeat(64),
    at: live.at + 1000,
    output_sats: null,
    vsize: null,
    fee_rate: null,
  };

  const send = async (value: ActivityLive) =>
    page.evaluate((data) => {
      (window as unknown as { activityStream: EventTarget }).activityStream.dispatchEvent(
        new MessageEvent('live', { data: JSON.stringify(data) }),
      );
    }, value);

  await send({ ...live, transactions: [pending, ...txs] });
  await expect(page.locator('.activity-txid', { hasText: pending.txid })).toHaveCount(0);
  await expect(page.getByText('13 sampled transactions waiting', { exact: false })).toBeVisible();
  const ready = { ...pending, output_sats: '123456789', vsize: 200, fee_rate: 3 };
  await send({ ...live, transactions: [ready, ...txs] });
  await expect(page.locator('.activity-amount').first()).toHaveText('1.23456789 BTC');
  const motion = await page.evaluate(() => {
    const rows = [
      ...document.querySelectorAll<HTMLTableRowElement>(
        '.activity-transactions-table tr[data-index]',
      ),
    ];

    return {
      entering: rows[0]!.getAnimations().length,
      moving: rows[1]!.getAnimations().length,
      opacity: getComputedStyle(rows[0]!).opacity,
    };
  });

  expect(motion).toEqual({ entering: 1, moving: 1, opacity: '1' });
  // Freeze an actual intermediate frame so screenshot time cannot race the
  // short transition, especially at mobile device scale.
  await page.evaluate(() => {
    const table = document.querySelector('.activity-transactions-table')!;

    for (const animation of table.getAnimations({ subtree: true })) {
      animation.pause();
      animation.currentTime = 120;
    }

    (window as unknown as { rowAnimation: Animation }).rowAnimation = table
      .querySelector('tr[data-index]')!
      .getAnimations()[0]!;
  });

  await page.screenshot({
    path: `../.impeccable/review/activity-table-${info.project.name}-motion.png`,
    fullPage: true,
  });

  // An unchanged reading must leave the existing animation running.
  await send({ ...live, at: live.at + 2000, transactions: [ready, ...txs] });
  expect(
    await page.evaluate(
      () =>
        document
          .querySelector('.activity-transactions-table tr[data-index]')!
          .getAnimations()[0] === (window as unknown as { rowAnimation: Animation }).rowAnimation,
    ),
  ).toBe(true);

  // Interrupt at the frozen mid-slide position. This measures the retargeting
  // jump independently of natural movement while React commits the arrival.
  const continuity = await page.evaluate(
    async (value) => {
      const table = document.querySelector('.activity-transactions-table')!;
      const retained = table.querySelectorAll('tr[data-index]')[1]!;
      const before = retained.getBoundingClientRect().top;
      const committed = new Promise<void>((resolve) => {
        const observer = new MutationObserver(() => {
          observer.disconnect();
          resolve();
        });

        observer.observe(table, { childList: true, subtree: true });
      });

      (window as unknown as { activityStream: EventTarget }).activityStream.dispatchEvent(
        new MessageEvent('live', { data: JSON.stringify(value) }),
      );

      await committed;

      return Math.abs(retained.getBoundingClientRect().top - before);
    },
    { ...live, transactions: [{ ...ready, txid: 'b'.repeat(64) }, ready, ...txs] },
  );

  expect(continuity).toBeLessThan(2);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await send({ ...live, transactions: [{ ...ready, txid: 'b'.repeat(64) }, ready, ...txs] });
  await expect(page.locator('.activity-txid', { hasText: 'b'.repeat(64) })).toHaveCount(1);
  expect(
    await page
      .locator('.activity-transactions-table')
      .evaluate((table) => table.getAnimations({ subtree: true }).length),
  ).toBe(0);
});

test('live activity can pause, inspect blocks, browse history and reset coverage', async ({
  page,
}, info) => {
  await activityFixture(page);
  await signIn(page);
  await navigate(page, 'Mempool');
  await expect(page.getByRole('heading', { name: 'Mempool' })).toBeVisible();
  await expect(page.getByText('ZMQ · live events')).toBeVisible();
  await page.getByRole('button', { name: 'Pause live tracking', exact: true }).click();
  await expect(page.getByText('Paused', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume live tracking', exact: true }).click();
  await expect(page.getByText('ZMQ · live events')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Virtual size' })).toBeVisible();
  await expect(page.locator('.activity-transactions-table th').first()).toHaveText('Amount');
  await expect(
    page.getByText('12 sampled transactions waiting for metadata.', { exact: false }),
  ).toBeVisible();

  await expect(page.locator('.activity-amount').nth(0)).toHaveText('0.00000000 BTC');
  await expect(page.locator('.activity-amount').nth(1)).toHaveText('0.00000001 BTC');
  await expect(page.locator('.activity-amount').nth(2)).toHaveText('21,000,000.00000000 BTC');
  const assertSampleFits = async () => {
    await expect(page.locator('.activity-amount').first()).toHaveText(
      (await page.locator('html').getAttribute('lang')) === 'de'
        ? '0,00000000 BTC'
        : '0.00000000 BTC',
    );

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
  await expect(page.getByRole('button', { name: 'Inspect block 900,123' })).toHaveCount(0);
  await navigate(page, 'Events');
  const blockLink = page.locator('.activity-events-table .table-link').first();
  await blockLink.click();
  const panel = page.locator('.selected-block-panel');
  await expect(panel).toBeFocused();
  await expect(panel.getByRole('heading', { name: 'Block transaction mosaic' })).toBeVisible();
  await page.getByRole('button', { name: 'Close block details' }).click();
  await expect(blockLink).toBeFocused();
  await expect(page.getByRole('columnheader', { name: 'Observed at' })).toBeVisible();
  await expect(page.locator('tbody tr tr')).toHaveCount(0);
  const table = page.locator('.table-scroll');
  await table.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });

  await expect(page.locator('.table-scroll-note')).toContainText('180');
  await page.getByLabel('Event category').selectOption('reorg');
  await expect(page.getByText('Chain reorganized to', { exact: false }).first()).toBeVisible();
  await navigate(page, 'Mempool');
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

    await assertSampleFits();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `../.impeccable/review/activity-${info.project.name}-${theme}-sample.png`,
      fullPage: true,
    });

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );

    const result = await new AxeBuilder({ page }).include('#content').analyze();
    expect(result.violations).toEqual([]);
  }

  await page.getByLabel('Language').selectOption('de');
  await expect(page.getByRole('heading', { name: 'Mempool' })).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `../.impeccable/review/activity-${info.project.name}-de.png`,
    fullPage: true,
  });

  await expect(page.locator('.activity-transactions-table th').first()).toHaveText('Betrag');
  await expect(page.locator('.activity-amount').nth(1)).toHaveText('0,00000001 BTC');
  await assertSampleFits();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `../.impeccable/review/activity-${info.project.name}-de-sample.png`,
    fullPage: true,
  });

  await navigate(page, 'Ereignisse');
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
    await navigate(page, 'Mempool');
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
  await navigate(page, 'Mempool');
  await expect(page.getByText('RPC · observed every 5 seconds')).toBeVisible();
  await expect(
    page.locator('.activity-amount').filter({ hasText: '1.00000000 BTC' }).first(),
  ).toBeVisible();

  await expect(
    page.getByRole('img', {
      name: /Projected block 1:/,
    }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Pause live tracking', exact: true }).click();
  await expect(page.getByText('Paused', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume live tracking', exact: true }).click();
  await expect(page.getByText('RPC · observed every 5 seconds')).toBeVisible();
});

test('projections distinguish stale, resetting and empty snapshots without hiding arrivals', async ({
  page,
}) => {
  await activityFixture(page);
  await signIn(page);
  await navigate(page, 'Mempool');
  await expect(page.locator('.projected-mosaic')).toHaveCount(4);
  const send = async (value: ActivityLive) =>
    page.evaluate((value) => {
      (window as unknown as { activityStream: EventTarget }).activityStream.dispatchEvent(
        new MessageEvent('live', { data: JSON.stringify(value) }),
      );
    }, value);

  await send({ ...live, projection_error: true });
  await expect(page.getByRole('alert')).toContainText('last successful projection');
  await expect(page.locator('.projected-mosaic')).toHaveCount(4);
  await send({ ...live, generation: 2, projection: null });
  await expect(page.getByText('Loading the full mempool', { exact: false })).toBeVisible();
  await expect(page.locator('.projected-mosaic')).toHaveCount(0);
  await send({
    ...live,
    generation: 2,
    projection: {
      ...live.projection!,
      count: 0,
      vsize: 0,
      weight: 0,
      blocks: [],
      remaining_count: 0,
      remaining_vsize: 0,
    },
  });

  await expect(page.getByText('Your node’s mempool is empty.', { exact: false })).toBeVisible();
  await expect(page.locator('.activity-amount').first()).toHaveText('0.00000000 BTC');
  await send({ ...live, generation: 2 });
  await expect(page.locator('.projected-mosaic')).toHaveCount(4);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('rapid ZMQ arrivals leave full-mempool projections stable', async ({ page }) => {
  await activityFixture(page);
  await signIn(page);
  await navigate(page, 'Mempool');
  await expect(page.locator('.projected-mosaic')).toHaveCount(4);
  const before = await page.locator('.projected-blocks').innerHTML();

  for (let i = 0; i < 12; i++) {
    await page.evaluate(
      ({ value, i }) => {
        const stream = (window as unknown as { activityStream: EventTarget }).activityStream;
        stream.dispatchEvent(
          new MessageEvent('live', {
            data: JSON.stringify({
              ...value,
              at: Date.now(),
              arrivals: value.arrivals + i,
              transactions: [
                { ...value.transactions[1]!, txid: i.toString(16).padStart(64, 'b') },
                ...value.transactions,
              ],
            }),
          }),
        );
      },
      { value: live, i },
    );
  }

  expect(await page.locator('.projected-blocks').innerHTML()).toBe(before);
  await expect(page.getByText('442 transactions (', { exact: false })).toBeVisible();
});
