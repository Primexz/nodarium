import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { mapFixture, mockMap, navigate, signIn } from './fixtures';

// Read the rendered dot centers so tests exercise actual canvas hit testing after
// zoom/resizing, without exposing chart internals or adding test hooks to the app.
async function peerPoint(page: Page, inbound = true, scroll = true) {
  const map = page.locator('.peer-map-canvas');

  if (scroll) await map.scrollIntoViewIfNeeded();

  const color = await page
    .locator('.map-legend i')
    .nth(inbound ? 0 : 1)
    .evaluate((element) => getComputedStyle(element).backgroundColor);

  return map.evaluate(
    (element, { color, inbound }) => {
      const rgb = color.match(/\d+/g)!.slice(0, 3).map(Number);
      const pixels: { x: number; y: number }[] = [];

      for (const canvas of element.querySelectorAll('canvas')) {
        const box = canvas.getBoundingClientRect();
        const image = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;

        for (let index = 0; index < image.length; index += 4) {
          if (
            image[index + 3]! < 250 ||
            rgb.some((value, channel) => Math.abs(image[index + channel]! - value) > 2)
          )
            continue;

          const pixel = index / 4;
          pixels.push({
            x: box.left + (((pixel % canvas.width) + 0.5) * box.width) / canvas.width,
            y: box.top + ((Math.floor(pixel / canvas.width) + 0.5) * box.height) / canvas.height,
          });
        }
      }

      if (!pixels.length) throw new Error('Peer dot was not rendered');

      // New York is the leftmost inbound point; Sydney is the rightmost outbound.
      const edge = inbound
        ? Math.min(...pixels.map((point) => point.x))
        : Math.max(...pixels.map((point) => point.x));

      const dot = pixels.filter((point) => Math.abs(point.x - edge) < 7);

      return {
        x: dot.reduce((sum, point) => sum + point.x, 0) / dot.length,
        y: dot.reduce((sum, point) => sum + point.y, 0) / dot.length,
      };
    },
    { color, inbound },
  );
}

test('hover shows a nearby peer box without changing the selected peer', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Touch users select peers by tapping or dropdown.');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockMap(page);
  await signIn(page);
  await navigate(page, 'Peers');
  const box = page.locator('.peer-map-tooltip');
  const details = page.locator('.selected-peer');
  const picker = page.getByLabel('Inspect located peer');
  const first = await peerPoint(page);
  await page.mouse.move(first.x, first.y);
  await expect(box).toBeVisible();
  await expect(box).toContainText('8.8.8.8:8333');
  await expect(box).toContainText('New York, United States');
  await expect(box).toContainText('Inbound');
  await expect(box.locator('.country-flag img')).toHaveAttribute('src', /\/us-[^/]+\.svg$/);
  await expect(details).toHaveCount(0);
  await expect(picker).toHaveValue('');
  await box.hover();
  await expect(box).toBeVisible();
  await page.locator('.map-details').hover();
  await expect(box).toBeHidden();
  await picker.selectOption('1');
  const other = await peerPoint(page, false);
  await page.mouse.move(other.x, other.y);
  await expect(box).toContainText('Sydney, Australia');
  await expect(details).toContainText('8.8.8.8:8333');
  await page.mouse.click(other.x, other.y);
  await expect(details).toContainText('Sydney, Australia');
  await picker.focus();
  await picker.selectOption('1');
  await expect(picker).toBeFocused();
  await expect(details).toContainText('8.8.8.8:8333');
  await page.getByLabel('Map connection direction').selectOption('inbound');
  await expect(details).toHaveCount(0);
  await expect(box).toBeHidden();
});

test('peer boxes work across localized responsive map layouts', async ({ page }, info) => {
  test.setTimeout(90000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockMap(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await signIn(page);
  await navigate(page, 'Peers');
  const widths = info.project.name === 'desktop' ? [1440, 2048] : [390];

  for (const width of widths) {
    await page.setViewportSize({ width, height: info.project.name === 'desktop' ? 1100 : 844 });

    for (const [language, theme] of [
      ['en', 'light'],
      ['de', 'dark'],
    ]) {
      await page.locator('.preference-picker select').first().selectOption(language!);
      await page.locator('.preference-picker select').nth(1).selectOption(theme!);
      await page.locator('.map-peer-select').selectOption('');
      await page.locator('.map-details').hover();
      // Wait for the resized/theme-updated chart to paint before reading its dots.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );

      const point = await peerPoint(page);

      if (info.project.name === 'desktop') await page.mouse.move(point.x, point.y);
      else await page.touchscreen.tap(point.x, point.y);

      const box = page.locator('.peer-map-tooltip');
      await expect(box).toBeVisible();
      await expect(box).toContainText('8.8.8.8:8333');
      await expect(box).toContainText(language === 'en' ? 'Inbound' : 'Eingehend');
      const flag = box.locator('.country-flag img');
      await expect(flag).toHaveAttribute('src', /\/us-[^/]+\.svg$/);
      await expect
        .poll(() =>
          flag.evaluate((element) => {
            const image = element as HTMLImageElement;

            return (
              image.complete &&
              image.naturalWidth > 0 &&
              new URL(image.src).origin === location.origin
            );
          }),
        )
        .toBe(true);

      if (info.project.name === 'mobile')
        await expect(page.locator('.selected-peer')).toContainText('8.8.8.8:8333');
      else await expect(page.locator('.selected-peer')).toHaveCount(0);

      const bounds = await box.boundingBox();
      const map = await page.locator('.peer-map-canvas').boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(map!.x - 1);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(map!.x + map!.width + 1);
      expect(
        (await new AxeBuilder({ page }).include('.peer-map-panel').analyze()).violations,
      ).toEqual([]);

      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );

      await page.locator('.peer-map-panel').screenshot({
        path: `../.impeccable/review/peer-hover-flag-${width}-${language}-${theme}.png`,
      });
    }
  }

  expect(errors).toEqual([]);
});

test('peer box treats peer-provided markup as text', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  const fixture = structuredClone(mapFixture);
  fixture.data!.peers[0]!.address = '<img src=x onerror=alert(1)>:8333';
  fixture.data!.peers[0]!.location!.city = '<b>New York</b>';
  fixture.data!.peers[0]!.location!.country_code = 'US" onerror="alert(1)';
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockMap(page, fixture);
  await signIn(page);
  await navigate(page, 'Peers');
  const point = await peerPoint(page);
  await page.mouse.move(point.x, point.y);
  const box = page.locator('.peer-map-tooltip');
  await expect(box).toContainText('<img src=x onerror=alert(1)>:8333');
  await expect(box).toContainText('<b>New York</b>');
  await expect(box.locator('img, b')).toHaveCount(0);
});
