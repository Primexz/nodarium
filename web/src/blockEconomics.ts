import type { Block } from './types';

function satoshis(value: string | null | undefined) {
  return value != null && /^\d+$/.test(value) ? BigInt(value) : null;
}

export function availableReward(block: Block): string | null {
  const subsidy = satoshis(block.subsidy_sats);
  const fees = satoshis(block.total_fees_sats);

  return subsidy == null || fees == null ? null : (subsidy + fees).toString();
}

// Charts use floating point; exact amounts remain strings in their data tables.
// Refuse unsafe conversion rather than plotting a fabricated precise value.
export function chartBitcoin(value: string | null | undefined): number | null {
  const amount = satoshis(value);

  return amount == null || amount > BigInt(Number.MAX_SAFE_INTEGER)
    ? null
    : Number(amount) / 100_000_000;
}

export function feeShare(block: Block): number | null {
  const reward = chartBitcoin(availableReward(block));
  const fees = chartBitcoin(block.total_fees_sats);

  return reward == null || reward === 0 || fees == null ? null : (fees / reward) * 100;
}

export function rewardComplete(block: Block) {
  return chartBitcoin(availableReward(block)) != null;
}
