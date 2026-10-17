import { describe, expect, it } from 'vitest';
import { halvingSchedule, halvingTime } from './halving';

describe('subsidy schedule', () => {
  it.each([
    [0, '5000000000', '5000000000', 210000, 1],
    [209999, '5000000000', '1050000000000000', 210000, 1],
    [210000, '2500000000', '1050002500000000', 420000, 2],
    [630000, '625000000', '1837500625000000', 840000, 4],
    [839999, '625000000', '1968750000000000', 840000, 4],
    [840000, '312500000', '1968750312500000', 1050000, 5],
    [900123, '312500000', '1987538750000000', 1050000, 5],
  ])(
    'uses the subsidy allowed at height %i, including that block',
    (height, subsidy, issued, next, epoch) => {
      const schedule = halvingSchedule('main', height)!;
      expect(schedule.subsidySats).toBe(subsidy);
      expect(schedule.issuedSats).toBe(issued);
      expect(schedule.nextHeight).toBe(next);
      expect(schedule.remainingBlocks).toBe(next - height);
      expect(schedule.epoch).toBe(epoch);
      expect(BigInt(schedule.issuedSats) + BigInt(schedule.remainingSats)).toBe(2099999997690000n);
    },
  );

  it('resets epoch progress when a halving block arrives or is reorganized away', () => {
    expect(halvingSchedule('main', 840000)).toMatchObject({
      elapsed: 0,
      percent: 0,
      remainingBlocks: 210000,
      nextSubsidySats: '156250000',
    });

    expect(halvingSchedule('main', 839999)).toMatchObject({
      elapsed: 209999,
      remainingBlocks: 1,
      nextSubsidySats: '312500000',
    });
  });

  it('rounds each subsidy down to whole satoshis and ends issuance permanently', () => {
    const last = halvingSchedule('main', 6929998)!;
    expect(last.epochs).toHaveLength(33);
    expect(last.epochs[10].subsidySats).toBe('4882812');
    expect(last.epochs[32]).toEqual({
      epoch: 33,
      startHeight: 6720000,
      endHeight: 6929999,
      subsidySats: '1',
    });

    expect(last.remainingSats).toBe('1');
    expect(last.nextSubsidySats).toBe('0');
    expect(halvingSchedule('main', 6929999)?.remainingSats).toBe('0');

    for (const height of [6930000, 13440000, Number.MAX_SAFE_INTEGER]) {
      expect(halvingSchedule('main', height)).toMatchObject({
        epoch: null,
        subsidySats: '0',
        nextSubsidySats: '0',
        nextHeight: null,
        remainingBlocks: 0,
        issuedSats: '2099999997690000',
        remainingSats: '0',
        issuedPercent: 100,
      });
    }
  });

  it('uses the standard public-network schedule and the 150-block regtest schedule', () => {
    for (const network of ['main', 'test', 'testnet4', 'signet']) {
      expect(halvingSchedule(network, 900123)).toEqual(halvingSchedule('main', 900123));
    }

    expect(halvingSchedule('regtest', 149)).toMatchObject({
      interval: 150,
      subsidySats: '5000000000',
      issuedSats: '750000000000',
      remainingBlocks: 1,
      limitSats: '1499999998350',
    });

    expect(halvingSchedule('regtest', 150)).toMatchObject({
      epoch: 2,
      subsidySats: '2500000000',
      issuedSats: '752500000000',
      nextHeight: 300,
      elapsed: 0,
    });

    expect(halvingSchedule('regtest', 4950)?.remainingSats).toBe('0');
  });

  it('does not invent a schedule for unsupported networks or invalid heights', () => {
    for (const network of ['unknown', '', 'constructor', '__proto__']) {
      expect(halvingSchedule(network, 100)).toBeNull();
    }

    for (const height of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(halvingSchedule('main', height)).toBeNull();
    }
  });
});

describe('halving date estimate', () => {
  const observedAt = '2026-10-09T12:00:00Z';

  it('anchors the remaining-block estimate to the node observation', () => {
    expect(halvingTime('main', 900123, observedAt)).toBe(Date.parse('2029-08-15T07:30:00Z'));
    expect(halvingTime('main', 1049999, observedAt)).toBe(Date.parse('2026-10-09T12:10:00Z'));
    expect(halvingTime('main', 1050000, observedAt)).toBe(Date.parse('2030-10-06T20:00:00Z'));
  });

  it('omits estimates for regtest, completed schedules and unavailable observations', () => {
    expect(halvingTime('regtest', 149, observedAt)).toBeNull();
    expect(halvingTime('unknown', 149, observedAt)).toBeNull();
    expect(halvingTime('main', -1, observedAt)).toBeNull();
    expect(halvingTime('main', 6930000, observedAt)).toBeNull();

    for (const timestamp of [null, undefined, '', 'invalid', '+275760-09-13T00:00:00Z']) {
      expect(halvingTime('main', 900123, timestamp)).toBeNull();
    }
  });
});
