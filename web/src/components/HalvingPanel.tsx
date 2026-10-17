import { useTranslation } from 'react-i18next';
import type { Overview, Section } from '../types';
import { halvingSchedule, halvingTime } from '../halving';
import { bitcoinAmount, decimal, number } from '../format';
import { intlLocale, message } from '../i18n';
import { BitcoinValue } from '../fiat';
import { Empty, Metric, Notice, SectionHeading } from './ui';
import styles from './HalvingPanel.module.css';

export default function HalvingPanel({ section }: { section?: Section<Overview> }) {
  const { t } = useTranslation();
  const chain = section?.data?.blockchain;
  const schedule = chain ? halvingSchedule(chain.chain, chain.blocks) : null;
  const syncing = chain && (chain.initialblockdownload || chain.blocks < chain.headers);
  const estimate =
    chain && !syncing ? halvingTime(chain.chain, chain.blocks, section?.updated_at) : null;

  return (
    <section className="panel" aria-label={t('halving.title')}>
      <SectionHeading title={t('halving.title')} subtitle={t('halving.subtitle')} />
      {(section?.stale || section?.error) && (
        <Notice error>
          {section.error && <>{message(section.error)}. </>}
          {t(schedule ? 'halving.stale' : 'halving.unavailable')}
        </Notice>
      )}
      {!chain ? (
        <Empty title={t(section?.error ? 'halving.unavailable' : 'halving.loading')} />
      ) : !schedule ? (
        <Empty title={t('halving.unavailable')} description={t('halving.unsupported')} />
      ) : (
        <div className={styles.content}>
          {chain.chain !== 'main' && (
            <p className={styles.networkNote}>
              {t(chain.chain === 'regtest' ? 'halving.regtest' : 'halving.testNetwork', {
                interval: number(schedule.interval),
              })}
            </p>
          )}
          <dl className={styles.readings}>
            <Metric
              label={t('halving.remainingBlocks')}
              value={
                schedule.nextHeight === null
                  ? t('halving.complete')
                  : number(schedule.remainingBlocks)
              }
              detail={
                schedule.nextHeight === null
                  ? t('halving.ended')
                  : t('halving.nextHeight', { height: number(schedule.nextHeight) })
              }
            />
            <Metric
              label={t('halving.currentSubsidy')}
              value={<BitcoinValue satoshis={schedule.subsidySats} />}
              detail={
                schedule.epoch === null
                  ? t('halving.noSubsidy')
                  : t('halving.epoch', { epoch: number(schedule.epoch) })
              }
            />
            <Metric
              label={t('halving.nextSubsidy')}
              value={
                schedule.nextHeight === null ? (
                  '—'
                ) : (
                  <BitcoinValue satoshis={schedule.nextSubsidySats} />
                )
              }
              detail={t('halving.excludesFees')}
            />
          </dl>
          {schedule.nextHeight !== null && (
            <>
              <div className={styles.progressLabel}>
                <span>
                  {t('halving.progress', {
                    elapsed: number(schedule.elapsed),
                    interval: number(schedule.interval),
                  })}
                </span>
                <span>{decimal(schedule.percent)}%</span>
              </div>
              <progress
                className="difficulty-progress"
                aria-label={t('halving.epochProgress')}
                max={schedule.interval}
                value={schedule.elapsed}
              />
            </>
          )}
          <p className={styles.note}>
            {t(syncing ? 'halving.syncing' : 'halving.basis', { height: number(chain.blocks) })}
          </p>
          {!syncing && chain.chain !== 'regtest' && schedule.nextHeight !== null && (
            <dl className={styles.estimate}>
              <Metric
                label={t('halving.estimatedDate')}
                value={
                  estimate === null ? (
                    '—'
                  ) : (
                    <time dateTime={new Date(estimate).toISOString()}>
                      {new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'long' }).format(
                        estimate,
                      )}
                    </time>
                  )
                }
                detail={t(estimate === null ? 'halving.timeUnavailable' : 'halving.timeBasis')}
              />
            </dl>
          )}
          <dl className={styles.issuance}>
            <Metric
              label={t('halving.issued')}
              value={bitcoinAmount(schedule.issuedSats, 8)}
              detail={t('halving.issuedPercent', { percent: decimal(schedule.issuedPercent) })}
            />
            <Metric
              label={t('halving.remainingIssuance')}
              value={bitcoinAmount(schedule.remainingSats, 8)}
            />
          </dl>
          <p className={styles.note}>
            {t('halving.limit', { amount: bitcoinAmount(schedule.limitSats, 8) })}
          </p>
          <p className={styles.note}>{t('halving.issuanceBasis')}</p>
          <details className={styles.schedule}>
            <summary>{t('halving.schedule')}</summary>
            <div
              className={styles.table}
              role="region"
              aria-label={t('halving.schedule')}
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t('halving.epochColumn')}</th>
                    <th scope="col">{t('halving.firstBlock')}</th>
                    <th scope="col">{t('halving.subsidyColumn')}</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.epochs.map((epoch) => (
                    <tr
                      key={epoch.epoch}
                      className={epoch.epoch === schedule.epoch ? styles.current : undefined}
                    >
                      <th scope="row">
                        {number(epoch.epoch)}
                        {epoch.epoch === schedule.epoch && <small>{t('halving.current')}</small>}
                      </th>
                      <td>{number(epoch.startHeight)}</td>
                      <td>{bitcoinAmount(epoch.subsidySats, 8)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </section>
  );
}
