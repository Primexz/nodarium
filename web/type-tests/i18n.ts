// Compiled by tsc during the build; never imported into the application.
import type { TFunction } from 'i18next';
import type { UseTranslationResponse } from 'react-i18next';
import type { Translations } from '../src/locales/schema';
import en from '../src/locales/en';

declare const t: TFunction;
declare const reactT: UseTranslationResponse<'translation', undefined>['t'];

t('nav.peers');
reactT('blocks.inspect', { height: '900,000' });
t('tables.rows', { count: 2, total: '2' });
t('metrics.headers', { total: '900,000' });

// @ts-expect-error Unknown keys must fail even when a fallback is provided.
t('nav.missing', { defaultValue: 'Fallback' });
// @ts-expect-error React hooks must receive the same key checks as i18next.
reactT('blocks.missing');
// @ts-expect-error Misspelled interpolation arguments must be rejected.
reactT('blocks.inspect', { heigth: '900,000' });
// @ts-expect-error Plural counts are numbers, not formatted display strings.
t('tables.rows', { count: '2', total: '2' });
// @ts-expect-error Display interpolation retains its expected string type.
t('metrics.headers', { total: 900000 });

declare function localeNavigation(value: Translations['nav']): void;

localeNavigation(en.nav);
// @ts-expect-error All canonical keys must be supplied by other locales.
localeNavigation({ overview: 'Übersicht' });
// @ts-expect-error Extra keys must not silently diverge between locales.
localeNavigation({ ...en.nav, missing: 'Unbekannt' });
// @ts-expect-error Translation leaves must remain strings.
localeNavigation({ ...en.nav, peers: 123 });
