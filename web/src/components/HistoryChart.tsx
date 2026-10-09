import { useQueries } from '@tanstack/react-query';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { message, intlLocale } from '../i18n';
import { bytes, decimal, number, dateTime, hashrate, compactNumber } from '../format';
import { useTheme } from '../theme';
import type { History } from '../types';
import { chartPalette, useChart } from './useChart';
import { Metric, Notice, SectionHeading } from './ui';

function HistoryChart({
  title,
  subtitle,
  metrics,
  labels,
  range,
  unit,
  readings,
  notice,
  step,
}: {
  title: string;
  subtitle?: string;
  metrics: string[];
  labels: string[];
  range: string;
  unit?: string;
  readings?: { label: string; value: string; detail?: string }[];
  notice?: string;
  step?: 'end';
}) {
  const { t } = useTranslation();
  const { effective } = useTheme();
  const palette = chartPalette(effective === 'dark');

  const [showData, setShowData] = useState(false);
  const queries = useQueries({
    queries: metrics.map((metric) => ({
      queryKey: ['history', metric, range],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api<History>(`history?metric=${metric}&range=${range}`, { signal }),
      refetchInterval: 30000,
      refetchIntervalInBackground: true,
    })),
  });

  const series = queries.map((q) => q.data);
  const loading = queries.some((q) => q.isPending);
  const failed = queries.some((q) => q.isError);
  const hasData = series.some((s) => s?.points.some((p) => p.value !== null));

  const hashReference =
    unit === 'hashrate'
      ? series.reduce(
          (max, s) => s?.points.reduce((value, p) => Math.max(value, p.value ?? 0), max) ?? max,
          0,
        )
      : 0;

  const format = (v: number) =>
    unit === 'bytes'
      ? bytes(v)
      : unit === 'rate'
        ? `${bytes(v)}/s`
        : unit === 'percent'
          ? `${decimal(v)}%`
          : unit === 'fee'
            ? `${decimal(v)} sat/vB`
            : unit === 'hashrate'
              ? hashrate(v, hashReference)
              : unit === 'difficulty'
                ? compactNumber(v)
                : number(v);

  const { element } = useChart({
    animation: false,
    color: palette.series,
    grid: { left: 8, right: 20, top: 24, bottom: 12, containLabel: true },
    tooltip: {
      trigger: 'axis',
      renderMode: 'richText',
      backgroundColor: palette.panel,
      borderColor: palette.rule,
      textStyle: { color: palette.ink },
      valueFormatter: (v: unknown) => (v == null ? t('history.noReading') : format(Number(v))),
    },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: palette.rule } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: {
        color: palette.text,
        fontSize: 12,
        hideOverlap: true,
        formatter: (v: number) =>
          range === '1h' || range === '24h'
            ? new Date(v).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' })
            : new Date(v).toLocaleDateString(intlLocale(), { month: 'short', day: 'numeric' }),
      },
    },
    yAxis: {
      type: 'value',
      min: 0,
      splitNumber: 3,
      axisLabel: { color: palette.text, fontSize: 12, formatter: format },
      splitLine: { lineStyle: { color: palette.rule, type: 'dashed' } },
    },
    series: series.map((s, i) => ({
      name: labels[i],
      type: 'line',
      connectNulls: false,
      smooth: false,
      step,
      showSymbol: true,
      symbolSize: 4,
      lineStyle: { width: 2, type: unit === 'hashrate' && i === 1 ? 'dashed' : 'solid' },
      data: s?.points.map((p) => [p.at, p.value]) ?? [],
    })),
  });

  return (
    <section className="panel chart-panel">
      <SectionHeading title={title} subtitle={subtitle}>
        <div className="chart-legend">
          {labels.map((label, i) => (
            <span key={label}>
              <i style={{ background: palette.series[i] }} />
              {label}
            </span>
          ))}
        </div>
      </SectionHeading>
      {notice && <Notice error>{notice}</Notice>}
      {readings && (
        <dl className="chart-readings">
          {readings.map((reading) => (
            <Metric key={reading.label} {...reading} />
          ))}
        </dl>
      )}
      <div className="chart-wrap">
        <div
          ref={element}
          className="chart"
          role="img"
          aria-label={t('history.accessible', { title, range: t(`range.${range}`) })}
        />
        {(loading || !hasData) && (
          <div className={`chart-empty ${loading ? 'skeleton' : ''}`} role="status">
            <strong>
              {loading
                ? t('history.loading')
                : failed
                  ? message('History is temporarily unavailable.')
                  : t('history.empty')}
            </strong>
            {!loading && !failed && <p>{t('history.emptyDescription')}</p>}
          </div>
        )}
      </div>
      {failed && hasData && (
        <p className="chart-error" role="status">
          {message('History is temporarily unavailable.')}
        </p>
      )}
      <div className="chart-foot">
        <span>{t('history.gaps')}</span>
        <span>
          {unit === 'rate' && hasData ? (
            <>
              {t('history.observed')}{' '}
              {series.map(
                (s, i) =>
                  s && (
                    <b key={s.metric}>
                      {labels[i]} {bytes(s.total)}
                      {i < series.length - 1 ? ' · ' : ''}
                    </b>
                  ),
              )}
            </>
          ) : (
            t('history.collected')
          )}
        </span>
      </div>
      {hasData && (
        <details className="chart-data" onToggle={(event) => setShowData(event.currentTarget.open)}>
          <summary>
            {title} — {t('history.data')}
          </summary>
          {showData && (
            <HistoryDataTable key={range} series={series} labels={labels} format={format} />
          )}
        </details>
      )}
    </section>
  );
}

function HistoryDataTable({
  series,
  labels,
  format,
}: {
  series: (History | undefined)[];
  labels: string[];
  format: (value: number) => string;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const points = series[0]?.points ?? [];
  const pages = Math.max(1, Math.ceil(points.length / 100));
  const current = Math.min(page, pages);

  return (
    <>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t('blocks.timestamp')}</th>
              {labels.map((label) => (
                <th key={label}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {points.slice((current - 1) * 100, current * 100).map((point, i) => (
              <tr key={point.at}>
                <td>{dateTime(point.at)}</td>
                {series.map((s, j) => (
                  <td key={j}>
                    {s?.points[(current - 1) * 100 + i]?.value == null
                      ? t('history.noReading')
                      : format(s.points[(current - 1) * 100 + i]!.value!)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="pagination">
          <span>{t('peers.page', { page: number(current), pages: number(pages) })}</span>
          <button disabled={current === 1} onClick={() => setPage(current - 1)}>
            {t('common.previous')}
          </button>
          <button disabled={current === pages} onClick={() => setPage(current + 1)}>
            {t('common.next')}
          </button>
        </div>
      )}
    </>
  );
}

export default memo(
  HistoryChart,
  (previous, next) =>
    previous.title === next.title &&
    previous.subtitle === next.subtitle &&
    previous.range === next.range &&
    previous.unit === next.unit &&
    previous.notice === next.notice &&
    previous.step === next.step &&
    JSON.stringify(previous.readings) === JSON.stringify(next.readings) &&
    previous.metrics.join() === next.metrics.join() &&
    previous.labels.join() === next.labels.join(),
);
