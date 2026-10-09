import { useTranslation } from 'react-i18next';
import type { Overview, Section } from '../types';
import { difficultyAdjustmentTime, difficultyPeriod } from '../difficulty';
import { decimal, number } from '../format';
import { intlLocale, message } from '../i18n';
import { Empty, Metric, Notice, SectionHeading } from './ui';

export default function DifficultyPeriod({ section }: { section?: Section<Overview> }) {
  const { t } = useTranslation();
  const chain = section?.data?.blockchain;
  const period = chain ? difficultyPeriod(chain.chain, chain.blocks) : null;
  const syncing = chain && (chain.initialblockdownload || chain.blocks < chain.headers);
  const adjustmentTime =
    chain && !syncing
      ? difficultyAdjustmentTime(chain.chain, chain.blocks, section?.updated_at)
      : null;

  return (
    <section className="panel difficulty-panel" aria-label={t('difficultyPeriod.title')}>
      <SectionHeading
        title={t('difficultyPeriod.title')}
        subtitle={t('difficultyPeriod.subtitle')}
      />
      {(section?.stale || section?.error) && (
        <Notice error>
          {section.error && <>{message(section.error)}. </>}
          {t(chain ? 'difficultyPeriod.stale' : 'difficultyPeriod.unavailable')}
        </Notice>
      )}
      {!chain ? (
        <Empty
          title={t(section?.error ? 'difficultyPeriod.unavailable' : 'difficultyPeriod.loading')}
        />
      ) : !period ? (
        <Empty
          title={t('difficultyPeriod.unavailable')}
          description={t(
            chain.chain === 'regtest' ? 'difficultyPeriod.regtest' : 'difficultyPeriod.unsupported',
          )}
        />
      ) : (
        <div className="difficulty-content">
          <dl className="difficulty-metrics">
            <Metric
              label={t('difficultyPeriod.progress')}
              value={`${decimal(period.percent)}%`}
              detail={t('difficultyPeriod.elapsed', {
                elapsed: number(period.elapsed),
                interval: number(period.interval),
              })}
            />
            <Metric label={t('difficultyPeriod.remaining')} value={number(period.remaining)} />
            <Metric label={t('difficultyPeriod.nextHeight')} value={number(period.nextHeight)} />
          </dl>
          <progress
            className="difficulty-progress"
            aria-label={t('difficultyPeriod.progress')}
            aria-valuetext={t('difficultyPeriod.elapsed', {
              elapsed: number(period.elapsed),
              interval: number(period.interval),
            })}
            max={period.interval}
            value={period.elapsed}
          />
          <p className="difficulty-note">
            {t(syncing ? 'difficultyPeriod.syncing' : 'difficultyPeriod.basis', {
              height: number(chain.blocks),
            })}
          </p>
          {!syncing && (
            <dl className="difficulty-estimate">
              <Metric
                label={t('difficultyPeriod.expectedTime')}
                value={
                  adjustmentTime == null ? (
                    '—'
                  ) : (
                    <time dateTime={new Date(adjustmentTime).toISOString()}>
                      {new Intl.DateTimeFormat(intlLocale(), {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZoneName: 'short',
                      }).format(adjustmentTime)}
                    </time>
                  )
                }
                detail={t(
                  adjustmentTime == null
                    ? 'difficultyPeriod.timeUnavailable'
                    : 'difficultyPeriod.timeBasis',
                )}
              />
            </dl>
          )}
        </div>
      )}
    </section>
  );
}
