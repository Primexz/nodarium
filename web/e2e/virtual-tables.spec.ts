import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { History, Peer, Section } from '../src/types';
import { navigate, signIn } from './fixtures';

async function scrollToEnd(node: HTMLElement) {
  node.scrollTop = node.scrollHeight;
}

test('peer rows stay bounded while scrolling, filtering, sorting, refreshing and using the keyboard', async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let count = 2000;
  await page.route('**/api/1.0/peers', async (route) => {
    const response = await route.fetch();
    const body: Section<Peer[]> = await response.json();
    const original = body.data![0]!;
    body.data = Array.from({ length: count }, (_, i) => ({
      ...original,
      id: i,
      addr: `node-${String(i).padStart(4, '0')}.example:8333`,
      inbound: i % 2 === 0,
      bytesrecv: (count - i) * 100000,
      bytessent: 0,
    }));

    await route.fulfill({ json: body });
  });

  await signIn(page);
  await navigate(page, 'Connected peers');
  const panel = page.locator('.peer-panel');
  const scroll = panel.locator('.virtual-table-scroll');
  const rows = panel.locator('tr[data-index]');
  await expect(panel.getByRole('table')).toHaveAttribute('aria-rowcount', '2001');
  expect(await rows.count()).toBeLessThan(35);
  await expect(panel.locator('.pagination')).toHaveCount(0);

  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);
    const audit = await new AxeBuilder({ page })
      .include('.peer-panel')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(audit.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `../.impeccable/review/virtual-peers-${info.project.name}-${theme}.png`,
      fullPage: true,
    });
  }

  await page.getByLabel('Language', { exact: true }).selectOption('de');
  await expect(panel.locator('.table-scroll-note')).toContainText('2.000 Zeilen');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `../.impeccable/review/virtual-peers-${info.project.name}-de.png`,
    fullPage: true,
  });

  await page.getByLabel('Sprache', { exact: true }).selectOption('en');
  await scroll.evaluate(scrollToEnd);
  await expect(
    panel.getByRole('button', { name: 'node-1999.example:8333', exact: true }),
  ).toBeVisible();

  expect(await rows.count()).toBeLessThan(35);
  const before = await scroll.evaluate((node) => node.scrollTop);
  await page.getByRole('button', { name: 'Refresh node data' }).click();
  await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBeGreaterThan(before - 150);
  await page.getByRole('button', { name: 'Peer address', exact: false }).click();
  await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBe(0);
  const first = panel.getByRole('button', { name: 'node-0000.example:8333', exact: true });
  await first.focus();
  await first.press('End');
  const last = panel.getByRole('button', { name: 'node-1999.example:8333', exact: true });
  await expect(last).toBeFocused();
  await last.press('Home');
  await expect(first).toBeFocused();

  // Tab must keep loading adjacent rows, rather than leaving at the mounted window boundary.
  for (let i = 0; i < 35; i++) await page.keyboard.press('Tab');

  await expect(
    panel.getByRole('button', { name: 'node-0035.example:8333', exact: true }),
  ).toBeFocused();

  await page.keyboard.press('Shift+Tab');
  await expect(
    panel.getByRole('button', { name: 'node-0034.example:8333', exact: true }),
  ).toBeFocused();

  const selected = panel.getByRole('button', { name: 'node-0034.example:8333', exact: true });
  await selected.press('Enter');
  await expect(page.getByRole('dialog')).toContainText('node-0034.example:8333');
  await page.getByRole('button', { name: 'Close peer details' }).click();
  await expect(selected).toBeFocused();
  await page.getByLabel('Search peers').fill('node-1999');
  await expect(rows).toHaveCount(1);
  await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBe(0);
  await page.getByLabel('Search peers').fill('');
  await scroll.evaluate(scrollToEnd);
  count = 3;
  await page.getByRole('button', { name: 'Refresh node data' }).click();
  await expect(rows).toHaveCount(3);
  await expect(scroll.locator('.virtual-spacer')).toHaveCount(0);
  count = 0;
  await page.getByRole('button', { name: 'Refresh node data' }).click();
  await expect(rows).toHaveCount(0);
  await expect(panel).toContainText('No peers connected');
  expect(errors).toEqual([]);
});

test('long joined history tables expose the full range and preserve missing values', async ({
  page,
}, info) => {
  const at = Date.now() - 1_000_000;
  await page.route('**/api/1.0/history?**', async (route) => {
    const url = new URL(route.request().url());
    const history: History = {
      metric: url.searchParams.get('metric')!,
      range: url.searchParams.get('range')!,
      interval_seconds: 1,
      total: 0,
      points: Array.from({ length: 1000 }, (_, i) => ({
        at: at + i * 1000,
        value: i === 990 ? null : i,
        peak: i,
        total: 0,
        coverage: i === 990 ? 0 : 1,
        samples: i === 990 ? 0 : 1,
      })),
    };

    await route.fulfill({ json: history });
  });

  await signIn(page);
  await navigate(page, 'Connected peers');
  const chart = page
    .locator('.chart-panel')
    .filter({ has: page.getByRole('heading', { name: 'Total peers', exact: true }) });

  await chart.locator('summary').click();
  const scroll = chart.locator('.virtual-table-scroll');
  await expect(chart.getByRole('table')).toHaveAttribute('aria-rowcount', '1001');
  expect(await chart.locator('tr[data-index]').count()).toBeLessThan(30);
  await scroll.focus();
  await scroll.press('End');
  await expect(chart.getByRole('cell', { name: '999', exact: true })).toBeVisible();
  await expect(chart).toContainText('No reading');
  await expect(chart.locator('tr[data-index="999"]')).toHaveAttribute('aria-rowindex', '1001');
  await scroll.press('Home');
  await expect(chart.getByRole('cell', { name: '0', exact: true })).toBeVisible();
  const audit = await new AxeBuilder({ page })
    .include('.chart-data')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  expect(audit.violations).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `../.impeccable/review/virtual-history-${info.project.name}.png`,
    fullPage: true,
  });
});

test('transaction scrolling reaches the final block transaction and restores its focus', async ({
  page,
}, info) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Inspect block 900,123', exact: true }).click();
  await page.locator('.goggles-table summary').click();
  const table = page.locator('.goggles-table');
  const scroll = table.locator('.virtual-table-scroll');
  await expect(table.getByRole('table')).toHaveAttribute('aria-rowcount', '2501');
  expect(await table.locator('tr[data-index]').count()).toBeLessThan(35);
  await scroll.evaluate(scrollToEnd);
  const lastID = (900123 * 100000 + 2499).toString(16).padStart(64, '0');
  const last = table.getByRole('button', { name: `Inspect transaction ${lastID}`, exact: true });
  await expect(last).toBeVisible();
  await last.focus();
  await last.press('Enter');
  const details = page.getByRole('region', { name: 'Transaction details', exact: true });
  await expect(details).toBeFocused();
  await details.getByRole('button', { name: 'Close transaction details' }).click();
  await expect(last).toBeFocused();
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await page.getByLabel('Language', { exact: true }).selectOption('de');
  await expect(table.locator('.table-scroll-note')).toContainText('2.500 Zeilen');
  const audit = await new AxeBuilder({ page })
    .include('.goggles-table')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  expect(audit.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `../.impeccable/review/virtual-transactions-${info.project.name}.png`,
    fullPage: true,
  });
});
