import { i18n, intlLocale } from './i18n';
import type { MapNode, MapPeer } from './types';

const t = i18n.t.bind(i18n);

export const mapColors = { inbound: '#91c8bc', outbound: '#f7931a', node: '#f4dda8' };

export function connectionLines(peers: MapPeer[], node: MapNode | null) {
  if (!node) return [];

  return peers.flatMap((peer) =>
    peer.location
      ? [
          {
            peerID: peer.id,
            name: peer.address,
            coords: [
              [peer.location.longitude, peer.location.latitude],
              [node.longitude, node.latitude],
            ],
            lineStyle: { color: peer.inbound ? mapColors.inbound : mapColors.outbound },
          },
        ]
      : [],
  );
}

export function locationName(location: { city: string; country: string; country_code?: string }) {
  let country = location.country;

  if (location.country_code && /^[A-Z]{2}$/.test(location.country_code)) {
    country =
      new Intl.DisplayNames([intlLocale()], { type: 'region' }).of(location.country_code) ||
      country;
  }

  return [location.city, country].filter(Boolean).join(', ') || t('map.locationAvailable');
}

export function unlocatedReason(reason?: string) {
  return (
    (
      {
        non_ip: t('map.nonIp'),
        private_or_reserved: t('map.private'),
        not_found: t('map.notFound'),
        database_unavailable: t('map.databaseWaiting'),
        lookup_failed: t('map.lookupFailed'),
      } as Record<string, string>
    )[reason || ''] || t('map.locationUnavailable')
  );
}

export function countryName(countryCode: string | null, fallback: string) {
  return countryCode
    ? new Intl.DisplayNames([intlLocale()], { type: 'region' }).of(countryCode) || fallback
    : fallback;
}

export function countryDistribution(peers: MapPeer[]) {
  const groups = new Map<
    string,
    { key: string; countryCode: string | null; country: string; count: number }
  >();

  for (const peer of peers) {
    const code = peer.location?.country_code.trim().toUpperCase() ?? '';
    const countryCode = /^[A-Z]{2}$/.test(code) ? code : null;
    const country = peer.location?.country.trim() ?? '';
    const key = countryCode
      ? `code:${countryCode}`
      : country
        ? `name:${country.toLowerCase()}`
        : 'unknown';

    const group = groups.get(key);

    if (group) group.count++;
    else groups.set(key, { key, countryCode, country, count: 1 });
  }

  return [...groups.values()].sort(
    (a, b) =>
      Number(a.key === 'unknown') - Number(b.key === 'unknown') ||
      b.count - a.count ||
      a.key.localeCompare(b.key),
  );
}
