import { describe, expect, it } from 'vitest';
import type { Block } from './types';
import { availableReward, chartBitcoin, feeShare, rewardComplete } from './blockEconomics';

function block(subsidy: string | null, fees: string | null): Block {
  return { subsidy_sats: subsidy, total_fees_sats: fees } as Block;
}

describe('block economics', () => {
  it('uses each block’s subsidy across a halving and computes the fee share', () => {
    expect(availableReward(block('625000000', '25000000'))).toBe('650000000');
    expect(availableReward(block('312500000', '25000000'))).toBe('337500000');
    expect(feeShare(block('312500000', '25000000'))).toBeCloseTo(7.4074074);
  });

  it('preserves real zero and distinguishes unavailable or undefined percentages', () => {
    expect(rewardComplete(block('0', '0'))).toBe(true);
    expect(chartBitcoin('0')).toBe(0);
    expect(feeShare(block('312500000', '0'))).toBe(0);
    expect(feeShare(block('0', '100'))).toBe(100);
    expect(feeShare(block('0', '0'))).toBeNull();
    expect(availableReward(block(null, '100'))).toBeNull();
    expect(rewardComplete(block('100', null))).toBe(false);
    expect(feeShare(block('100', null))).toBeNull();
  });

  it('keeps exact amounts while refusing unsafe or malformed chart values', () => {
    expect(availableReward(block('9007199254740991', '2'))).toBe('9007199254740993');
    expect(rewardComplete(block('9007199254740991', '2'))).toBe(false);
    expect(chartBitcoin('9007199254740993')).toBeNull();

    for (const value of ['-1', '1.5', '', 'NaN']) {
      expect(availableReward(block(value, '0'))).toBeNull();
      expect(chartBitcoin(value)).toBeNull();
    }
  });
});
