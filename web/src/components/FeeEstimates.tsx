import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { dateTime, decimal, number } from '../format';
import { message } from '../i18n';
import { sectionResult } from '../state';
import type { Fees, Overview, Section, HistoryRange } from '../types';
import HistoryChart from './HistoryChart';
import { Metric, Notice, SectionHeading } from './ui';

const targets = [2, 3, 6];

export default function FeeEstimates({ overview }: { overview?: Section<Overview> }) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['node', 'fees'],
    queryFn: ({ signal }) => api<Section<Fees>>('fees', { signal }),
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
  });

  const section = sectionResult(query.data, query.isError);
  const chain = overview?.data?.blockchain;
  const syncing = chain && (chain.initialblockdownload || chain.blocks < chain.headers);

  return (
    <section className="fee-estimates" aria-label={t('fees.title')}>
      <SectionHeading title={t('fees.title')} subtitle={t('fees.description')} />
      {(syncing || section.stale || section.error) && (
        <Notice error>
          {syncing
            ? t('fees.syncing')
            : section.stale && section.data
              ? t('fees.stale')
              : message(section.error) || t('fees.unavailable')}
        </Notice>
      )}
      <dl className="fee-readings">
        {targets.map((blocks) => {
          const target = section.data?.targets.find((value) => value.target_blocks === blocks);
          const reading = syncing ? null : target?.data;
          const stale = section.stale || target?.stale;
          const time = target?.updated_at ? dateTime(target.updated_at) : null;
          const detail = syncing
            ? t('fees.waitingSync')
            : reading
              ? [
                  reading.estimated_blocks !== blocks
                    ? t('fees.returnedTarget', { blocks: number(reading.estimated_blocks) })
                    : '',
                  time ? t(stale ? 'fees.lastKnown' : 'fees.observedAt', { time }) : '',
                  target?.error ? message(target.error) : '',
                ]
                  .filter(Boolean)
                  .join(' ')
              : message(target?.error) || t('fees.waiting');

          return (
            <Metric
              key={blocks}
              label={t('fees.target', { blocks: number(blocks) })}
              value={reading ? `${decimal(reading.fee_rate)} sat/vB` : '—'}
              detail={detail}
            />
          );
        })}
      </dl>
      <p className="fees-note">{t('fees.basis')}</p>
    </section>
  );
}

export function FeeHistory({ range }: { range: HistoryRange }) {
  const { t } = useTranslation();

  return (
    <div className="full-chart fee-history">
      <HistoryChart
        title={t('fees.history')}
        subtitle={t('fees.historyDescription')}
        metrics={targets.map((blocks) => `fee_estimate_${blocks}`)}
        labels={targets.map((blocks) => t('fees.target', { blocks: number(blocks) }))}
        range={range}
        unit="fee"
        linePatterns={['solid', 'dashed', 'dotted']}
      />
    </div>
  );
}
