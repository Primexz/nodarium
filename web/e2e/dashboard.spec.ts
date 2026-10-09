import { test, expect } from '@playwright/test';
import { mapFixture, mockMap, signIn, navigate } from './fixtures';

test('admin authentication protects API and supports logout', async ({ page, request }) => {
  expect((await request.get('/api/1.0/peers')).status()).toBe(401);
  expect((await request.get('/api/1.0/peer-map')).status()).toBe(401);
  await page.goto('/');
  await page.getByLabel('Admin key', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Open dashboard' }).click();
  await expect(page.getByRole('alert')).toHaveText('Invalid admin key');
  await page.getByLabel('Admin key', { exact: true }).fill('e2e-admin-key');
  await page.getByRole('button', { name: 'Open dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Your node, in focus.' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  const menu = page.getByRole('button', { name: 'Open navigation' });

  if (await menu.isVisible()) await menu.click();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByLabel('Admin key', { exact: true })).toBeVisible();
  expect((await page.request.get('/api/1.0/overview')).status()).toBe(401);
});

test('overview displays node metrics without horizontal overflow', async ({ page }, info) => {
  await mockMap(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page);
  await expect(page.getByText('900,123', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Up to date', { exact: true })).toBeVisible();
  await expect(page.getByText('Node connected', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  await page.screenshot({
    path: `test-results/overview-${info.project.name}.png`,
    fullPage: true,
  });

  expect(errors).toEqual([]);
});

test('peers can be searched, filtered, sorted and inspected', async ({ page }) => {
  await signIn(page);
  await navigate(page, 'Connected peers');
  await page.getByLabel('Search peers').fill('192.0.2.12');
  await expect(page.getByRole('button', { name: '192.0.2.12:8333', exact: true })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: '192.0.2.12:8333', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('WITNESS');
  await page.getByLabel('Close peer details').click();
  await page.getByLabel('Search peers').fill('');
  await page.getByLabel('Filter peer direction').selectOption('outbound');
  await expect(page.locator('tbody tr')).toHaveCount(4);
  await page.getByRole('button', { name: 'Latency' }).click();
  await page.getByLabel('Search peers').fill('no-such-peer');
  await expect(page.getByText('No matching peers')).toBeVisible();
});

test('charts change range and all monitoring views are available', async ({ page }) => {
  await signIn(page);
  await navigate(page, 'Network traffic');
  const response = page.waitForResponse(
    (r) => r.url().includes('metric=rx_rate&range=1y') && r.status() === 200,
  );

  await page.getByRole('button', { name: '1y', exact: true }).click();
  await response;
  await expect(page.getByRole('button', { name: '1y', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await expect(page.getByText('No upload target configured')).toBeVisible();
  await navigate(page, 'Mempool');
  await expect(page.getByText('1,842', { exact: true })).toBeVisible();
  await navigate(page, 'Recent blocks');
  await expect(page.locator('tbody tr')).toHaveCount(10);
});

test('lost RPC connection is clearly marked while last readings remain visible', async ({
  page,
}) => {
  await signIn(page);
  await page.route('**/api/1.0/overview', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.status = 'disconnected';
    body.overview.stale = true;
    body.overview.error = 'node unreachable or request timed out';
    await route.fulfill({ json: body });
  });

  await page.getByRole('button', { name: 'Refresh node data' }).click();
  await expect(page.getByText('Node connection lost')).toBeVisible();
  await expect(page.getByText('900,123', { exact: true }).first()).toBeVisible();
});

test('peer map shows locations, direction filters, controls and unlocated peers', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockMap(page);
  await signIn(page);
  await navigate(page, 'Connected peers');
  const map = page.getByRole('img', {
    name: 'World map showing 4 located peers connected to My node',
  });

  await expect(map).toBeVisible();
  await expect(map.locator('canvas').first()).toBeVisible();
  await expect(page.getByText('Frankfurt, Germany', { exact: true })).toBeVisible();
  await page.getByLabel('Zoom map in').click();
  await page.getByLabel('Zoom map out').click();
  await page.getByLabel('Reset map view').click();
  await page.getByLabel('Inspect located peer').selectOption('1');
  await expect(page.locator('.selected-peer')).toContainText('New York, United States');
  await expect(page.locator('.selected-peer')).toContainText('8.8.8.8:8333');
  await page.getByLabel('Map connection direction').selectOption('inbound');
  await expect(
    page.getByRole('img', { name: 'World map showing 2 located peers connected to My node' }),
  ).toBeVisible();

  await expect(page.locator('.unlocated-peers')).toHaveCount(0);
  await page.getByLabel('Map connection direction').selectOption('all');
  await page.locator('.unlocated-peers summary').click();
  await expect(page.getByText('Private or reserved address', { exact: true })).toBeVisible();
  await expect(page.getByText('Tor, I2P, or non-IP address', { exact: true })).toBeVisible();
  await page
    .locator('.peer-map-panel')
    .screenshot({ path: `test-results/map-${info.project.name}.png` });

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await navigate(page, 'Connected peers');
  await expect(
    page.getByRole('img', { name: 'World map showing 4 located peers connected to My node' }),
  ).toBeVisible();

  expect(errors).toEqual([]);
});

test('map reports absent node location, empty peers and stale data', async ({ page }) => {
  const fixture = structuredClone(mapFixture);
  fixture.data!.node = null;
  fixture.data!.node_message =
    'Set NODE_IP to your node’s public IP address to draw connection lines.';

  fixture.data!.peers = [];
  fixture.data!.located = 0;
  fixture.data!.unlocated = 0;
  fixture.stale = true;
  await mockMap(page, fixture);
  await signIn(page);
  await navigate(page, 'Connected peers');
  await expect(page.getByText('No connected peers yet')).toBeVisible();
  await expect(page.getByText(fixture.data!.node_message)).toBeVisible();
  await expect(
    page
      .locator('.peer-map-panel')
      .getByText('Showing the last known peer locations; node readings are stale.'),
  ).toBeVisible();
});

test('GeoIP failure preserves the rest of the dashboard', async ({ page }) => {
  await signIn(page);
  await navigate(page, 'Connected peers');
  // This uses the real authenticated endpoint with no city database configured.
  await expect(
    page
      .locator('.peer-map-panel')
      .getByText('No city GeoIP database is available.', { exact: false }),
  ).toBeVisible();

  await navigate(page, 'Overview');
  await expect(page.getByText('900,123', { exact: true }).first()).toBeVisible();
  const response = await page.request.get('/api/1.0/peer-map');
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.data.status).toBe('unavailable');
  expect(body.data.node).toBeNull();
});

test('top bar switches the full dashboard to German and remembers the selection', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (entry) => {
    if (entry.type() === 'warning' && entry.text().includes('intlify')) errors.push(entry.text());
  });

  await mockMap(page);
  await signIn(page);
  await page.locator('.topbar').getByRole('combobox', { name: 'Language' }).selectOption('de');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page.getByRole('heading', { name: 'Dein Node im Überblick.' })).toBeVisible();
  await expect(page.getByText('900.123', { exact: true }).first()).toBeVisible();
  await navigate(page, 'Verbundene Peers');
  await expect(page.getByRole('heading', { name: 'Peer-Verbindungen weltweit' })).toBeVisible();
  await expect(page.getByText('Frankfurt, Deutschland', { exact: true })).toBeVisible();
  await page.locator('.unlocated-peers summary').click();
  await expect(page.getByText('Private oder reservierte Adresse', { exact: true })).toBeVisible();
  await page.getByLabel('Lokalisierten Peer auswählen').selectOption('1');
  await expect(page.locator('.selected-peer')).toContainText('New York, Vereinigte Staaten');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: `test-results/german-topbar-${info.project.name}.png` });
  await page.screenshot({
    path: `test-results/german-overview-${info.project.name}.png`,
    fullPage: true,
  });

  await navigate(page, 'Übersicht');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Dein Node im Überblick.' })).toBeVisible();
  await expect(page.locator('.topbar').getByRole('combobox', { name: 'Sprache' })).toHaveValue(
    'de',
  );

  const germanNavigate = async (name: string) => {
    const menu = page.getByRole('button', { name: 'Navigation öffnen' });

    if (await menu.isVisible()) await menu.click();

    await page.getByRole('navigation').getByRole('link', { name }).click();
  };

  await germanNavigate('Verbundene Peers');
  await page.getByLabel('Peers suchen', { exact: true }).fill('192.0.2.12');
  await page.getByRole('button', { name: '192.0.2.12:8333', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Verbindungsdetails');
  await page.getByLabel('Peer-Details schließen').click();
  await germanNavigate('Netzwerkverkehr');
  await expect(page.getByText('Kein Upload-Limit konfiguriert')).toBeVisible();
  await page.getByRole('button', { name: '1J', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Netzwerkverkehr für 1J' })).toBeVisible();
  await germanNavigate('Mempool');
  await expect(page.getByText('1.842', { exact: true })).toBeVisible();
  await germanNavigate('Neueste Blöcke');
  await expect(page.getByRole('columnheader', { name: 'Bestätigungen' })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(10);
  await page.locator('.topbar').getByRole('combobox', { name: 'Sprache' }).selectOption('en');
  await expect(page.getByRole('heading', { name: 'The chain keeps growing.' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  expect(errors).toEqual([]);
});

test('login errors and GeoIP outages follow the selected language', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Language', { exact: true }).selectOption('de');
  await page.getByLabel('Admin-Schlüssel', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Dashboard öffnen' }).click();
  await expect(page.getByRole('alert')).toHaveText('Ungültiger Admin-Schlüssel');
  await page.getByLabel('Sprache', { exact: true }).selectOption('en');
  await expect(page.getByRole('alert')).toHaveText('Invalid admin key');
  await page.getByLabel('Language', { exact: true }).selectOption('de');
  await page.getByLabel('Admin-Schlüssel', { exact: true }).fill('e2e-admin-key');
  await page.getByRole('button', { name: 'Dashboard öffnen' }).click();
  await navigate(page, 'Verbundene Peers');
  await expect(
    page
      .locator('.peer-map-panel')
      .getByText('Keine GeoIP-Stadtdatenbank verfügbar.', { exact: false }),
  ).toBeVisible();

  const menu = page.getByRole('button', { name: 'Navigation öffnen' });

  if (await menu.isVisible()) await menu.click();

  await page.getByRole('button', { name: 'Abmelden' }).click();
  await expect(page.getByRole('heading', { name: 'Willkommen zurück.' })).toBeVisible();
  expect(await page.evaluate(() => Object.entries(localStorage))).toEqual([
    ['nodarium-language', 'de'],
  ]);
});

test.describe('German browser preference', () => {
  test.use({ locale: 'de-DE' });
  test('starts in German without a saved preference', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Willkommen zurück.' })).toBeVisible();
    await expect(page.getByLabel('Sprache', { exact: true })).toHaveValue('de');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  });
});

test('recent blocks show compact amounts, exact details and transaction counts in both languages', async ({
  page,
}, info) => {
  await signIn(page);
  await navigate(page, 'Recent blocks');
  await expect(page.getByRole('columnheader', { name: 'Total amount', exact: true })).toBeVisible();
  const first = page.locator('tbody tr').first();
  await expect(page.getByRole('columnheader', { name: 'Transactions', exact: true })).toBeVisible();
  await expect(first.locator('td').nth(3)).toHaveText('2,500');
  await expect(first.locator('summary')).toHaveText('1,234.57 BTC');
  await expect(first.locator('.block-amount small')).not.toBeVisible();
  await first.locator('summary').click();
  await expect(first.locator('.block-amount small')).toHaveText('1,234.56789012 BTC');
  await expect(first.locator('.block-amount small')).toBeVisible();
  await first.locator('summary').press('Enter');
  await expect(first.locator('.block-amount small')).not.toBeVisible();
  await expect(
    page.getByText('Sum of transaction outputs, including change, excluding the block reward.', {
      exact: false,
    }),
  ).toBeVisible();

  await page.locator('.topbar').getByLabel('Language', { exact: true }).selectOption('de');
  await expect(page.getByRole('columnheader', { name: 'Gesamtbetrag', exact: true })).toBeVisible();
  await expect(first.locator('summary')).toHaveText('1.234,57 BTC');
  await expect(
    page.getByRole('columnheader', { name: 'Transaktionen', exact: true }),
  ).toBeVisible();

  await expect(first.locator('td').nth(3)).toHaveText('2.500');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `test-results/block-amounts-${info.project.name}.png`,
    fullPage: true,
  });

  await page.route('**/api/1.0/blocks', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.data[0].total_transaction_amount_sats = null;
    body.data[0].transaction_count = null;
    body.data[1].transaction_count = 1;
    body.data[1].total_transaction_amount_sats = '0';
    await route.fulfill({ json: body });
  });

  await page.getByRole('button', { name: 'Node-Daten aktualisieren' }).click();
  await expect(page.locator('tbody tr').first()).toContainText('Nicht verfügbar');
  await expect(page.locator('tbody tr').nth(1)).toContainText('0,00 BTC');
  await expect(page.locator('tbody tr')).toHaveCount(10);
  await expect(first.locator('td').nth(3)).toHaveText('—');
  await expect(page.locator('tbody tr').nth(1).locator('td').nth(3)).toHaveText('1');
});

test('block rows expand into responsive details and preserve selection across refreshes', async ({
  page,
}, info) => {
  await signIn(page);
  await navigate(page, 'Recent blocks');
  const toggle = page.getByRole('button', { name: 'Expand block 900,123', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  const panel = page.getByRole('region', { name: 'Block 900,123 details', exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('2,500', { exact: true })).toBeVisible();
  await expect(panel.getByText('0.12567890 BTC', { exact: true })).toBeVisible();
  await expect(panel.getByText('1.67 MiB', { exact: true })).toBeVisible();
  await expect(panel.getByText('3,800,000 WU', { exact: true })).toBeVisible();
  await expect(panel.getByRole('meter')).toHaveAttribute('aria-valuenow', '95');
  await expect(page.locator('.block-summary-row')).toHaveCount(10);
  await expect(page.locator('.block-detail-row')).toHaveCount(1);
  const bounds = await panel.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.getByRole('button', { name: 'Refresh node data' }).click();
  await expect(panel).toBeVisible();
  await page.locator('.topbar').getByLabel('Language', { exact: true }).selectOption('de');
  const german = page.getByRole('region', { name: 'Details zu Block 900.123', exact: true });
  await expect(german.getByText('Gesamtgebühren', { exact: true })).toBeVisible();
  await expect(german.getByText('0,12567890 BTC', { exact: true })).toBeVisible();
  await expect(german.getByText('95,00%', { exact: true })).toBeVisible();
  await german.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `test-results/block-details-${info.project.name}.png`,
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Block 900.123 zuklappen', exact: true }).press('Enter');
  await expect(german).toHaveCount(0);
  await page.getByRole('button', { name: 'Block 900.123 aufklappen', exact: true }).press('Space');
  await expect(german).toBeVisible();
  await page.getByRole('button', { name: 'Block 900.122 aufklappen', exact: true }).click();
  await expect(german).toHaveCount(0);
  await expect(page.locator('.block-detail-row')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('block details distinguish missing data from zero and close after a reorg', async ({
  page,
}) => {
  let reorg = false;
  await page.route('**/api/1.0/blocks', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    Object.assign(body.data[0], {
      total_fees_sats: '0',
      size_bytes: null,
      weight_units: null,
      capacity_percent: null,
    });

    body.stale = true;

    if (reorg) body.data[0].hash = 'f'.repeat(64);

    await route.fulfill({ json: body });
  });

  await signIn(page);
  await navigate(page, 'Recent blocks');
  await page.getByRole('button', { name: 'Expand block 900,123', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Block 900,123 details', exact: true });
  await expect(panel.getByText('0.00000000 BTC', { exact: true })).toBeVisible();
  await expect(panel.getByText('2,500', { exact: true })).toBeVisible();
  await expect(panel.getByText('Some details are unavailable.', { exact: false })).toBeVisible();
  await expect(
    panel.getByText('Showing the last known block details;', { exact: false }),
  ).toBeVisible();

  await expect(panel.getByRole('meter')).toHaveCount(0);
  await expect(panel.locator('dd', { hasText: '—' })).toHaveCount(3);
  reorg = true;
  await page.getByRole('button', { name: 'Refresh node data' }).click();
  await expect(panel).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Expand block 900,123', exact: true }),
  ).toHaveAttribute('aria-expanded', 'false');
});
