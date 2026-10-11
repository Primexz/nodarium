import { expect, type Page } from '@playwright/test';
import type { PeerMapData, Section } from '../src/types';

export const mapFixture: Section<PeerMapData> = {
  updated_at: new Date().toISOString(),
  stale: false,
  data: {
    status: 'ready',
    database_date: '2026-09-01T00:00:00Z',
    attribution: { name: 'DB-IP', url: 'https://db-ip.com' },
    located: 4,
    unlocated: 2,
    node: {
      ip: '1.1.1.1',
      label: 'My node',
      source: 'configured_ip',
      latitude: 50.1,
      longitude: 8.6,
      city: 'Frankfurt',
      country: 'Germany',
      country_code: 'DE',
    },
    peers: [
      {
        id: 1,
        address: '8.8.8.8:8333',
        inbound: true,
        location: {
          latitude: 40.7,
          longitude: -74,
          city: 'New York',
          country: 'United States',
          country_code: 'US',
        },
      },
      {
        id: 2,
        address: '[2606:4700:4700::1111]:8333',
        inbound: false,
        location: {
          latitude: 35.7,
          longitude: 139.7,
          city: 'Tokyo',
          country: 'Japan',
          country_code: 'JP',
        },
      },
      {
        id: 3,
        address: '1.0.0.1:8333',
        inbound: false,
        location: {
          latitude: -33.9,
          longitude: 151.2,
          city: 'Sydney',
          country: 'Australia',
          country_code: 'AU',
        },
      },
      {
        id: 4,
        address: '9.9.9.9:8333',
        inbound: true,
        location: {
          latitude: 51.5,
          longitude: -0.1,
          city: 'London',
          country: 'United Kingdom',
          country_code: 'GB',
        },
      },
      { id: 5, address: 'example.onion:8333', inbound: false, location: null, reason: 'non_ip' },
      {
        id: 6,
        address: '192.168.1.10:8333',
        inbound: false,
        location: null,
        reason: 'private_or_reserved',
      },
    ],
  },
};

export async function mockMap(page: Page, section = mapFixture) {
  await page.route('**/api/1.0/peer-map', (route) => route.fulfill({ json: section }));
}

export async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('Admin key', { exact: true }).fill('e2e-admin-key');
  await page.getByRole('button', { name: 'Open dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Mempool', exact: true })).toBeVisible();
}

export async function navigate(page: Page, name: string) {
  const parents: Record<string, string> = {
    Peers: 'My node',
    Traffic: 'My node',
    Events: 'My node',
    Trends: 'Mempool',
    Analytics: 'Blocks',
    Pools: 'Mining',
    Datenverkehr: 'Mein Node',
    Ereignisse: 'Mein Node',
    Verlauf: 'Mempool',
    Analyse: 'Blöcke',
  };

  const german = (await page.locator('html').getAttribute('lang')) === 'de';
  const parent =
    name === 'Peers' && german
      ? 'Mein Node'
      : name === 'Pools' && german
        ? 'Mining'
        : parents[name];

  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.locator('.navigation-drawer[data-state="closed"]')).toBeHidden();
  const menu = page.getByRole('button', { name: /^(Open navigation|Navigation öffnen)$/ });

  if (await menu.isVisible()) await menu.click();

  const primary = page
    .getByRole('navigation', { name: /^(Workspace|Arbeitsbereich)$/ })
    .getByRole('link', { name: parent ?? name, exact: true });

  let path = (await primary.getAttribute('href'))!;
  await primary.click();
  await expect(page).toHaveURL((url) => url.pathname === path);

  await expect(page.locator('.navigation-drawer[data-state="closed"]')).toBeHidden();

  if (parent) {
    const secondary = page.locator('.view-navigation').getByRole('link', { name, exact: true });
    path = (await secondary.getAttribute('href'))!;
    await secondary.click();
    await expect(page).toHaveURL((url) => url.pathname === path);
  }

  await expect(page.locator('.view-navigation a[aria-current="page"]')).toHaveAttribute(
    'href',
    path,
  );
}
