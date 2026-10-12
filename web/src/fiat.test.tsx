import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { i18n } from './i18n';
import {
  BitcoinValue,
  CurrencyPicker,
  FiatProvider,
  fiatAmount,
  bitcoinToSatoshis,
  currencyStorageKey,
  readCurrency,
} from './fiat';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

it('converts integer satoshis without rounding BTC or losing large totals', async () => {
  expect(fiatAmount('100000000', 100000, 'USD')).toBe('$100,000.00');
  expect(fiatAmount('363', 100000, 'USD')).toBe('$0.36');
  expect(fiatAmount('1', 90000, 'EUR')).toBe('<€0.01');
  expect(fiatAmount('0', 90000, 'EUR')).toBe('€0.00');
  expect(fiatAmount('9007199254740993', 100000, 'USD')).toBe('$9,007,199,254,740.99');
  expect(fiatAmount(null, 90000, 'EUR')).toBeNull();
  expect(fiatAmount('-1', 90000, 'EUR')).toBeNull();
  expect(fiatAmount('1', Number.NaN, 'EUR')).toBeNull();
  expect(fiatAmount('1', 0, 'EUR')).toBeNull();
  expect(fiatAmount('1', 90000, 'BTC')).toBeNull();
  expect(bitcoinToSatoshis(3.125)).toBe('312500000');
  expect(bitcoinToSatoshis(0)).toBe('0');
  expect(bitcoinToSatoshis(undefined)).toBeNull();
  expect(bitcoinToSatoshis(Number.POSITIVE_INFINITY)).toBeNull();
  await i18n.changeLanguage('de');
  expect(fiatAmount('123456789', 90000, 'EUR')).toBe('111.111,11\u00a0€');
});

function mount(chain = 'main') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <FiatProvider chain={chain}>
        <CurrencyPicker />
        <BitcoinValue satoshis="363" />
        <BitcoinValue satoshis={null} />
      </FiatProvider>
    </QueryClientProvider>,
  );

  return { ...view, client };
}

it('requests prices only after choosing fiat, preserves BTC, and shares the quote', async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        data: { USD: 100000, EUR: 90000, time: Math.floor(Date.now() / 1000) },
        updated_at: new Date().toISOString(),
        stale: false,
        source: 'mempool.space',
      }),
    ),
  );

  vi.stubGlobal('fetch', fetch);
  const { client, unmount } = mount();
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Fiat currency'), { target: { value: 'USD' } });
  await screen.findByText('≈ $0.36');
  expect(screen.getByText('0.00000363 BTC')).toBeTruthy();
  expect(screen.getByText('—')).toBeTruthy();
  expect(localStorage.getItem(currencyStorageKey)).toBe('USD');
  fireEvent.change(screen.getByLabelText('Fiat currency'), { target: { value: 'EUR' } });
  await screen.findByText('≈ €0.33');
  expect(fetch).toHaveBeenCalledTimes(1);
  client.setQueryData(['fiat-rates'], {
    data: { USD: 100000, EUR: 90000 },
    updated_at: new Date().toISOString(),
    stale: true,
    error: 'Fiat rates unavailable',
    source: 'mempool.space',
  });

  await screen.findByText('≈ €0.33 · stale rate');
  fireEvent.change(screen.getByLabelText('Fiat currency'), { target: { value: 'BTC' } });
  await waitFor(() => expect(screen.queryByText('≈ €0.33 · stale rate')).toBeNull());
  unmount();
  client.clear();
});

it('keeps the selector usable with blocked storage and never prices test networks', () => {
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
    clear: () => {},
  });

  expect(readCurrency()).toBe('BTC');
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const { unmount, client } = mount('regtest');
  fireEvent.change(screen.getByLabelText('Fiat currency'), { target: { value: 'EUR' } });
  expect(document.querySelector('.fiat-value')).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.getByText('0.00000363 BTC')).toBeTruthy();
  unmount();
  client.clear();
});
