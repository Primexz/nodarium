import { expect, test } from '@playwright/test';
import { signIn } from './fixtures';

test('footer reaches the viewport bottom on short pages and follows expanded content', async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({
    width: info.project.name === 'mobile' ? 390 : 1440,
    height: info.project.name === 'mobile' ? 1600 : 1100,
  });

  await signIn(page);
  await page.getByLabel('Language', { exact: true }).selectOption('de');
  const footer = page.locator('footer');

  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Darstellung', { exact: true }).selectOption(theme);
    const box = (await footer.boundingBox())!;
    expect(Math.abs(box.y + box.height - page.viewportSize()!.height)).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: `../.impeccable/review/footer-${info.project.name}-${theme}.png`,
      fullPage: true,
    });
  }

  await page.setViewportSize({ width: info.project.name === 'mobile' ? 390 : 1440, height: 600 });
  await page.getByRole('button', { name: 'Block 900.123 ansehen', exact: true }).click();
  await expect(page.locator('.transaction-mosaic canvas')).toBeVisible();
  const content = (await page.locator('#content').boundingBox())!;
  const box = (await footer.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(content.y + content.height - 1);
  expect(box.y).toBeGreaterThan(page.viewportSize()!.height);
  await footer.scrollIntoViewIfNeeded();
  await expect(footer).toBeInViewport();
});
