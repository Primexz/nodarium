import { useTranslation } from 'react-i18next';
import { useBlockIndexStatus } from '../state';
import { decimal, number } from '../format';
import styles from './BlockIndexProgress.module.css';

export default function BlockIndexProgress() {
  const { t } = useTranslation();
  const query = useBlockIndexStatus();
  const data = query.data;

  if (!data && !query.isError) return null;

  if (data?.status === 'ready' && !data.stale && !query.isError) return null;

  const stale = query.isError || data?.stale || data?.status === 'offline';
  const state = query.isError
    ? 'unavailable'
    : data?.status === 'ready' || (data?.status === 'indexing' && data.stale)
      ? 'stale'
      : (data?.status ?? 'waiting');

  const hasProgress = data && data.target > 0 && !['waiting', 'syncing'].includes(data.status);
  const indexed = data ? Math.max(0, Math.min(data.headers, data.target)) : 0;

  return (
    <div
      className={`${styles.progress} ${stale || state === 'paused' ? styles.inactive : ''}`}
      role="group"
      aria-label={t('indexStatus.title')}
    >
      <span className={styles.label} role="status">
        {t(`indexStatus.${state}`)}
      </span>
      {hasProgress && (
        <>
          <progress
            max={data.target}
            value={indexed}
            aria-label={t(stale ? 'indexStatus.lastKnown' : 'indexStatus.progress')}
          />
          <span className={styles.count}>
            {stale && <span className="sr-only">{t('indexStatus.lastKnown')}: </span>}
            {t('indexStatus.count', {
              total: number(indexed),
              target: number(data.target),
              percent: decimal((indexed / data.target) * 100, 1),
            })}
          </span>
        </>
      )}
      {query.isError && <button onClick={() => void query.refetch()}>{t('common.retry')}</button>}
    </div>
  );
}
