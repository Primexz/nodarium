import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { Block, PoolAttribution } from '../types';
import { number, dateTime, bitcoinAmount, bytes, decimal } from '../format';
import BlockGoggles from './BlockGoggles';
import { BlockPool } from './MiningPools';

export function BlockDetails({
  block,
  stale,
}: {
  block: Block & { pool?: PoolAttribution };
  stale: boolean;
}) {
  const { t } = useTranslation();
  const partial = [
    block.transaction_count,
    block.total_fees_sats,
    block.size_bytes,
    block.weight_units,
    block.capacity_percent,
  ].some((v) => v == null);

  return (
    <section
      id={`block-details-${block.hash}`}
      className="block-details"
      aria-label={t('blocks.detailsTitle', { height: number(block.height) })}
    >
      <div className="block-detail-heading">
        <h3>{t('blocks.detailsTitle', { height: number(block.height) })}</h3>
        <span className="mono block-full-hash">{block.hash}</span>
      </div>
      {stale && (
        <p className="block-detail-notice" role="status">
          {t('blocks.detailsStale')}
        </p>
      )}
      {partial && (
        <p className="block-detail-notice" role="status">
          {t('blocks.detailsUnavailable')}
        </p>
      )}
      <dl className="block-detail-metrics">
        <div>
          <dt>{t('blocks.transactions')}</dt>
          <dd>
            <span>{number(block.transaction_count)}</span>
            <small>{t('blocks.includesCoinbase')}</small>
          </dd>
        </div>
        <div>
          <dt>{t('blocks.totalFees')}</dt>
          <dd>
            <span>{bitcoinAmount(block.total_fees_sats, 8)}</span>
            <small>{t('blocks.feesDescription')}</small>
          </dd>
        </div>
        <div>
          <dt>{t('blocks.size')}</dt>
          <dd>
            <span>{bytes(block.size_bytes)}</span>
            <small>
              {block.size_bytes == null
                ? t('blocks.amountUnavailable')
                : t('blocks.exactBytes', { value: number(block.size_bytes) })}
            </small>
          </dd>
        </div>
        <div>
          <dt>{t('blocks.weight')}</dt>
          <dd>
            <span>
              {block.weight_units == null
                ? '—'
                : t('blocks.weightValue', { value: number(block.weight_units) })}
            </span>
            <small>{t('blocks.weightDescription')}</small>
          </dd>
        </div>
        <div>
          <dt>{t('blocks.capacity')}</dt>
          <dd>
            <span>
              {block.capacity_percent == null ? '—' : `${decimal(block.capacity_percent)}%`}
            </span>
            {block.capacity_percent != null && (
              <div
                className="block-capacity-track"
                role="meter"
                aria-label={t('blocks.capacity')}
                aria-valuenow={block.capacity_percent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <span style={{ width: `${Math.min(100, Math.max(0, block.capacity_percent))}%` }} />
              </div>
            )}
            <small>{t('blocks.capacityDescription', { limit: number(4000000) })}</small>
          </dd>
        </div>
      </dl>
      {block.pool && <BlockPool attribution={block.pool} />}
      <BlockGoggles key={block.hash} hash={block.hash} showPool={!block.pool} />
    </section>
  );
}

export function BlockStrip({
  blocks,
  stale,
  selectedHash,
  onSelect,
}: {
  blocks: Block[];
  stale: boolean;
  selectedHash?: string | null;
  onSelect?: (hash: string | null) => void;
}) {
  const { t } = useTranslation();
  const [ownHash, setOwnHash] = useState<string | null>(null);
  const hash = selectedHash === undefined ? ownHash : selectedHash;
  const setHash = onSelect ?? setOwnHash;
  const selected = blocks.find((b) => b.hash === hash);

  useEffect(() => {
    if (!onSelect && hash && !blocks.some((b) => b.hash === hash)) setHash(null);
  }, [blocks, hash, setHash, onSelect]);

  return (
    <section className="block-sequence">
      <div className="block-sequence-heading">
        <h2>{t('blockEconomics.recent')}</h2>
        <span>{t('blocks.expandHint')}</span>
      </div>
      <div className="block-strip" role="group" aria-label={t('blocks.strip')}>
        {blocks.map((block, i) => (
          <BlockTile
            key={block.hash}
            block={block}
            tip={i === 0}
            selected={selected?.hash === block.hash}
            onSelect={() => setHash(selected?.hash === block.hash ? null : block.hash)}
          />
        ))}
      </div>
      {selected && !onSelect && <BlockDetails block={selected} stale={stale} />}
    </section>
  );
}

export function BlockTile({
  block,
  tip,
  selected,
  onSelect,
  fullTime = false,
}: {
  block: Block;
  tip: boolean;
  selected: boolean;
  onSelect: () => void;
  fullTime?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <button
      aria-pressed={selected}
      aria-label={t('blocks.inspect', { height: number(block.height) })}
      onClick={onSelect}
    >
      <span className="block-tile-top" aria-hidden />
      <span className="block-tile-side" aria-hidden />
      <span className="strip-height">{number(block.height)}</span>
      <span className="strip-fee">
        {block.median_fee_rate == null ? '—' : `${decimal(block.median_fee_rate)} sat/vB`}
      </span>
      <span className="strip-label">{t('blocks.medianFee')}</span>
      <span className="strip-reading">{bytes(block.size_bytes)}</span>
      <span className="strip-reading">
        {block.transaction_count == null
          ? '—'
          : t('blocks.tileTransactions', { total: number(block.transaction_count) })}
      </span>
      <span className="strip-time">
        {tip
          ? t('blocks.tip')
          : fullTime
            ? dateTime(block.time * 1000)
            : dateTime(block.time * 1000)
                .split(',')
                .at(-1)
                ?.trim()}
      </span>
      <span
        className="strip-weight"
        aria-hidden
        style={{ width: `${Math.min(100, Math.max(0, block.capacity_percent ?? 0))}%` }}
      />
    </button>
  );
}
