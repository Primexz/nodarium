import { describe, expect, it } from 'vitest';
import { difficultyAdjustmentTime, difficultyPeriod } from './difficulty';

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

describe('difficulty adjustment time', () => {
  const observedAt = '2026-10-09T12:00:00Z';

  it('uses remaining blocks and advances the date at a period boundary', () => {
    expect(difficultyAdjustmentTime('main', 900123, observedAt)).toBe(
      Date.parse('2026-10-16T15:30:00Z'),
    );

    expect(difficultyAdjustmentTime('main', 901151, observedAt)).toBe(
      Date.parse('2026-10-09T12:10:00Z'),
    );

    expect(difficultyAdjustmentTime('main', 901152, observedAt)).toBe(
      Date.parse('2026-10-23T12:00:00Z'),
    );
  });

  it('does not invent dates for unsupported networks, bad heights or missing timestamps', () => {
    expect(difficultyAdjustmentTime('regtest', 900123, observedAt)).toBeNull();
    expect(difficultyAdjustmentTime('unknown', 900123, observedAt)).toBeNull();
    expect(difficultyAdjustmentTime('main', -1, observedAt)).toBeNull();

    for (const timestamp of [null, undefined, '', 'invalid', '+275760-09-13T00:00:00Z']) {
      expect(difficultyAdjustmentTime('main', 900123, timestamp)).toBeNull();
    }
  });
});
