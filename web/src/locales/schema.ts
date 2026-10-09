import type en from './en';

// Keep every locale's keys aligned while allowing translated string values.
type TranslationShape<T> = {
  readonly [K in keyof T]: T[K] extends string ? string : TranslationShape<T[K]>;
};

export type Translations = TranslationShape<typeof en>;
