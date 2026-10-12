const flags = import.meta.glob<string>('../node_modules/flag-icons/flags/4x3/*.svg', {
  eager: true,
  query: '?url&no-inline',
  import: 'default',
});

export function countryFlagSource(code?: string | null) {
  const normalized = code?.trim().toLowerCase();

  return normalized && /^[a-z]{2}$/.test(normalized)
    ? flags[`../node_modules/flag-icons/flags/4x3/${normalized}.svg`]
    : undefined;
}
