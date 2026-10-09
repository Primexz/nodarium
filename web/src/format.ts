import { i18n, intlLocale } from './i18n';

export const number = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 0 }).format(n);

export const decimal = (n: number | null | undefined, digits = 2) =>
  n == null
    ? '—'
    : new Intl.NumberFormat(intlLocale(), {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
        useGrouping: false,
      }).format(n);

export function dateTime(value: string | number, dateOnly = false) {
  const date = new Date(value);

  return dateOnly ? date.toLocaleDateString(intlLocale()) : date.toLocaleString(intlLocale());
}

export function bytes(n: number | null | undefined): string {
  if (n == null) return '—';

  if (n === 0) return '0 B';

  const i = Math.max(0, Math.min(4, Math.floor(Math.log(Math.abs(n)) / Math.log(1024))));

  return `${decimal(n / 1024 ** i, i ? 2 : 0)} ${['B', 'KiB', 'MiB', 'GiB', 'TiB'][i]}`;
}

export function duration(n: number | null | undefined): string {
  if (n == null) return '—';

  n = Math.max(0, n);
  const t = i18n.t.bind(i18n);

  if (n >= 86400)
    return t('duration.days', {
      days: Math.floor(n / 86400),
      hours: Math.floor((n % 86400) / 3600),
    });

  if (n >= 3600)
    return t('duration.hours', {
      hours: Math.floor(n / 3600),
      minutes: Math.floor((n % 3600) / 60),
    });

  if (n >= 60)
    return t('duration.minutes', { minutes: Math.floor(n / 60), seconds: Math.floor(n % 60) });

  return t('duration.seconds', { seconds: Math.floor(n) });
}

export const shortHash = (hash: string) => `${hash.slice(0, 12)}…${hash.slice(-8)}`;

export const fee = (n: number | null | undefined) =>
  n == null ? '—' : `${decimal(n * 100000)} sat/vB`;

function compactParts(n: number | null | undefined, reference = n) {
  if (n == null || !Number.isFinite(n) || n < 0) return null;

  const scale = reference != null && Number.isFinite(reference) && reference >= 0 ? reference : n;
  const power = scale === 0 ? 0 : Math.max(0, Math.min(8, Math.floor(Math.log10(scale) / 3)));

  return {
    value: decimal(n / 1000 ** power),
    prefix: ['', 'k', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y'][power],
  };
}

export function compactNumber(n: number | null | undefined): string {
  const parts = compactParts(n);

  return parts ? `${parts.value}${parts.prefix}` : '—';
}

// A reference keeps one unit across a chart axis, including zero and upper ticks.
export function hashrate(n: number | null | undefined, reference = n): string {
  const parts = compactParts(n, reference);

  return parts ? `${parts.value} ${parts.prefix}H/s` : '—';
}

// Keep integer satoshis exact, including totals beyond Number.MAX_SAFE_INTEGER.
export function bitcoinAmount(satoshis: string | null | undefined, digits: 2 | 8 = 2): string {
  if (satoshis == null || !/^\d+$/.test(satoshis)) return '—';

  const amount = BigInt(satoshis);
  const scale = 10n ** BigInt(8 - digits);
  const rounded = (amount + scale / 2n) / scale;
  const unit = 10n ** BigInt(digits);
  const whole = new Intl.NumberFormat(intlLocale()).format(rounded / unit);
  const separator = new Intl.NumberFormat(intlLocale())
    .formatToParts(1.1)
    .find((p) => p.type === 'decimal')!.value;

  if (digits === 2 && amount > 0n && amount < scale) return `<0${separator}01 BTC`;

  return `${whole}${separator}${(rounded % unit).toString().padStart(digits, '0')} BTC`;
}
