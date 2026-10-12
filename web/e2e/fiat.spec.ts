import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { navigate, signIn } from './fixtures';

const txid = (900123 * 100000 + 1).toString(16).padStart(64, '0');
const quote = () => ({
  data: { USD: 100000, EUR: 90000, time: Math.floor(Date.now() / 1000) },
  updated_at: new Date().toISOString(),
  stale: false,
  source: 'mempool.space',
});

test('fiat choice is optional, remembered, exact alongside BTC and responsive across amount views', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let priceRequests = 0;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/1.0/fiat-rates', (route) => {
    priceRequests++;

    return route.fulfill({ json: quote() });
  });

  await signIn(page);
  const currency = page.getByLabel('Fiat currency', { exact: true });
  await expect(currency).toHaveValue('BTC');
  expect(priceRequests).toBe(0);
  await page.locator('.mempool-policy summary').click();
  await currency.selectOption('EUR');
  await expect(page.locator('.mempool-policy .fiat-value')).toContainText('€');
  await currency.selectOption('USD');
  await expect(page.locator('.mempool-policy .fiat-value')).toContainText('$');
  await expect(page.locator('.topbar')).not.toContainText('mempool.space');
  await expect(page.locator('.topbar')).not.toContainText('1 BTC');
  expect(priceRequests).toBe(1);
  await page.reload();
  await expect(currency).toHaveValue('USD');
  await navigate(page, 'Blocks');
  await page.getByRole('button', { name: 'Inspect block 900,123', exact: true }).click();
  await page.locator('.goggles-table summary').click();
  await page.getByRole('button', { name: `Inspect transaction ${txid}`, exact: true }).click();
  const panel = page.locator('.transaction-panel');
  await expect(panel).toContainText('0.00000363 BTC');
  await expect(panel).toContainText('≈ $0.36');
  await expect(panel.locator('.io-list').last()).toContainText('0.90000000 BTC');
  await expect(panel.locator('.io-list').last()).toContainText('≈ $90,000.00');
  const widths = info.project.name === 'desktop' ? [1440, 2048] : [390];

  for (const width of widths) {
    await page.setViewportSize({ width, height: info.project.name === 'desktop' ? 1100 : 844 });

    for (const [language, theme, value] of [
      ['en', 'light', 'USD'],
      ['de', 'dark', 'EUR'],
    ]) {
      await page.locator('.preference-picker select').first().selectOption(language!);
      await page.locator('.preference-picker select').nth(1).selectOption(theme!);
      await page
        .getByLabel(language === 'en' ? 'Fiat currency' : 'Fiatwährung', { exact: true })
        .selectOption(value!);

      await expect(panel.locator('.fiat-value').first()).toContainText(
        language === 'en' ? '$0.36' : '0,33',
      );

      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );

      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `../.impeccable/review/fiat-transaction-${width === 2048 ? 'user-2048' : info.project.name}-${language}-${theme}.png`,
        fullPage: true,
      });
    }
  }

  await page.setViewportSize({
    width: info.project.name === 'desktop' ? 1440 : 390,
    height: info.project.name === 'desktop' ? 1100 : 844,
  });

  const language = info.project.name === 'desktop' ? 'de' : 'en';
  const theme = info.project.name === 'desktop' ? 'dark' : 'light';
  await page.locator('.preference-picker select').first().selectOption(language);
  await page.locator('.preference-picker select').nth(1).selectOption(theme);
  await page
    .getByLabel(language === 'en' ? 'Fiat currency' : 'Fiatwährung', { exact: true })
    .selectOption(language === 'en' ? 'USD' : 'EUR');

  await navigate(page, language === 'en' ? 'Analytics' : 'Analyse');
  const economics = page.getByRole('region', {
    name: language === 'en' ? 'Subsidy and fees' : 'Subvention und Gebühren',
    exact: true,
  });

  await economics.locator('summary').click();
  await expect(economics.locator('.fiat-value').first()).toContainText(
    language === 'en' ? '$312,500.00' : '281.250,00',
  );

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `../.impeccable/review/fiat-analytics-${info.project.name}.png`,
    fullPage: true,
  });

  // Historical values also use the current rate, disclosed in amount tooltips.
  const historyResponse = page.waitForResponse((response) =>
    response.url().includes('/blocks/economics?range=all'),
  );

  await page.locator('.economics-range select').selectOption('all');
  await historyResponse;
  await expect(economics.locator('summary')).toBeVisible();
  await economics.locator('summary').click();
  await expect(economics.locator('.fiat-value').first()).toBeVisible();

  await navigate(page, 'Pools');
  const poolLink = page.locator('.pool-pie-legend a').filter({ hasText: 'AntPool' });
  await poolLink.click();
  await expect(page.locator('.pool-metrics .fiat-value')).toBeVisible();
  expect((await new AxeBuilder({ page }).include('#content').analyze()).violations).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `../.impeccable/review/fiat-pool-${info.project.name}.png`,
    fullPage: true,
  });

  await navigate(page, 'Mempool');
  await page.locator('.mempool-policy summary').click();
  await expect(page.locator('.mempool-policy .fiat-value')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `../.impeccable/review/fiat-mempool-${info.project.name}.png`,
    fullPage: true,
  });

  await page
    .getByLabel(language === 'en' ? 'Fiat currency' : 'Fiatwährung', { exact: true })
    .selectOption('BTC');

  await expect(page.locator('.fiat-value')).toHaveCount(0);
  await expect(page.locator('.fiat-rate-status')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('loading, unavailable, stale and recovered prices retain Bitcoin values', async ({ page }) => {
  let phase: 'loading' | 'unavailable' | 'ready' | 'failed' | 'old' = 'loading';
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route('**/api/1.0/fiat-rates', async (route) => {
    if (phase === 'loading') await held;

    if (phase === 'failed') return route.fulfill({ status: 503, json: { error: 'Unavailable' } });

    if (phase === 'unavailable')
      return route.fulfill({
        json: {
          data: null,
          updated_at: null,
          stale: true,
          error: 'Fiat rates unavailable',
          source: 'mempool.space',
        },
      });

    const response = quote();

    if (phase === 'old') response.updated_at = new Date(Date.now() - 3 * 3600000).toISOString();

    await route.fulfill({ json: response });
  });

  await signIn(page);
  await page.getByLabel('Fiat currency', { exact: true }).selectOption('USD');
  await navigate(page, 'Analytics');
  const economics = page.getByRole('region', { name: 'Subsidy and fees', exact: true });
  await economics.locator('summary').click();
  await expect(economics).toContainText('3.12500000 BTC');
  await expect(economics).toContainText('— USD');
  phase = 'unavailable';
  release();
  await expect(economics.locator('.fiat-value').first()).toHaveAttribute(
    'title',
    /Fiat rates unavailable/,
  );

  phase = 'ready';
  await page.getByRole('button', { name: 'Refresh node data' }).click();
  await expect(economics).toContainText('≈ $312,500.00');
  phase = 'failed';
  await page.getByRole('button', { name: 'Refresh node data' }).click();
  await expect(economics).toContainText('≈ $312,500.00 · stale rate');
  phase = 'old';
  await page.getByRole('button', { name: 'Refresh node data' }).click();
  await expect(economics).toContainText('stale rate');
  phase = 'ready';
  await page.getByRole('button', { name: 'Refresh node data' }).click();
  await expect(economics.locator('.fiat-value').first()).toHaveAttribute(
    'title',
    /mempool.space.*Rate as of/,
  );

  await expect(economics).not.toContainText('stale rate');
});
