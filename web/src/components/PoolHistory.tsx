import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useRememberedRange } from '../useRememberedRange';
import { api } from '../api';
import {
  poolHistoryRanges,
  type PoolHistoryRange,
  type PoolTrends,
  type PoolTrendPoint,
} from '../types';
import { dateTime, decimal, number } from '../format';
import { useTheme } from '../theme';
import { chartPalette, useChart } from './useChart';
import VirtualTable from './VirtualTable';
import { Notice, SectionHeading } from './ui';

export function PoolRange({
  range,
  onChange,
}: {
  range: PoolHistoryRange;
  onChange: (range: PoolHistoryRange) => void;
}) {
  const { t } = useTranslation();

  return (
    <label className="economics-range">
      {t('poolHistory.range')}
      <select value={range} onChange={(event) => onChange(event.target.value as PoolHistoryRange)}>
        {poolHistoryRanges.map((value) => (
          <option key={value} value={value}>
            {value === 'all' ? t('blockEconomics.all') : t(`range.${value}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PoolCoverage({ data }: { data: PoolTrends }) {
  const { t } = useTranslation();

  if (data.status === 'unsupported') return <Notice>{t('pools.unsupportedNote')}</Notice>;

  return (
    <>
      {data.classified_blocks < data.blocks && (
        <Notice>
          {t('poolHistory.attributionMissing', {
            total: number(data.blocks - data.classified_blocks),
          })}
        </Notice>
      )}
      {data.stale && <Notice error>{t('blockHistory.offline')}</Notice>}
      <p className="pool-sample">
        {t('poolHistory.coverage', {
          blocks: number(data.blocks),
          identified: number(data.attributed_blocks),
          classified: number(data.classified_blocks),
        })}
      </p>
      {!!data.start && (
        <p className="pool-sample">
          {dateTime(data.start)} — {dateTime(data.end)}
        </p>
      )}
    </>
  );
}

export function PoolTrendChart({ data, poolID }: { data: PoolTrends; poolID?: number }) {
  const { t } = useTranslation();
  const { effective } = useTheme();
  const palette = chartPalette(effective === 'dark');
  const [showData, setShowData] = useState(false);
  const identified = data.pools.filter((pool) => pool.pool);
  const leaders = poolID
    ? identified.filter((pool) => pool.pool?.id === poolID)
    : identified.slice(0, 4);

  const series = leaders.map((pool, index) => ({
    key: pool.key,
    name: pool.pool!.name,
    pool: pool.pool,
    color: palette.series[index % palette.series.length]!,
    count: (point: PoolTrendPoint) => point.counts[pool.key] ?? 0,
  }));

  if (poolID && !series.length) {
    series.push({
      key: `pool-${poolID}`,
      name: t('pools.share'),
      pool: null,
      color: palette.series[0]!,
      count: (point) => point.counts[`pool-${poolID}`] ?? 0,
    });
  }

  if (!poolID) {
    const rest = identified.slice(4);

    if (rest.length)
      series.push({
        key: 'other',
        name: t('poolHistory.other'),
        pool: null,
        color: palette.ink,
        count: (point) => rest.reduce((sum, pool) => sum + (point.counts[pool.key] ?? 0), 0),
      });

    for (const key of ['unknown', 'unavailable'] as const) {
      if (data.pools.some((pool) => pool.key === key))
        series.push({
          key,
          name: t(`pools.${key}`),
          pool: null,
          color: key === 'unknown' ? palette.edge : palette.land,
          count: (point) => point.counts[key] ?? 0,
        });
    }
  }

  const title = t('poolHistory.trend');
  const { element } = useChart({
    animation: false,
    grid: { left: 8, right: 20, top: 24, bottom: 12, containLabel: true },
    tooltip: {
      trigger: 'axis',
      confine: true,
      renderMode: 'richText',
      backgroundColor: palette.panel,
      borderColor: palette.rule,
      textStyle: { color: palette.ink },
      valueFormatter: (value: unknown) =>
        value == null ? t('history.noReading') : `${decimal(Number(value))}%`,
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: data.points.map((point) => dateTime(point.at)),
      axisLine: { lineStyle: { color: palette.rule } },
      axisTick: { show: false },
      axisLabel: { color: palette.text, fontSize: 12, hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      interval: 25,
      axisLabel: { color: palette.text, fontSize: 12, formatter: '{value}%' },
      splitLine: { lineStyle: { color: palette.rule, type: 'dashed' } },
    },
    series: series.map((item) => ({
      name: item.name,
      type: 'line',
      stack: poolID ? undefined : 'pool-shares',
      areaStyle: poolID ? undefined : { opacity: 0.7 },
      lineStyle: { width: poolID ? 2 : 1, color: item.color },
      itemStyle: { color: item.color },
      showSymbol: true,
      symbolSize: 3,
      connectNulls: false,
      data: data.points.map((point) =>
        point.blocks ? (item.count(point) / point.blocks) * 100 : null,
      ),
    })),
  });

  return (
    <section className="panel chart-panel pool-trend-chart" aria-label={title}>
      <SectionHeading title={title} subtitle={t('poolHistory.chartDescription')} />
      <div className="chart-legend pool-trend-legend">
        {series.map((item) => (
          <span key={item.key}>
            <i className="pool-swatch" style={{ backgroundColor: item.color }} aria-hidden />
            {item.pool ? (
              <Link to={`/mining/pools/${item.pool.id}?range=${data.range}`}>{item.name}</Link>
            ) : (
              item.name
            )}
          </span>
        ))}
      </div>
      <div className="chart-wrap">
        <div ref={element} className="chart" role="img" aria-label={t('poolHistory.chartLabel')} />
        {!data.blocks && (
          <div className="chart-empty">
            <strong>{t('poolHistory.empty')}</strong>
            <p>{t('poolHistory.emptyDescription')}</p>
          </div>
        )}
      </div>
      <div className="chart-foot">
        <span>{t('poolHistory.bucket', { hours: number(data.interval_seconds / 3600) })}</span>
        <span>{t('poolHistory.denominator')}</span>
      </div>
      <details className="chart-data" onToggle={(event) => setShowData(event.currentTarget.open)}>
        <summary>
          {title} — {t('history.data')}
        </summary>
        {showData && (
          <VirtualTable
            rows={data.points}
            rowKey={(point) => point.at}
            columns={series.length + 2}
            label={`${title} — ${t('history.data')}`}
            resetKey={`${data.range}-${poolID ?? 'all'}`}
            header={
              <>
                <th>{t('blocks.timestamp')}</th>
                <th>{t('pools.blocks')}</th>
                {series.map((item) => (
                  <th key={item.key}>{item.name}</th>
                ))}
              </>
            }
            renderRow={(point) => (
              <>
                <td>{dateTime(point.at)}</td>
                <td>{number(point.blocks)}</td>
                {series.map((item) => (
                  <td key={item.key}>
                    {point.blocks
                      ? `${decimal((item.count(point) / point.blocks) * 100)}% · ${number(item.count(point))}`
                      : '—'}
                  </td>
                ))}
              </>
            )}
          />
        )}
      </details>
    </section>
  );
}

export default function PoolHistory() {
  const { t } = useTranslation();
  const [search, setSearch] = useSearchParams();
  const [remembered, remember] = useRememberedRange('pools', poolHistoryRanges, '30d');
  const range = poolHistoryRanges.find((value) => value === search.get('range')) ?? remembered;

  function setRange(value: PoolHistoryRange) {
    remember(value);
    setSearch({ range: value }, { replace: true });
  }

  const query = useQuery({
    queryKey: ['node', 'pool-history', range],
    queryFn: ({ signal }) => api<PoolTrends>(`mining/pools/history?range=${range}`, { signal }),
    refetchInterval: 60000,
  });

  const data = query.data;

  return (
    <section className="pool-history" aria-label={t('poolHistory.title')}>
      <SectionHeading title={t('poolHistory.title')} subtitle={t('poolHistory.description')}>
        <PoolRange range={range} onChange={setRange} />
      </SectionHeading>
      {query.isPending && <Notice>{t('blockHistory.loading')}</Notice>}
      {query.isError && (
        <Notice error>
          {t('pools.requestFailed')}{' '}
          <button onClick={() => void query.refetch()}>{t('common.retry')}</button>
        </Notice>
      )}
      {data && (
        <>
          <PoolCoverage data={data} />
          {query.isError && <Notice error>{t('pools.stale')}</Notice>}
          {data.status !== 'unsupported' && <PoolTrendChart data={data} />}
          <p className="pool-explanation">{t('pools.explanation')}</p>
          {data.definitions.commit && (
            <p className="pool-source">
              <a
                href={`https://github.com/mempool/mining-pools/tree/${data.definitions.commit}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('pools.source')}
              </a>
            </p>
          )}
        </>
      )}
    </section>
  );
}
