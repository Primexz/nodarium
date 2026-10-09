import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  i18n,
  message,
  resolveLanguage,
  setLanguage,
  languageStorageKey,
  initializeLanguage,
} from './i18n';
import { bytes, dateTime, decimal, duration, fee, number, bitcoinAmount } from './format';
import { locationName } from './map';
import en from './locales/en.json';
import de from './locales/de.json';

afterEach(() => {
  void i18n.changeLanguage('en');
  vi.unstubAllGlobals();
});

function flatten(value: Record<string, unknown>, prefix = ''): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) =>
      typeof item === 'string'
        ? [[prefix + key, item]]
        : Object.entries(flatten(item as Record<string, unknown>, prefix + key + '.')),
    ),
  );
}

describe('language selection', () => {
  it('prefers a saved supported language, then browser preferences, then English', () => {
    expect(resolveLanguage('de', ['en-US'])).toBe('de');
    expect(resolveLanguage('en', ['de-DE'])).toBe('en');
    expect(resolveLanguage('invalid', ['fr-FR', 'de-AT', 'en-US'])).toBe('de');
    expect(resolveLanguage(null, ['fr-FR'])).toBe('en');
    expect(resolveLanguage(null, [])).toBe('en');
  });

  it('migrates the previous project’s saved language without overriding a Nodarium preference', () => {
    for (const current of [null, 'en']) {
      const values = new Map<string, string>([['btc-monitor-language', 'de']]);

      if (current) values.set(languageStorageKey, current);

      vi.stubGlobal('localStorage', {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      });

      vi.stubGlobal('navigator', { languages: ['en-US'] });
      vi.stubGlobal('document', { documentElement: { lang: '' } });

      initializeLanguage();
      expect(i18n.language).toBe(current ?? 'de');
      expect(values.get(languageStorageKey)).toBe(current ?? 'de');

      if (!current) expect(values.has('btc-monitor-language')).toBe(false);
    }
  });

  it('persists only the selected language and tolerates unavailable browser storage', () => {
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { setItem });
    setLanguage('de');
    expect(i18n.language).toBe('de');
    expect(setItem).toHaveBeenCalledWith(languageStorageKey, 'de');
    setLanguage('invalid');
    expect(i18n.language).toBe('de');
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('Storage blocked');
      },
    });

    expect(() => setLanguage('en')).not.toThrow();
    expect(i18n.language).toBe('en');
  });
});

describe('German translations', () => {
  it('covers every English message and preserves interpolation arguments', () => {
    const english = flatten(en);
    const german = flatten(de);

    expect(Object.keys(german).sort()).toEqual(Object.keys(english).sort());

    for (const [key, value] of Object.entries(english)) {
      expect(german[key]?.trim(), key).toBeTruthy();
      const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(placeholders(german[key]!), key).toEqual(placeholders(value));
    }
  });

  it('formats measurements and country names for the selected locale', () => {
    void i18n.changeLanguage('de');
    expect(number(900123)).toBe('900.123');
    expect(bitcoinAmount('123456789012')).toBe('1.234,57 BTC');
    expect(bitcoinAmount('123456789012', 8)).toBe('1.234,56789012 BTC');
    expect(bitcoinAmount('1402424899372')).toBe('14.024,25 BTC');
    expect(bitcoinAmount('1')).toBe('<0,01 BTC');
    expect(decimal(99.25)).toBe('99,25');
    expect(bytes(1048576)).toBe('1,00 MiB');
    expect(fee(0.00001)).toBe('1,00 sat/vB');
    expect(duration(90061)).toBe('1T 1h');
    expect(dateTime('2026-09-20T12:00:00Z', true)).toBe('20.9.2026');
    expect(locationName({ city: 'Frankfurt', country: 'Germany', country_code: 'DE' })).toBe(
      'Frankfurt, Deutschland',
    );
  });

  it('uses singular/plural forms and translates existing API errors after switching', () => {
    const error = 'Invalid admin key';
    expect(message(error)).toBe('Invalid admin key');
    void i18n.changeLanguage('de');
    expect(message(error)).toBe('Ungültiger Admin-Schlüssel');
    expect(i18n.t('map.unknownCount', { count: 1 })).toBe(
      '1 Peer hat keinen geografischen Standort',
    );

    expect(i18n.t('map.unknownCount', { count: 2 })).toBe(
      '2 Peers haben keinen geografischen Standort',
    );

    expect(message('RPC getpeerinfo failed (code -28)')).toBe(
      'RPC getpeerinfo fehlgeschlagen (Code -28)',
    );

    expect(message('node returned HTTP 500')).toBe('Der Node hat HTTP 500 zurückgegeben');
    expect(message('Unrecognized Core diagnostic')).toBe('Unrecognized Core diagnostic');
  });
});
