import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signIn } from './fixtures';

const hash = (900123).toString(16).padStart(64, '0');
const txid = (index: number) => (900123 * 100000 + index).toString(16).padStart(64, '0');
const endpoint = `/api/v1/blocks/${hash}/transactions`;

test('authenticated local transactions open from mosaic and keyboard table', async ({ page }) => {
  expect((await page.request.get(endpoint)).status()).toBe(401);
  expect((await page.request.get(`${endpoint}/${txid(1)}`)).status()).toBe(401);
  const detailRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes(`${endpoint}/`)) detailRequests.push(request.url());
  });

  await signIn(page);
  expect(detailRequests).toEqual([]);
  await page.getByRole('button', { name: 'Inspect block 900,123', exact: true }).click();
  const mosaic = page.locator('.transaction-mosaic');
  await expect(mosaic.locator('canvas')).toBeVisible();
  const response = await page.request.get(endpoint);
  const block = await response.json();
  expect(block.transactions).toHaveLength(2500);
  expect(block.transactions[0].coinbase).toBe(true);
  expect(block.transactions[0].fee_sats).toBeNull();
  expect(block.transactions[1].fee_sats).toBe('363');
  expect(detailRequests).toEqual([]);
  const box = (await mosaic.boundingBox())!;
  await mosaic.click({ position: { x: box.width * 0.31, y: box.height * 0.37 } });
  const panel = page.getByRole('region', { name: 'Transaction details', exact: true });
  await expect(panel.locator('.transaction-metrics')).toBeVisible();
  expect(detailRequests).toHaveLength(1);
  await panel.getByRole('button', { name: 'Close transaction details' }).click();
  await page.locator('.goggles-table summary').click();
  const choose = page.getByRole('button', { name: `Inspect transaction ${txid(1)}`, exact: true });
  await choose.focus();
  await choose.press('Enter');
  await expect(panel).toBeFocused();
  await expect(panel.locator('.transaction-metrics')).toContainText('0.00000363 BTC');
  await expect(panel.locator('.io-list').first()).toContainText('1.00000363 BTC');
  await expect(panel.locator('.io-list').last()).toContainText('0.90000000 BTC');
  await expect(panel).toContainText('bc1qfixtureprevious');
  await panel.getByRole('button', { name: 'Close transaction details' }).click();
  await expect(choose).toBeFocused();
  const scroll = page.locator('.goggles-table .virtual-table-scroll');
  await scroll.evaluate((node) => {
    const height = node.querySelector('tr[data-index]')!.getBoundingClientRect().height;
    node.scrollTop = height * 25;
  });

  await expect(
    page.getByRole('button', { name: `Inspect transaction ${txid(25)}`, exact: true }),
  ).toBeVisible();

  expect(await page.locator('.goggles-table tr[data-index]').count()).toBeLessThan(40);
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);

  expect((await page.request.get('/api/v1/blocks/invalid/transactions')).status()).toBe(400);
});

test('unavailable block retries, stale data is labeled and orphaned mosaic is hidden', async ({
  page,
}) => {
  let unavailable = true;
  let inactive = false;
  await page.route(`**${endpoint}`, async (route) => {
    if (unavailable || inactive) {
      await route.fulfill({ status: inactive ? 409 : 503, json: { error: 'Unavailable' } });
    } else await route.continue();
  });

  await signIn(page);
  await page.getByRole('button', { name: 'Inspect block 900,123', exact: true }).click();
  const goggles = page.getByRole('region', { name: 'Block transaction mosaic', exact: true });
  await expect(goggles.getByRole('alert')).toContainText('block data may be pruned');
  await expect(page.locator('.transaction-mosaic')).toHaveCount(0);
  unavailable = false;
  await goggles.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('.transaction-mosaic canvas')).toBeVisible();
  unavailable = true;
  await page.getByRole('button', { name: 'Refresh node data' }).click();
  await expect(goggles.getByRole('alert')).toContainText('last downloaded transactions');
  await expect(page.locator('.transaction-mosaic canvas')).toBeVisible();
  inactive = true;
  await page.getByRole('button', { name: 'Refresh node data' }).click();
  await expect(goggles.getByRole('alert')).toContainText('no longer on your node’s active chain');
  await expect(page.locator('.transaction-mosaic')).toHaveCount(0);
});

test('missing prevouts and fees remain unavailable rather than zero', async ({ page }) => {
  await page.route(`**${endpoint}/${txid(1)}`, async (route) => {
    const response = await route.fetch();
    const tx = await response.json();
    tx.fee_sats = null;
    tx.fee_rate = null;
    tx.inputs[0].value_sats = null;
    tx.inputs[0].address = '';
    await route.fulfill({ json: tx });
  });

  await signIn(page);
  await page.getByRole('button', { name: 'Inspect block 900,123', exact: true }).click();
  await expect(page.locator('.transaction-mosaic canvas')).toBeVisible();
  await page.locator('.goggles-table summary').click();
  await page.getByRole('button', { name: `Inspect transaction ${txid(1)}`, exact: true }).click();
  const panel = page.locator('.transaction-panel');
  await expect(panel).toContainText('Some input values or fees are unavailable');
  await expect(panel.locator('.transaction-metrics div').nth(3).locator('dd')).toHaveText('—');
  await expect(panel.locator('.io-list strong').first()).toHaveText('—');
  await panel.getByRole('button', { name: 'Close transaction details' }).click();
  await page.getByRole('button', { name: `Inspect transaction ${txid(0)}`, exact: true }).click();
  await expect(panel).toContainText('Coinbase: newly mined coins and collected fees');
});

test('block visualization supports both themes, German, accessibility and narrow layouts', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page);
  await page.getByRole('button', { name: 'Inspect block 900,123', exact: true }).click();
  await expect(page.locator('.transaction-mosaic canvas')).toBeVisible();
  await page.locator('.goggles-table summary').click();
  await page.getByRole('button', { name: `Inspect transaction ${txid(1)}`, exact: true }).click();
  await expect(page.locator('.transaction-metrics')).toBeVisible();
  await expect(page.locator('.transaction-metrics dt')).toContainText([
    'Virtual size',
    'Transaction size',
    'Transaction weight',
  ]);

  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );

    const audit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(
      audit.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })),
    ).toEqual([]);

    await page.evaluate(async () => {
      window.scrollTo(0, 0);
      await document.fonts.ready;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });

    await page.screenshot({
      path: `../.impeccable/review/goggles-${info.project.name}-${theme}.png`,
      fullPage: true,
    });
  }

  await page.getByLabel('Language', { exact: true }).selectOption('de');
  await expect(
    page.getByRole('region', { name: 'Transaktionsdetails', exact: true }),
  ).toBeVisible();

  await expect(page.locator('.transaction-metrics')).toContainText('0,00000363 BTC');
  await expect(page.locator('.transaction-metrics dt')).toContainText([
    'Virtuelle Größe',
    'Transaktionsgröße',
    'Transaktionsgewicht',
  ]);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `../.impeccable/review/goggles-${info.project.name}-german.png`,
    fullPage: true,
  });
});
