import { describe, expect, it } from 'vitest';
import { difficultyPeriod } from './difficulty';

describe('difficulty period', () => {
  it('starts a new period at each retarget height, including genesis', () => {
    for (const height of [0, 2016, 4032, 899136]) {
      expect(difficultyPeriod('main', height)).toMatchObject({
        startHeight: height,
        nextHeight: height + 2016,
        elapsed: 0,
        remaining: 2016,
        percent: 0,
      });
    }
  });

  it('keeps the adjustment one block away until the retarget block arrives', () => {
    const period = difficultyPeriod('main', 4031)!;
    expect(period.nextHeight).toBe(4032);
    expect(period.elapsed).toBe(2015);
    expect(period.remaining).toBe(1);
    expect(period.percent).toBeCloseTo(99.9503968);
  });

  it('supports retargeting networks and rejects regtest or unknown networks', () => {
    for (const network of ['main', 'test', 'testnet4', 'signet']) {
      expect(difficultyPeriod(network, 900123)).toMatchObject({
        startHeight: 899136,
        nextHeight: 901152,
        elapsed: 987,
        remaining: 1029,
      });
    }

    expect(difficultyPeriod('regtest', 900123)).toBeNull();
    expect(difficultyPeriod('unknown', 900123)).toBeNull();
  });

  it('does not fabricate progress for invalid or unsafe heights', () => {
    for (const height of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
      expect(difficultyPeriod('main', height)).toBeNull();
    }
  });
});
