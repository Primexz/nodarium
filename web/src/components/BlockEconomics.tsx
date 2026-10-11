import { useRememberedRange } from '../useRememberedRange';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { useTranslation } from 'react-i18next';
import {
  economicsRanges,
  type Block,
  type Section,
  type EconomicsHistory,
  type EconomicsPoint,
  type EconomicsRange,
} from '../types';
import VirtualTable from './VirtualTable';
import { availableReward, chartBitcoin, feeShare, rewardComplete } from '../blockEconomics';
import { bitcoinAmount, dateTime, decimal, number } from '../format';
import { useTheme } from '../theme';
import { chartPalette, useChart } from './useChart';
import { Empty, Notice, SectionHeading } from './ui';

type Series = {
  label: string;
  value: (block: Block) => number | null;
  text: (block: Block) => string;
  dashed?: boolean;
  historyValue?: (point: EconomicsPoint) => number | null;
};

function EconomicsPlot({
  title,
  description,
  blocks,
  series,
  unit,
  stacked,
  ceiling,
  history,
}: {
  title: string;
  description: string;
  blocks: Block[];
  series: Series[];
  unit: 'btc' | 'fee' | 'percent';
  stacked?: boolean;
  ceiling?: number;
  history?: EconomicsHistory;
}) {
  const { t } = useTranslation();
  const { effective } = useTheme();
  const palette = chartPalette(effective === 'dark');
  const [showData, setShowData] = useState(false);
  const values = (item: Series) =>
    history
      ? history.points.map((point) => item.historyValue?.(point) ?? null)
      : blocks.map(item.value);

  const hasData = series.some((item) => values(item).some((value) => value != null));
  const format = (value: number, precise = false) =>
    unit === 'btc'
      ? `${decimal(value, precise ? 8 : 2)} BTC`
      : unit === 'fee'
        ? `${decimal(value)} sat/vB`
        : `${decimal(value)}%`;

  const { element } = useChart({
    animation: false,
    color: palette.series,
    grid: { left: 8, right: 20, top: 24, bottom: 12, containLabel: true },
    tooltip: {
      trigger: 'axis',
      confine: true,
      renderMode: 'richText',
      backgroundColor: palette.panel,
      borderColor: palette.rule,
      textStyle: { color: palette.ink },
      valueFormatter: (value: unknown) =>
        value == null ? t('history.noReading') : format(Number(value), true),
    },
    xAxis: {
      type: 'category',
      data: history
        ? history.points.map((point) => dateTime(point.at))
        : blocks.map((block) => number(block.height)),
      axisLine: { lineStyle: { color: palette.rule } },
      axisTick: { show: false },
      axisLabel: { color: palette.text, fontSize: 12, hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: ceiling,
      interval: ceiling === 100 ? 25 : undefined,
      splitNumber: 3,
      axisLabel: { color: palette.text, fontSize: 12, formatter: (value: number) => format(value) },
      splitLine: { lineStyle: { color: palette.rule, type: 'dashed' } },
    },
    series: series.map((item) => ({
      name: item.label,
      type: stacked ? 'bar' : 'line',
      stack: stacked ? 'available-reward' : undefined,
      barMaxWidth: 32,
      connectNulls: false,
      smooth: false,
      showSymbol: true,
      symbolSize: 5,
      lineStyle: { width: 2, type: item.dashed ? 'dashed' : 'solid' },
      data: values(item),
    })),
  });

  return (
    <section className="panel chart-panel" aria-label={title}>
      <SectionHeading title={title} subtitle={description}>
        <div className="chart-legend">
          {series.map((item, index) => (
            <span key={item.label}>
              <i style={{ background: palette.series[index] }} />
              {item.label}
            </span>
          ))}
        </div>
      </SectionHeading>
      <div className="chart-wrap">
        <div
          ref={element}
          className="chart"
          role="img"
          aria-label={t(history ? 'blockEconomics.historyPlot' : 'blockEconomics.plot', { title })}
        />
        {!hasData && (
          <div className="chart-empty" role="status">
            <strong>{t('blockEconomics.unavailable')}</strong>
            <p>{t('blockEconomics.unavailableDescription')}</p>
          </div>
        )}
      </div>
      <div className="chart-foot">
        <span>{t('blockEconomics.gaps')}</span>
        <span>{t(history ? 'blockEconomics.timeOrder' : 'blockEconomics.order')}</span>
      </div>
      <details className="chart-data" onToggle={(event) => setShowData(event.currentTarget.open)}>
        <summary>
          {title} — {t('history.data')}
        </summary>
        {showData && history && (
          <VirtualTable
            rows={history.points}
            rowKey={(point) => point.at}
            columns={series.length + 2}
            label={`${title} — ${t('history.data')}`}
            resetKey={history.range}
            header={
              <>
                <th>{t('blocks.timestamp')}</th>
                <th>{t('blockEconomics.sampleBlocks')}</th>
                {series.map((item) => (
                  <th key={item.label}>{item.label}</th>
                ))}
              </>
            }
            renderRow={(point) => (
              <>
                <td>{dateTime(point.at)}</td>
                <td>{number(point.blocks)}</td>
                {series.map((item) => {
                  const value = item.historyValue?.(point);

                  return (
                    <td key={item.label}>
                      {value == null ? t('history.noReading') : format(value, true)}
                    </td>
                  );
                })}
              </>
            )}
          />
        )}
        {showData && !history && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('blocks.heightColumn')}</th>
                  <th>{t('blocks.timestamp')}</th>
                  {series.map((item) => (
                    <th key={item.label}>{item.label}</th>
                  ))}
                  {stacked && <th>{t('blockEconomics.availableReward')}</th>}
                </tr>
              </thead>
              <tbody>
                {blocks.map((block) => (
                  <tr key={block.hash}>
                    <th scope="row">{number(block.height)}</th>
                    <td>{dateTime(block.time * 1000)}</td>
                    {series.map((item) => (
                      <td key={item.label}>{item.text(block)}</td>
                    ))}
                    {stacked && <td>{bitcoinAmount(availableReward(block), 8)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </section>
  );
}

export default function BlockEconomics({
  section,
  syncing,
}: {
  section: Section<Block[]>;
  syncing?: boolean;
}) {
  const { t } = useTranslation();
  const [range, setRange] = useRememberedRange('block-economics', economicsRanges, 'recent');
  const query = useQuery({
    queryKey: ['node', 'block-economics', range],
    queryFn: ({ signal }) => api<EconomicsHistory>(`blocks/economics?range=${range}`, { signal }),
    enabled: range !== 'recent',
    refetchInterval: 30000,
  });

  const history = range === 'recent' ? undefined : query.data;
  const blocks = [...(section.data ?? [])].sort((a, b) => a.height - b.height);
  const missing = (value: number | null | undefined, unit: string) =>
    value == null ? t('history.noReading') : `${decimal(value)}${unit}`;

  const partial = blocks.some(
    (block) =>
      !rewardComplete(block) ||
      block.average_fee_rate == null ||
      block.median_fee_rate == null ||
      block.capacity_percent == null,
  );

  return (
    <section className="block-economics" aria-label={t('blockEconomics.title')}>
      <SectionHeading
        title={t('blockEconomics.title')}
        subtitle={t(
          range === 'recent' ? 'blockEconomics.description' : 'blockEconomics.historyDescription',
          { total: number(blocks.length) },
        )}
      >
        <label className="economics-range">
          {t('history.range')}
          <select
            value={range}
            onChange={(event) => setRange(event.target.value as EconomicsRange)}
          >
            {economicsRanges.map((value) => (
              <option key={value} value={value}>
                {value === 'recent' || value === 'all'
                  ? t(`blockEconomics.${value}`)
                  : t(`range.${value}`)}
              </option>
            ))}
          </select>
        </label>
      </SectionHeading>
      {range !== 'recent' && query.isPending && <Notice>{t('blockHistory.loading')}</Notice>}
      {range !== 'recent' && query.isError && (
        <Notice error>
          {t('blockHistory.error')}
          <button onClick={() => void query.refetch()}>{t('common.retry')}</button>
        </Notice>
      )}
      {history?.points.some((point) =>
        [point.reward_blocks, point.rate_blocks, point.median_blocks, point.weight_blocks].some(
          (count) => count < point.blocks,
        ),
      ) && <Notice>{t('blockEconomics.historyPartial')}</Notice>}
      {history?.stale && <Notice error>{t('blockHistory.offline')}</Notice>}
      {range === 'recent' && section.stale && (
        <Notice error>
          {t('blockEconomics.stale')}
          {section.updated_at ? ` ${dateTime(section.updated_at)}` : ''}
        </Notice>
      )}
      {syncing && <Notice>{t('blockEconomics.syncing')}</Notice>}
      {range === 'recent' && partial && <Notice>{t('blockEconomics.partial')}</Notice>}
      {range !== 'recent' && !history ? null : !blocks.length && !history ? (
        <Empty title={t('blocks.empty')} description={t('blocks.emptyDescription')} />
      ) : (
        <div className="chart-grid">
          <EconomicsPlot
            title={t('blockEconomics.fullness')}
            ceiling={100}
            description={t(
              history ? 'blockEconomics.historyFullness' : 'blockEconomics.fullnessDescription',
            )}
            blocks={blocks}
            history={history}
            unit="percent"
            series={[
              {
                label: t('blocks.capacity'),
                historyValue: (point) => point.capacity_percent,
                value: (block) => block.capacity_percent,
                text: (block) => missing(block.capacity_percent, '%'),
              },
            ]}
          />
          <EconomicsPlot
            title={t('blockEconomics.feeRates')}
            description={t(
              history ? 'blockEconomics.historyRates' : 'blockEconomics.feeRatesDescription',
            )}
            blocks={blocks}
            history={history}
            unit="fee"
            series={[
              {
                label: t('blockEconomics.averageRate'),
                historyValue: (point) => point.average_fee_rate,
                value: (block) => block.average_fee_rate ?? null,
                text: (block) => missing(block.average_fee_rate, ' sat/vB'),
              },
              {
                label: t(history ? 'blockEconomics.meanMedian' : 'blocks.medianFee'),
                historyValue: (point) => point.median_fee_rate,
                value: (block) => block.median_fee_rate,
                text: (block) => missing(block.median_fee_rate, ' sat/vB'),
                dashed: true,
              },
            ]}
          />
          <EconomicsPlot
            title={t('blockEconomics.reward')}
            description={t(
              history ? 'blockEconomics.historyReward' : 'blockEconomics.rewardDescription',
            )}
            blocks={blocks}
            history={history}
            unit="btc"
            stacked
            series={[
              {
                label: t('blockEconomics.subsidy'),
                historyValue: (point) => point.subsidy_btc,
                value: (block) => (rewardComplete(block) ? chartBitcoin(block.subsidy_sats) : null),
                text: (block) => bitcoinAmount(block.subsidy_sats, 8),
              },
              {
                label: t('blocks.totalFees'),
                historyValue: (point) => point.fees_btc,
                value: (block) =>
                  rewardComplete(block) ? chartBitcoin(block.total_fees_sats) : null,
                text: (block) => bitcoinAmount(block.total_fees_sats, 8),
              },
            ]}
          />
          <EconomicsPlot
            title={t('blockEconomics.feeShare')}
            description={t('blockEconomics.feeShareDescription')}
            blocks={blocks}
            history={history}
            unit="percent"
            series={[
              {
                label: t('blockEconomics.feeShare'),
                historyValue: (point) => point.fee_share,
                value: feeShare,
                text: (block) => missing(feeShare(block), '%'),
              },
            ]}
          />
        </div>
      )}
    </section>
  );
}
