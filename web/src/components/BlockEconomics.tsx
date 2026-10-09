import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Block, Section } from '../types';
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
};

function EconomicsPlot({
  title,
  description,
  blocks,
  series,
  unit,
  stacked,
  ceiling,
}: {
  title: string;
  description: string;
  blocks: Block[];
  series: Series[];
  unit: 'btc' | 'fee' | 'percent';
  stacked?: boolean;
  ceiling?: number;
}) {
  const { t } = useTranslation();
  const { effective } = useTheme();
  const palette = chartPalette(effective === 'dark');
  const [showData, setShowData] = useState(false);
  const hasData = series.some((item) => blocks.some((block) => item.value(block) != null));
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
      data: blocks.map((block) => number(block.height)),
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
      data: blocks.map(item.value),
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
          aria-label={t('blockEconomics.plot', { title })}
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
        <span>{t('blockEconomics.order')}</span>
      </div>
      <details className="chart-data" onToggle={(event) => setShowData(event.currentTarget.open)}>
        <summary>
          {title} — {t('history.data')}
        </summary>
        {showData && (
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
        subtitle={t('blockEconomics.description', { count: number(blocks.length) })}
      />
      {section.stale && (
        <Notice error>
          {t('blockEconomics.stale')}
          {section.updated_at ? ` ${dateTime(section.updated_at)}` : ''}
        </Notice>
      )}
      {syncing && <Notice>{t('blockEconomics.syncing')}</Notice>}
      {partial && <Notice>{t('blockEconomics.partial')}</Notice>}
      {!blocks.length ? (
        <Empty title={t('blocks.empty')} description={t('blocks.emptyDescription')} />
      ) : (
        <div className="chart-grid">
          <EconomicsPlot
            title={t('blockEconomics.reward')}
            description={t('blockEconomics.rewardDescription')}
            blocks={blocks}
            unit="btc"
            stacked
            series={[
              {
                label: t('blockEconomics.subsidy'),
                value: (block) => (rewardComplete(block) ? chartBitcoin(block.subsidy_sats) : null),
                text: (block) => bitcoinAmount(block.subsidy_sats, 8),
              },
              {
                label: t('blocks.totalFees'),
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
            unit="percent"
            series={[
              {
                label: t('blockEconomics.feeShare'),
                value: feeShare,
                text: (block) => missing(feeShare(block), '%'),
              },
            ]}
          />
          <EconomicsPlot
            title={t('blockEconomics.feeRates')}
            description={t('blockEconomics.feeRatesDescription')}
            blocks={blocks}
            unit="fee"
            series={[
              {
                label: t('blockEconomics.averageRate'),
                value: (block) => block.average_fee_rate ?? null,
                text: (block) => missing(block.average_fee_rate, ' sat/vB'),
              },
              {
                label: t('blocks.medianFee'),
                value: (block) => block.median_fee_rate,
                text: (block) => missing(block.median_fee_rate, ' sat/vB'),
                dashed: true,
              },
            ]}
          />
          <EconomicsPlot
            title={t('blockEconomics.fullness')}
            ceiling={100}
            description={t('blockEconomics.fullnessDescription')}
            blocks={blocks}
            unit="percent"
            series={[
              {
                label: t('blocks.capacity'),
                value: (block) => block.capacity_percent,
                text: (block) => missing(block.capacity_percent, '%'),
              },
            ]}
          />
        </div>
      )}
    </section>
  );
}
