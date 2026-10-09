import { describe, expect, it } from 'vitest';
import { connectionLines, locationName, mapColors, countryDistribution, countryName } from './map';
import type { MapNode, MapPeer } from './types';

const node: MapNode = {
  ip: '1.1.1.1',
  label: 'My node',
  source: 'configured_ip',
  latitude: 50,
  longitude: 8,
  city: 'Frankfurt',
  country: 'Germany',
  country_code: 'DE',
};

const peers: MapPeer[] = [
  {
    id: 1,
    address: '8.8.8.8:8333',
    inbound: true,
    location: {
      latitude: 40,
      longitude: -74,
      city: 'New York',
      country: 'United States',
      country_code: 'US',
    },
  },
  {
    id: 2,
    address: '[2606:4700:4700::1111]:8333',
    inbound: false,
    location: { latitude: 0, longitude: 0, city: '', country: '', country_code: '' },
  },
  { id: 3, address: 'example.onion:8333', inbound: false, location: null, reason: 'non_ip' },
];

describe('peer map connections', () => {
  it('draws longitude/latitude paths from each located peer to the configured node', () => {
    const lines = connectionLines(peers, node);
    expect(lines).toHaveLength(2);
    expect(lines[0]?.coords).toEqual([
      [-74, 40],
      [8, 50],
    ]);

    expect(lines[0]?.lineStyle.color).toBe(mapColors.inbound);
    expect(lines[1]?.coords).toEqual([
      [0, 0],
      [8, 50],
    ]);

    expect(lines[1]?.lineStyle.color).toBe(mapColors.outbound);
  });

  it('never invents a node location or paths for unknown peers', () => {
    expect(connectionLines(peers, null)).toEqual([]);
    expect(connectionLines([], node)).toEqual([]);
    expect(connectionLines([peers[2]!], node)).toEqual([]);
  });

  it('handles partial city metadata without empty separators', () => {
    expect(locationName({ city: '', country: 'Germany' })).toBe('Germany');
    expect(locationName({ city: 'Frankfurt', country: 'Germany' })).toBe('Frankfurt, Germany');
  });
});

describe('peer countries', () => {
  it('counts connected peers rather than the configured node and retains unknown countries', () => {
    const groups = countryDistribution([...peers, { ...peers[0]!, id: 4 }]);
    expect(groups).toEqual([
      { key: 'code:US', countryCode: 'US', country: 'United States', count: 2 },
      { key: 'unknown', countryCode: null, country: '', count: 2 },
    ]);

    expect(groups.reduce((total, group) => total + group.count, 0)).toBe(4);
  });

  it('groups normalized country codes and preserves name-only metadata', () => {
    const location = peers[0]!.location!;
    expect(
      countryDistribution([
        peers[0]!,
        { ...peers[0]!, id: 4, location: { ...location, country_code: ' us ', country: 'USA' } },
        { ...peers[0]!, id: 5, location: { ...location, country_code: '', country: ' Canada ' } },
      ]).map((group) => [group.key, group.count]),
    ).toEqual([
      ['code:US', 2],
      ['name:canada', 1],
    ]);

    expect(countryName(null, 'Canada')).toBe('Canada');
    expect(countryDistribution([])).toEqual([]);
  });
});
