import { LoadingSkeleton, MetricsSkeleton, ChartSkeleton } from '../components/Skeleton';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, APIError } from '../api';
import { poolHistoryRanges, type PoolDetail, type PoolHistoryRange } from '../types';
import { decimal, number } from '../format';
import { Empty, Metric, Notice, SectionHeading } from '../components/ui';
import { PoolCoverage, PoolRange, PoolTrendChart } from '../components/PoolHistory';
import PoolLogo from '../components/PoolLogo';
import { BlockStrip } from '../components/BlockTable';
import { BitcoinValue } from '../fiat';

export default function PoolDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const [search, setSearch] = useSearchParams();
  const requested = search.get('range');
  const range: PoolHistoryRange = poolHistoryRanges.find((value) => value === requested) ?? '30d';
  const validID = !!id && /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id));
  const query = useQuery({
    queryKey: ['node', 'pool-detail', id, range],
    queryFn: ({ signal }) => api<PoolDetail>(`mining/pools/${id}?range=${range}`, { signal }),
    enabled: validID,
    refetchInterval: 60000,
    retry: false,
  });

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [id]);

  const data = query.data;
  const metrics = data?.history.pools.find((pool) => pool.pool?.id === Number(id));
  const reading = (value: number | null | undefined, unit = '') =>
    value == null ? '—' : `${decimal(value)}${unit}`;

  const sample = (count: number | undefined) =>
    t('poolHistory.metricSample', {
      samples: number(count ?? 0),
      total: number(metrics?.blocks ?? 0),
    });

  const notFound = !validID || (query.error instanceof APIError && query.error.status === 404);

  return (
    <main id="content" className="page-content pool-detail-page" tabIndex={-1}>
      <Link to={`/mining/pools?range=${range}`} className="text-link pool-back">
        <ArrowLeft size={16} aria-hidden />
        {t('workspace.backToPools')}
      </Link>
      <div className="page-heading">
        <h1 className="pool-detail-title">
          {data && <PoolLogo name={data.pool.name} />}
          {data?.pool.name ?? t('poolHistory.detail')}
        </h1>
        <p>{t('poolHistory.detailDescription')}</p>
        {data?.pool.link && (
          <a className="text-link" href={data.pool.link} target="_blank" rel="noopener noreferrer">
            {t('poolHistory.website')} <ArrowUpRight size={14} aria-hidden />
          </a>
        )}
      </div>
      {query.isLoading && validID && (
        <LoadingSkeleton label={t('blockHistory.loading')}>
          <MetricsSkeleton />
          <ChartSkeleton />
        </LoadingSkeleton>
      )}
      {notFound ? (
        <Empty
          title={t('poolHistory.notFound')}
          description={t('poolHistory.notFoundDescription')}
        />
      ) : (
        query.isError && (
          <Notice error>
            {t('pools.requestFailed')}{' '}
            <button onClick={() => void query.refetch()}>{t('common.retry')}</button>
          </Notice>
        )
      )}
      {data && (
        <>
          <SectionHeading
            title={t('poolHistory.performance')}
            subtitle={t('poolHistory.performanceDescription')}
          >
            <PoolRange range={range} onChange={(value) => setSearch({ range: value })} />
          </SectionHeading>
          <PoolCoverage data={data.history} />
          {query.isError && <Notice error>{t('pools.stale')}</Notice>}
          {data.history.status !== 'unsupported' && (
            <>
              <dl className="pool-metrics">
                <Metric
                  label={t('poolHistory.found')}
                  value={number(metrics?.blocks ?? 0)}
                  detail={t('poolHistory.foundDescription')}
                />
                <Metric
                  label={t('poolHistory.observedShare')}
                  value={reading(metrics?.share_percent ?? (data.history.blocks ? 0 : null), '%')}
                  detail={t('poolHistory.denominator')}
                />
                <Metric
                  label={t('poolHistory.emptyRate')}
                  value={reading(metrics?.empty_percent, '%')}
                  detail={`${number(metrics?.empty_blocks ?? 0)} ${t('poolHistory.emptyBlocks')} · ${sample(metrics?.transaction_blocks)}`}
                />
                <Metric
                  label={t('poolHistory.utilization')}
                  value={reading(metrics?.capacity_percent, '%')}
                  detail={sample(metrics?.weight_blocks)}
                />
                <Metric
                  label={t('poolHistory.fees')}
                  value={<BitcoinValue btc={metrics?.average_fees_btc ?? null} />}
                  detail={sample(metrics?.fee_blocks)}
                />
              </dl>
              <p className="pool-explanation">{t('poolHistory.metricsNote')}</p>
              <PoolTrendChart data={data.history} poolID={data.pool.id} />
              <p className="pool-explanation">{t('pools.explanation')}</p>
              <section className="pool-recent" aria-label={t('poolHistory.recent')}>
                <BlockStrip
                  blocks={data.recent_blocks}
                  stale={data.history.stale}
                  title={t('poolHistory.recent')}
                  subtitle={t('poolHistory.recentDescription')}
                  tipHeight={data.history.height}
                  fullTime
                />
                {!data.recent_blocks.length && (
                  <Empty
                    title={t('poolHistory.noBlocks')}
                    description={t('poolHistory.noBlocksDescription')}
                  />
                )}
              </section>
            </>
          )}
        </>
      )}
    </main>
  );
}
