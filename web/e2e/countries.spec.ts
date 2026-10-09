import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mapFixture, mockMap, navigate, signIn } from './fixtures';

test('country bars count peers, include unknown locations, translate and retain stale data', async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const fixture = {
    ...mapFixture,
    data: {
      ...mapFixture.data!,
      peers: [...mapFixture.data!.peers, { ...mapFixture.data!.peers[0]!, id: 7 }],
      located: 5,
    },
  };

  await mockMap(page, fixture);
  await signIn(page);
  await navigate(page, 'Connected peers');
  await expect(
    page.getByRole('heading', { name: 'Connected to the network.', exact: true }),
  ).toBeVisible();

  let panel = page.getByRole('region', { name: 'Peers by country', exact: true });
  await expect(panel.getByText('7 peers · 4 countries')).toBeVisible();
  const us = panel
    .locator('.country-bars > div')
    .filter({ has: page.getByText('United States', { exact: true }) });

  await expect(us.locator('.country-count')).toHaveText('2');
  await expect(us.locator('.country-share')).toHaveText('28.6%');
  await expect(panel.locator('.country-unknown .country-count')).toHaveText('2');
  await expect(panel.getByText('Germany', { exact: true })).toHaveCount(0);
  await expect(panel.locator('.country-bars > div')).toHaveCount(5);

  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);
    const audit = await new AxeBuilder({ page })
      .include('.country-panel')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(audit.violations).toEqual([]);
  }

  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  await expect(page.locator('.chart-empty.skeleton')).toHaveCount(0);
  await page.screenshot({
    path: `../.impeccable/review/countries-${info.project.name}.png`,
    fullPage: true,
  });

  await page.getByLabel('Language', { exact: true }).selectOption('de');
  panel = page.getByRole('region', { name: 'Peers nach Land', exact: true });
  await expect(panel.getByText('Vereinigte Staaten', { exact: true })).toBeVisible();
  await expect(panel.getByText('Land unbekannt', { exact: true })).toBeVisible();
  await expect(panel.getByText('28,6%')).toHaveCount(2);
  await mockMap(page, { ...fixture, stale: true });
  await page.getByRole('button', { name: 'Node-Daten aktualisieren' }).click();
  await expect(panel.getByRole('alert')).toContainText('letzten');
  await expect(panel.locator('.country-bars > div')).toHaveCount(5);
  const many = ['US', 'JP', 'AU', 'GB', 'DE', 'FR', 'IT', 'ES', 'CA', 'NL'].map((code, index) => ({
    ...fixture.data.peers[0]!,
    id: 100 + index,
    location: { ...fixture.data.peers[0]!.location!, country_code: code },
  }));

  await mockMap(page, {
    ...fixture,
    data: {
      ...fixture.data,
      peers: [...many, ...fixture.data.peers.filter((peer) => !peer.location)],
      located: 10,
    },
  });

  await page.getByRole('button', { name: 'Node-Daten aktualisieren' }).click();
  await expect(panel.getByRole('button', { name: 'Alle 10 Länder anzeigen' })).toBeVisible();
  await expect(panel.locator('.country-bars > div')).toHaveCount(9);
  await expect(panel.getByText('Land unbekannt', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Alle 10 Länder anzeigen' }).click();
  await expect(panel.locator('.country-bars > div')).toHaveCount(11);
  await panel.getByRole('button', { name: 'Weniger Länder anzeigen' }).click();
  await expect(panel.locator('.country-bars > div')).toHaveCount(9);
  await mockMap(page, {
    ...fixture,
    data: { ...fixture.data, peers: [], located: 0, unlocated: 0 },
  });

  await page.getByRole('button', { name: 'Node-Daten aktualisieren' }).click();
  await expect(panel.locator('.country-bars > div')).toHaveCount(0);
});
