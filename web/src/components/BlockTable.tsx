import { Fragment, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown } from 'lucide-react';
import type { Block } from '../types';
import { number, shortHash, dateTime, bitcoinAmount, bytes, decimal } from '../format';
import { Empty } from './ui';
import BlockGoggles from './BlockGoggles';

export function BlockDetails({ block, stale }: { block: Block; stale: boolean }) {
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
      <BlockGoggles key={block.hash} hash={block.hash} />
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
    if (hash && !blocks.some((b) => b.hash === hash)) setHash(null);
  }, [blocks, hash, setHash]);

  return (
    <section className="block-sequence">
      <div className="block-sequence-heading">
        <h2>{t('nav.blocks')}</h2>
        <span>{t('blocks.expandHint')}</span>
      </div>
      <div className="block-strip" role="group" aria-label={t('blocks.strip')}>
        {blocks.map((block, i) => (
          <button
            key={block.hash}
            aria-pressed={selected?.hash === block.hash}
            aria-label={t('blocks.inspect', { height: number(block.height) })}
            onClick={() => setHash(selected?.hash === block.hash ? null : block.hash)}
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
              {i === 0
                ? t('blocks.tip')
                : dateTime(block.time * 1000)
                    .split(',')
                    .at(-1)
                    ?.trim()}
            </span>
            <span
              className="strip-weight"
              style={{ width: `${Math.min(100, Math.max(0, block.capacity_percent ?? 0))}%` }}
            />
          </button>
        ))}
      </div>
      {selected && !onSelect && <BlockDetails block={selected} stale={stale} />}
    </section>
  );
}

export default function BlockTable({
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
  const expanded = blocks.some((b) => b.hash === hash) ? hash : null;

  useEffect(() => {
    if (hash && !blocks.some((b) => b.hash === hash)) setHash(null);
  }, [blocks, hash, setHash]);

  return (
    <>
      <div className="table-scroll block-table-scroll">
        <table className="blocks-table">
          <thead>
            <tr>
              {(
                [
                  'heightColumn',
                  'hash',
                  'timestamp',
                  'transactions',
                  'totalAmount',
                  'confirmations',
                ] as const
              ).map((key) => (
                <th key={key}>{t(`blocks.${key}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {blocks.map((block) => (
              <Fragment key={block.hash}>
                <tr className={`block-summary-row ${expanded === block.hash ? 'expanded' : ''}`}>
                  <td>
                    <button
                      className="block-toggle"
                      aria-expanded={expanded === block.hash}
                      aria-controls={`block-details-${block.hash}`}
                      aria-label={t(expanded === block.hash ? 'blocks.collapse' : 'blocks.expand', {
                        height: number(block.height),
                      })}
                      onClick={() => setHash(expanded === block.hash ? null : block.hash)}
                    >
                      <strong>{number(block.height)}</strong>
                      <ChevronDown size={14} />
                    </button>
                  </td>
                  <td className="mono" title={block.hash}>
                    {shortHash(block.hash)}
                  </td>
                  <td>{dateTime(block.time * 1000)}</td>
                  <td
                    className="block-number"
                    title={t(
                      block.transaction_count == null
                        ? 'blocks.countUnavailableDescription'
                        : 'blocks.transactionsDescription',
                    )}
                  >
                    {number(block.transaction_count)}
                  </td>
                  <td className="block-number">
                    {block.total_transaction_amount_sats != null ? (
                      <details className="block-amount">
                        <summary
                          aria-label={t('blocks.showExactAmount', {
                            amount: bitcoinAmount(block.total_transaction_amount_sats, 8),
                          })}
                        >
                          {bitcoinAmount(block.total_transaction_amount_sats)}
                        </summary>
                        <small>{bitcoinAmount(block.total_transaction_amount_sats, 8)}</small>
                      </details>
                    ) : (
                      <span className="muted" title={t('blocks.amountUnavailableDescription')}>
                        {t('blocks.amountUnavailable')}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="confirmation">
                      <Check size={13} />
                      {number(block.confirmations)}
                    </span>
                  </td>
                </tr>
                {expanded === block.hash && (
                  <tr className="block-detail-row">
                    <td colSpan={6}>
                      <BlockDetails block={block} stale={stale} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {!blocks.length && (
        <Empty title={t('blocks.empty')} description={t('blocks.emptyDescription')} />
      )}
    </>
  );
}
