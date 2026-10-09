const interval = 2016;
const retargetingNetworks = new Set(['main', 'test', 'testnet4', 'signet']);

// Core retargets at heights divisible by the interval. The new period starts
// at that height, so progress measures blocks since the adjustment (not an
// inclusive count of blocks). See Bitcoin Core src/pow.cpp and chainparams.cpp.
export function difficultyPeriod(network: string, height: number) {
  if (!retargetingNetworks.has(network) || !Number.isSafeInteger(height) || height < 0) {
    return null;
  }

  const startHeight = Math.floor(height / interval) * interval;
  const nextHeight = startHeight + interval;

  if (!Number.isSafeInteger(nextHeight)) return null;

  const elapsed = height - startHeight;

  return {
    interval,
    startHeight,
    nextHeight,
    elapsed,
    remaining: nextHeight - height,
    percent: (elapsed / interval) * 100,
  };
}
