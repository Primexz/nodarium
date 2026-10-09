import { expect, request, type FullConfig } from '@playwright/test';
import type { OverviewResponse } from '../src/types';

export default async function globalSetup(config: FullConfig) {
  const api = await request.newContext({ baseURL: config.projects[0]!.use.baseURL });

  try {
    const login = await api.post('/api/1.0/auth/login', { data: { key: 'e2e-admin-key' } });
    await expect(login).toBeOK();

    // /healthz reports process health only. The mock RPC server may start after
    // the collector's first attempt, so wait for real data before opening browsers.
    await expect
      .poll(
        async () => {
          const response = await api.get('/api/1.0/overview');

          if (!response.ok()) return false;

          const snapshot: OverviewResponse = await response.json();

          return (
            snapshot.status === 'connected' &&
            snapshot.overview.data !== null &&
            !snapshot.overview.stale
          );
        },
        {
          message: 'The browser-test RPC fixture must be collected before tests start',
          timeout: 30000,
          intervals: [100, 250, 500],
        },
      )
      .toBe(true);
  } finally {
    try {
      await api.post('/api/1.0/auth/logout');
    } finally {
      await api.dispose();
    }
  }
}
