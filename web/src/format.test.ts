import { describe, it, expect } from 'vitest';
import { bytes, duration, fee, number, bitcoinAmount } from './format';

describe('metric presentation', () => {
  it('distinguishes missing readings from actual zero', () => {
    expect(bytes(null)).toBe('—');
    expect(bytes(0)).toBe('0 B');
    expect(number(undefined)).toBe('—');
    expect(number(0)).toBe('0');
  });

  it('uses binary byte units and correct Bitcoin fee units', () => {
    expect(bytes(1048576)).toBe('1.00 MiB');
    expect(fee(0.00001)).toBe('1.00 sat/vB');
  });

  it('handles node uptime and future block timestamps', () => {
    expect(duration(90061)).toBe('1d 1h');
    expect(duration(-60)).toBe('0s');
  });
});

it('formats exact block output totals from integer satoshis', () => {
  expect(bitcoinAmount(null)).toBe('—');
  expect(bitcoinAmount('0')).toBe('0.00 BTC');
  expect(bitcoinAmount('1')).toBe('<0.01 BTC');
  expect(bitcoinAmount('123456789012')).toBe('1,234.57 BTC');
  expect(bitcoinAmount('9007199254740993')).toBe('90,071,992.55 BTC');
  expect(bitcoinAmount('-1')).toBe('—');
});

it('rounds compact BTC amounts exactly and retains full precision on demand', () => {
  expect(bitcoinAmount('1402424899372')).toBe('14,024.25 BTC');
  expect(bitcoinAmount('99999999999')).toBe('1,000.00 BTC');
  expect(bitcoinAmount('100499999')).toBe('1.00 BTC');
  expect(bitcoinAmount('100500000')).toBe('1.01 BTC');
  expect(bitcoinAmount('999999')).toBe('<0.01 BTC');
  expect(bitcoinAmount('1000000')).toBe('0.01 BTC');
  expect(bitcoinAmount('9007199254740993', 8)).toBe('90,071,992.54740993 BTC');
  expect(bitcoinAmount('1', 8)).toBe('0.00000001 BTC');
});
