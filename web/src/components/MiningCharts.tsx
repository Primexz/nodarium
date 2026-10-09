import { useTranslation } from 'react-i18next';
import type { Overview, Mining, Section } from '../types';
import { compactNumber, hashrate, number } from '../format';
import { message } from '../i18n';
import HistoryChart from './HistoryChart';

export default function MiningCharts({
  mining,
  overview,
  range,
}: {
  mining: Section<Mining>;
  overview?: Section<Overview>;
  range: string;
}) {
  const { t } = useTranslation();
  const chain = overview?.data?.blockchain;
  const syncing = chain && (chain.initialblockdownload || chain.blocks < chain.headers);
  const note = syncing
    ? t('mining.syncing')
    : mining.stale && mining.data
      ? `${t('mining.stale')} ${message(mining.error)}`.trim()
      : message(mining.error);

  const windows = [144, 1008] as const;

  return (
    <section className="chart-grid mining-charts" aria-label={t('mining.title')}>
      <HistoryChart
        title={t('mining.hashrate')}
        subtitle={t('mining.description')}
        metrics={['hashrate_144', 'hashrate_1008']}
        labels={windows.map((window) => t('mining.window', { blocks: number(window) }))}
        range={range}
        unit="hashrate"
        notice={note}
        readings={windows.map((window) => ({
          label: t('mining.window', { blocks: number(window) }),
          value: hashrate(syncing ? null : mining.data?.[`hashrate_${window}`]),
          detail:
            mining.data && !syncing
              ? t('mining.height', { height: number(mining.data.height) })
              : t('mining.waiting'),
        }))}
      />
      <HistoryChart
        title={t('mining.difficulty')}
        subtitle={t('mining.difficultyDescription')}
        metrics={['difficulty']}
        labels={[t('node.difficulty')]}
        range={range}
        unit="difficulty"
        step="end"
        notice={
          overview?.stale
            ? t('mining.difficultyStale')
            : syncing
              ? t('mining.syncingDifficulty')
              : undefined
        }
        readings={[
          {
            label: t('mining.currentDifficulty'),
            value: compactNumber(chain?.difficulty),
            detail: t('mining.chainDifficulty'),
          },
        ]}
      />
    </section>
  );
}
