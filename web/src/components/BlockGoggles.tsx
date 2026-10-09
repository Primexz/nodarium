import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { ECElementEvent } from 'echarts/core';
import { api, APIError } from '../api';
import type { BlockTransactions, BlockTransaction, TransactionDetails } from '../types';
import { bitcoinAmount, bytes, decimal, number, shortHash } from '../format';
import { useTheme } from '../theme';
import { Notice, Empty } from './ui';
import { useChart, chartPalette } from './useChart';
import { BlockPool } from './MiningPools';

import VirtualTable from './VirtualTable';

const transactionKey = (tx: BlockTransaction) => tx.txid;

function rate(tx: BlockTransaction, coinbaseLabel: string) {
  return tx.coinbase ? coinbaseLabel : tx.fee_rate == null ? '—' : `${decimal(tx.fee_rate)} sat/vB`;
}

function TransactionPanel({
  hash,
  txid,
  onClose,
}: {
  hash: string;
  txid: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [inputCount, setInputCount] = useState(10);
  const [outputCount, setOutputCount] = useState(10);
  const query = useQuery({
    queryKey: ['explorer', 'transaction', hash, txid],
    queryFn: ({ signal }) =>
      api<TransactionDetails>(`blocks/${hash}/transactions/${txid}`, { signal }),
    staleTime: 60000,
  });

  const panel = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const previous = document.activeElement;
    const current = panel.current;
    current?.focus({ preventScroll: true });
    current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });

    return () => {
      if (
        current?.contains(document.activeElement) &&
        previous instanceof HTMLElement &&
        previous.isConnected
      ) {
        previous.focus({ preventScroll: true });
      }
    };
  }, []);

  const tx = query.data;
  const inactive = query.error instanceof APIError && query.error.status === 409;

  return (
    <section
      ref={panel}
      tabIndex={-1}
      className="transaction-panel"
      aria-label={t('goggles.details')}
    >
      <div className="block-detail-heading">
        <h3>{t('goggles.details')}</h3>
        <button className="icon-button" aria-label={t('goggles.close')} onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <p className="mono transaction-id">{txid}</p>
      {query.isPending && <Notice>{t('goggles.loadingTransaction')}</Notice>}
      {query.isError && (
        <Notice error>
          {t(
            inactive
              ? 'goggles.inactive'
              : tx
                ? 'goggles.transactionStale'
                : 'goggles.transactionError',
          )}
          {!inactive && <button onClick={() => void query.refetch()}>{t('common.retry')}</button>}
        </Notice>
      )}
      {tx && !inactive && (
        <>
          <dl className="transaction-metrics">
            {[
              [t('goggles.vsize'), `${number(tx.vsize)} vB`],
              [t('goggles.size'), bytes(tx.size)],
              [t('goggles.weight'), t('blocks.weightValue', { value: number(tx.weight) })],
              [
                t('goggles.fee'),
                tx.coinbase ? t('goggles.coinbase') : bitcoinAmount(tx.fee_sats, 8),
              ],
              [t('goggles.feeRate'), rate(tx, t('goggles.coinbase'))],
              [t('goggles.totalOutput'), bitcoinAmount(tx.output_sats, 8)],
              [t('blocks.confirmations'), number(tx.confirmations)],
              [t('goggles.version'), number(tx.version)],
              [t('goggles.locktime'), number(tx.locktime)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="transaction-note">{t('goggles.outputNote')}</p>
          {!tx.coinbase &&
            (tx.fee_sats == null || tx.inputs.some((input) => input.value_sats == null)) && (
              <p className="transaction-note">{t('goggles.prevoutsUnavailable')}</p>
            )}
          <div className="transaction-io">
            <section>
              <h4>
                {t('goggles.inputs')} <span>{number(tx.input_count)}</span>
              </h4>
              <ol className="io-list">
                {tx.inputs.slice(0, inputCount).map((input, i) => (
                  <li key={i}>
                    <strong>
                      {input.coinbase
                        ? t('goggles.coinbaseInput')
                        : bitcoinAmount(input.value_sats, 8)}
                    </strong>
                    {!input.coinbase && (
                      <>
                        <span className="mono">
                          {input.address || t('goggles.addressUnavailable')}
                        </span>
                        <span className="mono input-reference">
                          {input.txid}:{input.vout}
                        </span>
                        {input.script_type && <small>{input.script_type}</small>}
                      </>
                    )}
                  </li>
                ))}
              </ol>
              {inputCount < tx.inputs.length && (
                <button onClick={() => setInputCount(inputCount + 50)}>
                  {t('goggles.showMore')}
                </button>
              )}
            </section>
            <section>
              <h4>
                {t('goggles.outputs')} <span>{number(tx.output_count)}</span>
              </h4>
              <ol className="io-list">
                {tx.outputs.slice(0, outputCount).map((output) => (
                  <li key={output.index}>
                    <strong>{bitcoinAmount(output.value_sats, 8)}</strong>
                    <span className="mono">
                      {output.address ||
                        t(
                          output.script_type === 'nulldata'
                            ? 'goggles.dataOutput'
                            : 'goggles.noAddress',
                        )}
                    </span>
                    <small>
                      {t('goggles.outputIndex', { index: number(output.index) })} ·{' '}
                      {output.script_type || '—'}
                    </small>
                  </li>
                ))}
              </ol>
              {outputCount < tx.outputs.length && (
                <button onClick={() => setOutputCount(outputCount + 50)}>
                  {t('goggles.showMore')}
                </button>
              )}
            </section>
          </div>
          <details className="transaction-identifiers">
            <summary>{t('goggles.identifiers')}</summary>
            <dl>
              <div>
                <dt>{t('goggles.wtxid')}</dt>
                <dd className="mono">{tx.wtxid}</dd>
              </div>
              <div>
                <dt>{t('blocks.hash')}</dt>
                <dd className="mono">{tx.block_hash}</dd>
              </div>
            </dl>
          </details>
        </>
      )}
    </section>
  );
}

function Mosaic({
  transactions,
  selected,
  onSelect,
}: {
  transactions: BlockTransaction[];
  selected: string | null;
  onSelect: (txid: string) => void;
}) {
  const { t } = useTranslation();
  const { effective } = useTheme();
  const palette = useMemo(() => chartPalette(effective === 'dark'), [effective]);
  const options = useMemo(
    () => ({
      animation: false,
      backgroundColor: palette.ground,
      tooltip: {
        renderMode: 'richText',
        confine: true,
        formatter: (params: { data?: { tx?: BlockTransaction } }) => {
          const tx = params.data?.tx;

          return tx
            ? `${shortHash(tx.txid)}\n${number(tx.vsize)} vB · ${rate(tx, t('goggles.coinbase'))}`
            : '';
        },
      },
      series: [
        {
          type: 'treemap',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          label: { show: false },
          upperLabel: { show: false },
          silent: false,
          squareRatio: 1,
          visibleMin: 0,
          itemStyle: { borderWidth: 1, gapWidth: 0, borderColor: palette.ground },
          emphasis: { itemStyle: { borderColor: palette.ink, borderWidth: 3 } },
          data: transactions.map((tx) => ({
            name: tx.txid,
            value: tx.vsize,
            tx,
            itemStyle: {
              color: tx.coinbase
                ? palette.series[1]
                : tx.fee_rate == null
                  ? palette.land
                  : tx.fee_rate < 5
                    ? palette.series[3]
                    : tx.fee_rate < 20
                      ? palette.series[0]
                      : palette.series[2],
              borderColor: tx.txid === selected ? palette.ink : palette.ground,
              borderWidth: tx.txid === selected ? 3 : 1,
            },
          })),
        },
      ],
    }),
    [transactions, selected, t, palette],
  );

  const { element, instance } = useChart(options);

  useEffect(() => {
    const chart = instance.current;
    const click = (params: ECElementEvent) => {
      const data = params.data as { tx?: BlockTransaction } | undefined;

      if (data?.tx) onSelect(data.tx.txid);
    };

    chart?.on('click', click);

    return () => {
      chart?.off('click', click);
    };
  }, [instance, onSelect]);

  return (
    <div
      ref={element}
      className="transaction-mosaic"
      role="img"
      aria-label={t('goggles.accessible', { count: number(transactions.length) })}
    />
  );
}

export default function BlockGoggles({ hash }: { hash: string }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['explorer', 'block', hash],
    queryFn: ({ signal }) => api<BlockTransactions>(`blocks/${hash}/transactions`, { signal }),
    refetchInterval: 10000,
  });

  const data = query.data;
  const transactions = data?.transactions ?? [];
  const inactive = query.error instanceof APIError && query.error.status === 409;
  const { effective } = useTheme();
  const palette = useMemo(() => chartPalette(effective === 'dark'), [effective]);

  return (
    <section className="block-goggles" aria-label={t('goggles.title')}>
      <div className="goggles-heading">
        <h3>{t('goggles.title')}</h3>
        <span>{data ? t('goggles.count', { count: number(transactions.length) }) : ''}</span>
      </div>
      <p className="goggles-description">{t('goggles.description')}</p>
      {query.isPending && <Notice>{t('goggles.loading')}</Notice>}
      {query.isError && (
        <Notice error>
          {t(inactive ? 'goggles.inactive' : data ? 'goggles.stale' : 'goggles.error')}
          <button onClick={() => void query.refetch()}>{t('common.retry')}</button>
        </Notice>
      )}
      {data &&
        !inactive &&
        (transactions.length ? (
          <>
            <BlockPool attribution={data.mining_pool} />
            <Mosaic transactions={transactions} selected={selected} onSelect={setSelected} />
            <ul className="mosaic-legend" aria-label={t('goggles.colors')}>
              {[
                [palette.series[3], t('goggles.lowFee')],
                [palette.series[0], t('goggles.mediumFee')],
                [palette.series[2], t('goggles.highFee')],
                [palette.series[1], t('goggles.coinbase')],
                [palette.land, t('goggles.unknownFee')],
              ].map(([color, label]) => (
                <li key={label}>
                  <span style={{ backgroundColor: color }} aria-hidden />
                  {label}
                </li>
              ))}
            </ul>
            <p className="transaction-note">{t('goggles.choose')}</p>
            {selected && (
              <TransactionPanel
                key={selected}
                hash={hash}
                txid={selected}
                onClose={() => setSelected(null)}
              />
            )}
            <details className="goggles-table">
              <summary>{t('goggles.table')}</summary>
              <VirtualTable
                rows={transactions}
                rowKey={transactionKey}
                columns={4}
                label={t('goggles.table')}
                className="transactions-table"
                resetKey={hash}
                keepKey={selected}
                header={
                  <>
                    <th>{t('goggles.txid')}</th>
                    <th>{t('goggles.vsize')}</th>
                    <th>{t('goggles.feeRate')}</th>
                    <th>{t('goggles.totalOutput')}</th>
                  </>
                }
                renderRow={(tx) => (
                  <>
                    <td>
                      <button
                        className="transaction-select mono"
                        aria-label={t('goggles.inspect', { txid: tx.txid })}
                        aria-pressed={selected === tx.txid}
                        onClick={() => setSelected(tx.txid)}
                      >
                        {shortHash(tx.txid)}
                      </button>
                    </td>
                    <td>{number(tx.vsize)} vB</td>
                    <td>{rate(tx, t('goggles.coinbase'))}</td>
                    <td>{bitcoinAmount(tx.output_sats, 8)}</td>
                  </>
                )}
              />
            </details>
          </>
        ) : (
          <Empty title={t('goggles.empty')} />
        ))}
    </section>
  );
}
