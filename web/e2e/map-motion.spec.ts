import { test, expect } from '@playwright/test';
import { mapFixture, mockMap, navigate, signIn } from './fixtures';

test('peer connection lines animate and stop for reduced motion and stale readings', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await mockMap(page);
  await signIn(page);
  await navigate(page, 'Connected peers');
  await expect(
    page.getByRole('heading', { name: 'Connected to the network.', exact: true }),
  ).toBeVisible();

  const map = page.locator('.peer-map-canvas');
  await map.scrollIntoViewIfNeeded();
  await expect(map.locator('canvas').first()).toBeVisible();
  const frame = () =>
    map.evaluate((element) =>
      Array.from(element.querySelectorAll('canvas'), (canvas) => canvas.toDataURL()).join(''),
    );

  async function expectMoving() {
    const initial = await frame();
    await expect.poll(frame).not.toBe(initial);
  }

  async function expectStill() {
    // Sample over several rendered frames; no screenshot goldens depend on a particle's position.
    await expect
      .poll(async () => {
        const initial = await frame();
        await page.waitForTimeout(250);

        return (await frame()) === initial;
      })
      .toBe(true);
  }

  await expectMoving();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expectStill();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expectMoving();
  await mockMap(page, { ...mapFixture, stale: true });
  const refreshed = page.waitForResponse((response) =>
    response.url().endsWith('/api/1.0/peer-map'),
  );

  await page.getByRole('button', { name: 'Refresh node data' }).click();
  await refreshed;
  await expectStill();
  expect(errors).toEqual([]);
});
