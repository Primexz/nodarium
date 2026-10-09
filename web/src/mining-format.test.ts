import { afterEach, expect, it } from 'vitest';
import { i18n, message } from './i18n';
import { compactNumber, hashrate } from './format';

afterEach(() => {
  void i18n.changeLanguage('en');
});

it('formats network rates with decimal SI units across small and large networks', () => {
  for (const [value, expected] of [
    [0, '0.00 H/s'],
    [1500, '1.50 kH/s'],
    [93.3e12, '93.30 TH/s'],
    [910e18, '910.00 EH/s'],
    [1.2e21, '1.20 ZH/s'],
  ] as const)
    expect(hashrate(value)).toBe(expected);

  expect(compactNumber(123.4e12)).toBe('123.40T');
  expect(hashrate(1.2e21, 910e18)).toBe('1200.00 EH/s');
  expect(hashrate(0, 910e18)).toBe('0.00 EH/s');

  for (const value of [null, undefined, -1, NaN, Infinity]) expect(hashrate(value)).toBe('—');
});

it('localizes rate, difficulty and unavailable-estimate diagnostics', () => {
  void i18n.changeLanguage('de');
  expect(hashrate(910e18)).toBe('910,00 EH/s');
  expect(compactNumber(123.4e12)).toBe('123,40T');
  expect(message('Network hashrate estimate is unavailable.')).toBe(
    'Die Netzwerk-Hashrate kann derzeit nicht geschätzt werden.',
  );

  expect(message('Network hashrate is unavailable while the node is syncing.')).toBe(
    'Die Netzwerk-Hashrate ist während der Synchronisierung des Nodes nicht verfügbar.',
  );
});
