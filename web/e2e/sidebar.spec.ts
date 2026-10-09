import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signIn } from './fixtures';

test('desktop sidebar supports icon navigation, keyboard toggles and a saved preference', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'mobile', 'The mobile layout uses the full navigation drawer.');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page);
  const sidebar = page.locator('#workspace-sidebar');
  await expect(sidebar).toHaveCSS('width', '256px');
  await expect(sidebar.locator('.brand-mark')).toHaveCSS('width', '34px');
  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  await page.screenshot({ path: 'test-results/sidebar-expanded-light.png', fullPage: true });
  const collapse = page.getByRole('button', { name: 'Collapse sidebar', exact: true });
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');
  const toggleBounds = await collapse.boundingBox();
  expect(toggleBounds!.width).toBeGreaterThanOrEqual(44);
  expect(toggleBounds!.height).toBeGreaterThanOrEqual(44);
  await collapse.focus();
  await collapse.press('Enter');
  await expect(sidebar).toHaveCSS('width', '76px');
  await expect(sidebar.locator('.brand-mark')).toHaveCSS('width', '34px');
  await expect(sidebar.locator('nav a')).toHaveCount(7);
  await expect(sidebar.locator('nav a span').first()).toBeHidden();
  await expect(sidebar.locator('.brand-descriptor')).toBeHidden();
  await expect(sidebar.getByRole('button', { name: 'Sign out' })).toBeVisible();
  const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true });
  await expect(expand).toBeFocused();
  await expect(expand).toHaveAttribute('aria-expanded', 'false');

  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);
    const audit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(audit.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );

    await page.screenshot({ path: `test-results/sidebar-collapsed-${theme}.png`, fullPage: true });
  }

  const mining = sidebar.getByRole('link', { name: 'Mining', exact: true });
  await expect(mining).toHaveAttribute('title', 'Mining');
  await mining.focus();
  await mining.press('Enter');
  await expect(page).toHaveURL(/\/mining$/);
  await expect(mining).toHaveAttribute('aria-current', 'page');
  await page.reload();
  await expect(sidebar).toHaveCSS('width', '76px');
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).press('Space');
  await expect(sidebar).toHaveCSS('width', '256px');
  await expect(sidebar.locator('nav a span').first()).toBeVisible();
  await page.reload();
  await expect(sidebar).toHaveCSS('width', '256px');
  await page.getByLabel('Language', { exact: true }).selectOption('de');
  await page.getByRole('button', { name: 'Seitenleiste einklappen', exact: true }).click();
  await expect(
    sidebar.getByRole('link', { name: 'Verbundene Peers', exact: true }),
  ).toHaveAttribute('title', 'Verbundene Peers');

  await expect(
    page.getByRole('button', { name: 'Seitenleiste ausklappen', exact: true }),
  ).toBeVisible();

  await page.setViewportSize({ width: 800, height: 600 });
  await sidebar.getByRole('button', { name: 'Abmelden', exact: true }).scrollIntoViewIfNeeded();
  await sidebar.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await expect(page.getByLabel('Admin-Schlüssel', { exact: true })).toBeVisible();
});

test('a collapsed desktop preference keeps mobile navigation fully labeled', async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    localStorage.setItem('nodarium-sidebar-collapsed', 'true');
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await expect(page.getByRole('button', { name: 'Expand sidebar', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Workspace', exact: true });
  await expect(drawer.locator('.brand-descriptor')).toBeVisible();
  await expect(drawer.locator('.brand-mark')).toHaveCSS('width', '34px');
  await expect(drawer.locator('nav a span').first()).toBeVisible();
  await expect(drawer.getByRole('link', { name: 'Connected peers', exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/sidebar-drawer-${info.project.name}.png` });
  await drawer.getByRole('link', { name: 'Mining', exact: true }).click();
  await expect(page).toHaveURL(/\/mining$/);
  await expect(drawer).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  if (info.project.name === 'desktop') {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await expect(page.locator('#workspace-sidebar')).toHaveCSS('width', '76px');
    await expect(page.getByRole('button', { name: 'Expand sidebar', exact: true })).toBeVisible();
  }
});

test('sidebar toggling still works when browser preference storage is unavailable', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'mobile', 'The desktop toggle is hidden on mobile.');
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Storage unavailable', 'SecurityError');
      },
    });
  });

  await signIn(page);
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await expect(page.locator('#workspace-sidebar')).toHaveCSS('width', '76px');
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
  await expect(page.locator('#workspace-sidebar')).toHaveCSS('width', '256px');
});
