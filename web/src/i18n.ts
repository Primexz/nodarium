import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en';
import de from './locales/de';

export { i18n };

export type Language = 'en' | 'de';

export const languageStorageKey = 'nodarium-language';

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, de: { translation: de } },
  lng: 'en',
  fallbackLng: 'en',
  initAsync: false,
  interpolation: { escapeValue: false },
});

export function resolveLanguage(saved: string | null, languages: readonly string[]): Language {
  if (saved === 'en' || saved === 'de') return saved;

  for (const language of languages) {
    const base = language.toLowerCase().split('-')[0];

    if (base === 'en' || base === 'de') return base;
  }

  return 'en';
}

export function initializeLanguage() {
  let saved: string | null = null;

  try {
    saved = localStorage.getItem(languageStorageKey);

    if (saved === null) {
      const legacy = localStorage.getItem('btc-monitor-language');

      if (legacy === 'en' || legacy === 'de') {
        saved = legacy;
        localStorage.setItem(languageStorageKey, legacy);
        localStorage.removeItem('btc-monitor-language');
      }
    }
  } catch {
    /* Optional persistence. */
  }

  void i18n.changeLanguage(resolveLanguage(saved, navigator.languages));
  document.documentElement.lang = i18n.language;
}

export function setLanguage(language: string) {
  if (language !== 'en' && language !== 'de') return;

  void i18n.changeLanguage(language);
  document.documentElement.lang = language;

  try {
    localStorage.setItem(languageStorageKey, language);
  } catch {
    /* Selection works without storage. */
  }
}

export const intlLocale = () => (i18n.language === 'de' ? 'de-DE' : 'en-US');

const apiMessages = new Map<string, `error.${keyof typeof en.error}`>(
  (Object.keys(en.error) as Array<keyof typeof en.error>).map((key) => [
    en.error[key],
    `error.${key}` as const,
  ]),
);

export function message(value: string | null | undefined): string {
  if (!value) return '';

  const key = apiMessages.get(value);

  if (key) return i18n.t(key);

  const http = /^node returned HTTP (\d+)$/.exec(value);

  if (http) return i18n.t('error.http', { code: http[1] });

  const rpc = /^RPC (\w+) failed \(code (-?\d+)\)$/.exec(value);

  if (rpc) return i18n.t('error.rpcCode', { method: rpc[1], code: rpc[2] });

  return value;
}
