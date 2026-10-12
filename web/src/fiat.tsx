import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Coins } from 'lucide-react';
import { api } from './api';
import { bitcoinAmount, dateTime, decimal } from './format';
import { intlLocale } from './i18n';
import type { Section } from './types';

export type Currency = 'BTC' | 'EUR' | 'USD';

export const currencyStorageKey = 'nodarium-fiat-currency';

export interface Prices {
  time: number;
  EUR: number;
  USD: number;
}

export interface FiatRates extends Section<Prices> {
  source: string;
}

export function readCurrency(): Currency {
  try {
    const saved = localStorage.getItem(currencyStorageKey);

    return saved === 'EUR' || saved === 'USD' ? saved : 'BTC';
  } catch {
    return 'BTC';
  }
}

// Convert from integer satoshis using integer cents; never round the BTC amount first.
export function fiatAmount(satoshis: string | null | undefined, rate: number, currency: Currency) {
  if (!satoshis || !/^\d+$/.test(satoshis) || currency === 'BTC') return null;

  const price = Math.round(rate * 100);

  if (!Number.isSafeInteger(price) || price <= 0) return null;

  const amount = BigInt(satoshis);
  const cents = (amount * BigInt(price) + 50000000n) / 100000000n;
  const format = new Intl.NumberFormat(intlLocale(), {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const text = format
    .formatToParts(cents / 100n)
    .map((part) =>
      part.type === 'fraction' ? (cents % 100n).toString().padStart(2, '0') : part.value,
    )
    .join('');

  return amount > 0n && cents === 0n ? `<${format.format(0.01)}` : text;
}

export function bitcoinToSatoshis(btc: number | null | undefined): string | null {
  if (btc == null || !Number.isFinite(btc) || btc < 0 || btc >= 1e21) return null;

  return BigInt(btc.toFixed(8).replace('.', '')).toString();
}

type FiatContextValue = {
  currency: Currency;
  setCurrency: (currency: Currency) => void;
  quote?: FiatRates;
  stale: boolean;
  chain?: string;
};
const FiatContext = createContext<FiatContextValue>({
  currency: 'BTC',
  setCurrency: () => {},
  stale: false,
});

export function FiatProvider({ children, chain }: { children: ReactNode; chain?: string }) {
  const [currency, update] = useState(readCurrency);
  const [now, setNow] = useState(Date.now);
  const query = useQuery({
    queryKey: ['fiat-rates'],
    queryFn: ({ signal }) => api<FiatRates>('fiat-rates', { signal }),
    enabled: currency !== 'BTC' && chain === 'main',
    refetchInterval: 60000,
    staleTime: 60000,
  });

  useEffect(() => {
    if (currency === 'BTC') return;

    const timer = setInterval(() => setNow(Date.now()), 30000);

    return () => clearInterval(timer);
  }, [currency]);

  const setCurrency = useCallback((next: Currency) => {
    update(next);

    try {
      localStorage.setItem(currencyStorageKey, next);
    } catch {
      /* The selector remains usable without optional preference persistence. */
    }
  }, []);

  const quote = query.data;
  const stale =
    !!quote &&
    (query.isError ||
      !!quote.error ||
      quote.stale ||
      !quote.updated_at ||
      now - Date.parse(quote.updated_at) > 2 * 60 * 60 * 1000);

  const value = useMemo(
    () => ({ currency, setCurrency, quote, stale, chain }),
    [currency, setCurrency, quote, stale, chain],
  );

  return <FiatContext.Provider value={value}>{children}</FiatContext.Provider>;
}

export const useFiat = () => useContext(FiatContext);

export function CurrencyPicker() {
  const { t } = useTranslation();
  const { currency, setCurrency } = useFiat();

  return (
    <label className="preference-picker currency-picker">
      <Coins size={15} aria-hidden />
      <select
        aria-label={t('fiat.currency')}
        value={currency}
        onChange={(event) => setCurrency(event.target.value as Currency)}
      >
        <option value="BTC">BTC</option>
        <option value="EUR">EUR · €</option>
        <option value="USD">USD · $</option>
      </select>
    </label>
  );
}

export function useFiatFormat() {
  const { currency, quote, chain } = useFiat();

  return (satoshis: string | null | undefined) =>
    currency === 'BTC' || chain !== 'main' || !quote?.data
      ? null
      : fiatAmount(satoshis, quote.data[currency], currency);
}

export function BitcoinValue({
  satoshis,
  btc,
  digits = 8,
  children,
}: {
  satoshis?: string | null;
  btc?: number | null;
  digits?: 2 | 8;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const { currency, chain, quote, stale } = useFiat();
  const sats = btc === undefined ? satoshis : bitcoinToSatoshis(btc);
  const primary =
    children ??
    (btc === undefined
      ? bitcoinAmount(sats, digits)
      : sats == null
        ? '—'
        : `${decimal(btc, digits)} BTC`);

  const converted = useFiatFormat()(sats);
  const enabled = currency !== 'BTC' && chain === 'main' && sats != null && /^\d+$/.test(sats);

  return (
    <span className="bitcoin-value">
      <span>{primary}</span>
      {enabled && (
        <span
          className={`fiat-value ${stale ? 'fiat-stale' : ''}`}
          title={
            quote?.updated_at
              ? `${quote.source} · ${t('fiat.rateTime', { time: dateTime(quote.updated_at) })} · ${t('fiat.currentRate')}`
              : t('fiat.unavailable')
          }
        >
          {converted ? `≈ ${converted}${stale ? ` · ${t('fiat.stale')}` : ''}` : `— ${currency}`}
        </span>
      )}
    </span>
  );
}
