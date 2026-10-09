import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { mockMap, signIn, navigate } from './fixtures';

test('system theme responds live and explicit preference persists across login and reload', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('nodarium-theme'))).toBeNull();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await signIn(page);
  await expect(page.getByLabel('Theme', { exact: true })).toHaveValue('dark');
  await page.getByLabel('Theme', { exact: true }).selectOption('system');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('block strip opens real block details and shares selection with the block table', async ({
  page,
}) => {
  await mockMap(page);
  await signIn(page);
  await page.getByRole('button', { name: 'Inspect block 900,123', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Block 900,123 details', exact: true }),
  ).toBeVisible();

  await navigate(page, 'Recent blocks');
  await page.getByRole('button', { name: 'Inspect block 900,122', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Collapse block 900,122', exact: true }),
  ).toHaveAttribute('aria-expanded', 'true');

  await expect(
    page.getByRole('region', { name: 'Block 900,122 details', exact: true }),
  ).toHaveCount(1);
});

test('keyboard dialogs restore focus and expired sessions hide node data', async ({ page }) => {
  await signIn(page);
  await navigate(page, 'Connected peers');
  const peer = page.getByRole('button', { name: '192.0.2.12:8333', exact: true });
  await peer.focus();
  await peer.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(peer).toBeFocused();
  await page.route('**/api/1.0/overview', (route) =>
    route.fulfill({ status: 401, json: { error: 'Authentication required' } }),
  );

  await page.getByRole('button', { name: 'Refresh node data' }).click();
  await expect(page.getByLabel('Admin key', { exact: true })).toBeVisible();
  await expect(page.getByText('900,123', { exact: true })).toHaveCount(0);
});

test('direct routes reload and unknown routes return to overview', async ({ page }) => {
  await signIn(page);
  await page.goto('/mempool');
  await expect(page.getByRole('heading', { name: 'Waiting for the next block.' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Waiting for the next block.' })).toBeVisible();
  await page.goto('/does-not-exist');
  await expect(page).toHaveURL(/\/overview$/);
});

test('redesign capture matrix covers themes, routes, German and reduced motion', async ({
  page,
}, info) => {
  const prefix = `../.impeccable/review/${info.project.name}`;
  const errors: string[] = [];

  page.on('pageerror', (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.goto('/');

  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);
    await page.screenshot({ path: `${prefix}-login-${theme}.png`, fullPage: true });
  }

  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  await mockMap(page);
  // Synthetic history matches the RPC fixture's order of magnitude and explicitly includes a missing observation.
  await page.route('**/api/1.0/history?**', (route) => {
    const url = new URL(route.request().url());
    const metric = url.searchParams.get('metric')!;
    const range = url.searchParams.get('range')!;

    const scale =
      metric === 'hashrate_144'
        ? 910e18
        : metric === 'hashrate_1008'
          ? 895e18
          : metric === 'difficulty'
            ? 123.4e12
            : metric === 'rx_rate'
              ? 18000
              : metric === 'tx_rate'
                ? 6500
                : metric.includes('bytes') || metric.includes('usage')
                  ? 7340032
                  : metric === 'mempool_count'
                    ? 1842
                    : metric === 'mempool_fee'
                      ? 1
                      : 7;

    const now = Date.now();
    const points = Array.from({ length: 49 }, (_, i) => ({
      at: now - (48 - i) * 1800000,
      value: i === 20 ? null : Math.max(0, scale * (1 + Math.sin(i / 4) * 0.3)),
      peak: scale * 1.3,
      total: 0,
      coverage: i === 20 ? 0 : 1800,
      samples: i === 20 ? 0 : 180,
    }));

    return route.fulfill({
      json: {
        metric,
        range,
        interval_seconds: 1800,
        points,
        total: metric.includes('rate') ? scale * 86400 : 0,
      },
    });
  });

  await signIn(page);

  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);

    for (const route of [
      'Overview',
      'Node details',
      'Mining',
      'Connected peers',
      'Network traffic',
      'Mempool',
      'Recent blocks',
    ]) {
      await navigate(page, route);
      const heading = {
        Overview: 'Your node, in focus.',
        'Node details': 'Your node, in detail.',
        Mining: 'Mining across the network.',
        'Connected peers': 'Connected to the network.',
        'Network traffic': 'Every byte, accounted for.',
        Mempool: 'Waiting for the next block.',
        'Recent blocks': 'The chain keeps growing.',
      }[route]!;

      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      await expect(page.locator('.chart-empty.skeleton')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );

      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      });

      const name = route.toLowerCase().replaceAll(' ', '-');
      await page.screenshot({ path: `${prefix}-${name}-${theme}.png`, fullPage: true });

      if (route === 'Overview' && theme === 'light')
        await page.screenshot({ path: `${prefix}.png`, fullPage: true });
    }
  }

  await page.getByLabel('Language', { exact: true }).selectOption('de');
  await navigate(page, 'Übersicht');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await page.screenshot({ path: `${prefix}-german.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test('login and monitoring routes pass automated accessibility checks in both themes', async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  async function audit() {
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(
      result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })),
    ).toEqual([]);
  }

  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);
    await audit();
  }

  await mockMap(page);
  await signIn(page);

  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);

    for (const route of [
      'Overview',
      'Node details',
      'Mining',
      'Connected peers',
      'Network traffic',
      'Mempool',
      'Recent blocks',
    ]) {
      await navigate(page, route);
      await expect(page.locator('.chart-empty.skeleton')).toHaveCount(0);
      await audit();

      if (route === 'Recent blocks') {
        await page.getByRole('button', { name: 'Inspect block 900,123', exact: true }).click();
        await audit();
      }

      if (route === 'Connected peers') {
        await page.getByRole('button', { name: '192.0.2.12:8333', exact: true }).click();
        await audit();
        await page.keyboard.press('Escape');
      }
    }
  }
});
