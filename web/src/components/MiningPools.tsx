import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import type { PoolDistribution, PoolShare, PoolAttribution } from '../types';
import { number, decimal } from '../format';
import { useTheme } from '../theme';
import { chartPalette, useChart } from './useChart';
import { Notice, SectionHeading } from './ui';

function poolName(share: PoolShare, unknown: string) {
  return share.pool?.name ?? unknown;
}

function PoolPie({ shares, count }: { shares: PoolShare[]; count: number }) {
  const { t } = useTranslation();
  const { effective } = useTheme();
  const palette = useMemo(() => chartPalette(effective === 'dark'), [effective]);
  const options = useMemo(
    () => ({
      animation: false,
      tooltip: {
        renderMode: 'richText',
        confine: true,
        formatter: (params: { name: string; value: number; percent: number }) =>
          `${params.name}\n${t('pools.blockCount', { value: number(params.value) })} · ${decimal(params.percent)}%`,
      },
      series: [
        {
          type: 'pie',
          radius: ['38%', '80%'],
          center: ['50%', '50%'],
          label: { show: false },
          labelLine: { show: false },
          itemStyle: { borderColor: palette.ground, borderWidth: 2 },
          data: shares.map((share, index) => ({
            name: poolName(share, t('pools.unknown')),
            value: share.blocks,
            itemStyle: {
              color: share.pool ? palette.series[index % palette.series.length] : palette.edge,
            },
          })),
        },
      ],
    }),
    [shares, t, palette],
  );

  const { element } = useChart(options);

  return (
    <div
      ref={element}
      className="pool-pie"
      role="img"
      aria-label={t('pools.chartLabel', { value: number(count) })}
    />
  );
}

export function BlockPool({ attribution }: { attribution?: PoolAttribution }) {
  const { t } = useTranslation();
  const pool = attribution?.pool;
  const status = attribution?.status ?? 'unavailable';

  return (
    <div className="block-pool" role="group" aria-label={t('pools.miner')}>
      <span>{t('pools.miner')}</span>
      <strong>
        {pool ? (
          pool.link ? (
            <a href={pool.link} target="_blank" rel="noopener noreferrer">
              {pool.name}
            </a>
          ) : (
            pool.name
          )
        ) : (
          t(`pools.${status}`)
        )}
      </strong>
      <small>
        {pool
          ? t(attribution?.method === 'payout_address' ? 'pools.addressMatch' : 'pools.tagMatch')
          : t('pools.identificationNote')}
      </small>
    </div>
  );
}

export default function MiningPools() {
  const { t } = useTranslation();
  const [window, setWindow] = useState(144);
  const { effective } = useTheme();
  const palette = useMemo(() => chartPalette(effective === 'dark'), [effective]);
  const query = useQuery({
    queryKey: ['node', 'mining-pools', window],
    queryFn: ({ signal }) => api<PoolDistribution>(`mining/pools?blocks=${window}`, { signal }),
    refetchInterval: (query) =>
      ['loading', 'indexing'].includes(query.state.data?.status ?? '') ? 2000 : 10000,
  });

  const data = query.data;
  const indexing = data?.status === 'loading' || data?.status === 'indexing';

  return (
    <section className="mining-pools" aria-label={t('pools.title')}>
      <SectionHeading title={t('pools.title')} subtitle={t('pools.description')}>
        <div className="range-picker" role="group" aria-label={t('pools.windowLabel')}>
          {[144, 1008].map((size) => (
            <button
              key={size}
              className={window === size ? 'active' : ''}
              aria-pressed={window === size}
              onClick={() => setWindow(size)}
            >
              {t('pools.window', { value: number(size) })}
            </button>
          ))}
        </div>
      </SectionHeading>
      {query.isPending && <Notice>{t('pools.loading')}</Notice>}
      {query.isError && (
        <Notice error>
          {t('pools.requestFailed')}{' '}
          <button onClick={() => void query.refetch()}>{t('common.retry')}</button>
        </Notice>
      )}
      {data && (
        <>
          {indexing && (
            <div className="pool-progress" role="status">
              <span>
                {data.target
                  ? t('pools.indexing', {
                      count: number(data.scanned),
                      target: number(data.target),
                    })
                  : t('pools.loading')}
              </span>
              {data.target > 0 && (
                <progress max={data.target} value={data.scanned} aria-label={t('pools.progress')} />
              )}
            </div>
          )}
          {['unavailable', 'unsupported', 'syncing', 'partial'].includes(data.status) && (
            <Notice error={data.status === 'unavailable' || data.status === 'partial'}>
              {t(`pools.${data.status}Note`)}
            </Notice>
          )}
          {(data.stale || (query.isError && data.scanned > 0)) && (
            <Notice error>{t('pools.stale')}</Notice>
          )}
          {data.scanned > 0 && (
            <>
              <p className="pool-sample">
                {t('pools.sample', {
                  count: number(data.scanned),
                  target: number(data.target),
                  height: number(data.height),
                })}
              </p>
              <div className="pool-distribution">
                <PoolPie shares={data.shares} count={data.scanned} />
                <div className="table-scroll">
                  <table className="pool-table">
                    <caption className="sr-only">{t('pools.title')}</caption>
                    <thead>
                      <tr>
                        <th>{t('pools.pool')}</th>
                        <th>{t('pools.blocks')}</th>
                        <th>{t('pools.share')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.shares.map((share, index) => (
                        <tr key={share.pool?.id ?? 'unknown'}>
                          <th scope="row">
                            <span className="pool-name">
                              <span
                                className="pool-swatch"
                                aria-hidden
                                style={{
                                  backgroundColor: share.pool
                                    ? palette.series[index % palette.series.length]
                                    : palette.edge,
                                }}
                              />
                              {poolName(share, t('pools.unknown'))}
                            </span>
                          </th>
                          <td>{number(share.blocks)}</td>
                          <td>{decimal(share.percent)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
          <p className="pool-explanation">{t('pools.explanation')}</p>
          <p className="pool-source">
            <a
              href={`https://github.com/mempool/mining-pools/tree/${data.definitions.commit}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('pools.source')}
            </a>
          </p>
        </>
      )}
    </section>
  );
}
