const initialSubsidy = 5_000_000_000n;
const intervals: Record<string, number> = {
  main: 210_000,
  test: 210_000,
  testnet4: 210_000,
  signet: 210_000,
  regtest: 150,
};

// Match Core's integer-satoshi right shifts. Only 33 epochs have a nonzero
// subsidy; later heights must not restart the schedule or mint fractions of a sat.
// Source: Bitcoin Core src/validation.cpp:GetBlockSubsidy and kernel/chainparams.cpp.
export function halvingSchedule(network: string, height: number) {
  const interval = Object.hasOwn(intervals, network) ? intervals[network] : undefined;

  if (!interval || !Number.isSafeInteger(height) || height < 0) return null;

  let issued = 0n;
  let limit = 0n;
  const epochs = Array.from({ length: 33 }, (_, index) => {
    const subsidy = initialSubsidy >> BigInt(index);
    const startHeight = index * interval;
    const endHeight = startHeight + interval - 1;
    const blocks = height >= endHeight ? interval : Math.max(0, height - startHeight + 1);
    issued += subsidy * BigInt(blocks);
    limit += subsidy * BigInt(interval);

    return { epoch: index + 1, startHeight, endHeight, subsidySats: subsidy.toString() };
  });

  const index = Math.floor(height / interval);
  const current = epochs[index];
  const nextHeight = current ? current.endHeight + 1 : null;
  const elapsed = current ? height - current.startHeight : interval;

  return {
    interval,
    epochs,
    epoch: current?.epoch ?? null,
    subsidySats: current?.subsidySats ?? '0',
    nextSubsidySats: epochs[index + 1]?.subsidySats ?? '0',
    nextHeight,
    remainingBlocks: nextHeight === null ? 0 : nextHeight - height,
    elapsed,
    percent: (elapsed / interval) * 100,
    issuedSats: issued.toString(),
    remainingSats: (limit - issued).toString(),
    limitSats: limit.toString(),
    issuedPercent: (Number(issued) / Number(limit)) * 100,
  };
}

// Use the observation time, never the browser clock, so stale readings retain
// their original estimate. Regtest blocks are mined on demand, with no ETA.
export function halvingTime(
  network: string,
  height: number,
  observedAt: string | null | undefined,
) {
  const schedule = halvingSchedule(network, height);

  if (!schedule?.nextHeight || network === 'regtest' || !observedAt) return null;

  const estimate = Date.parse(observedAt) + schedule.remainingBlocks * 600_000;

  return Number.isFinite(new Date(estimate).getTime()) ? estimate : null;
}
