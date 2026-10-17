import { useTranslation } from 'react-i18next';
import type { ProjectedBlock, MempoolProjection } from '../activity';
import { decimal, number, bytes, dateTime } from '../format';
import { useTheme } from '../theme';
import { chartPalette } from './useChart';
import { Metric, Notice } from './ui';
import { LoadingSkeleton, ProjectionSkeleton } from './Skeleton';

const capacity = 999000;

type Tile = ProjectedBlock['groups'][number];
type Rect = { x: number; y: number; width: number; height: number; tile: Tile };

// Fee bands are split into a bounded number of groups, not pretend individual
// transactions. Area represents their combined virtual size. Stable, static
// projections leave live motion to the arrivals table.
function mosaic(block: ProjectedBlock) {
  const tiles = block.groups.flatMap((g) => {
    const pieces = Math.min(g.count, 16);

    return Array.from({ length: pieces }, (_, i) => ({
      ...g,
      count: Math.floor(g.count / pieces) + (i < g.count % pieces ? 1 : 0),
      vsize: g.vsize / pieces,
    }));
  });

  const rects: Rect[] = [];
  const split = (items: Tile[], x: number, y: number, width: number, height: number) => {
    if (!items.length) return;

    if (items.length === 1) {
      rects.push({ x, y, width, height, tile: items[0]! });

      return;
    }

    const total = items.reduce((sum, item) => sum + item.vsize, 0);
    let size = 0;
    let pivot = 1;

    for (let i = 0; i < items.length - 1; i++) {
      size += items[i]!.vsize;
      pivot = i + 1;

      if (size >= total / 2) break;
    }

    const ratio = size / total;

    if (width >= height) {
      split(items.slice(0, pivot), x, y, width * ratio, height);
      split(items.slice(pivot), x + width * ratio, y, width * (1 - ratio), height);
    } else {
      split(items.slice(0, pivot), x, y, width, height * ratio);
      split(items.slice(pivot), x, y + height * ratio, width, height * (1 - ratio));
    }
  };

  const height = 220 * Math.min(1, block.vsize / capacity);
  split(tiles, 0, 220 - height, 300, height);

  return rects;
}

export default function ProjectedBlocks({
  projection,
  error,
  stopped,
  loading = !projection && !error,
}: {
  projection: MempoolProjection | null;
  error: boolean;
  stopped: boolean;
  loading?: boolean;
}) {
  const { t } = useTranslation();
  const { effective } = useTheme();
  const palette = chartPalette(effective === 'dark');
  const pending = !projection && !error && loading;

  return (
    <section className="projected-section">
      <h2>{t('activity.projectedBlocks')}</h2>
      <p className="form-note">{t('workspace.projectionSummary')}</p>
      {error && (
        <Notice error>
          {t(projection ? 'activity.projectionStale' : 'activity.projectionError')}
        </Notice>
      )}
      {pending && (
        <LoadingSkeleton label={t('activity.projectionLoading')}>
          <ProjectionSkeleton />
        </LoadingSkeleton>
      )}
      {!projection && !error && !loading && <Notice>{t('activity.waiting')}</Notice>}
      {projection && (
        <>
          <dl className="metrics-grid three projection-metrics">
            <Metric
              label={t('activity.backlog')}
              value={number(projection.count)}
              detail={t('activity.backlogSize', { size: bytes(projection.vsize) })}
            />
            <Metric
              label={t('activity.blockEquivalent')}
              value={decimal(projection.vsize / capacity)}
              detail={t('activity.capacityExplanation')}
            />
            <Metric
              label={t('activity.mempoolFeeRange')}
              value={
                projection.count
                  ? `${decimal(projection.min_rate)}–${decimal(projection.max_rate)} sat/vB`
                  : '—'
              }
              detail={t('activity.fullSnapshot')}
            />
          </dl>
          <p className="projection-updated form-note">
            {t('activity.projectionUpdated', { time: dateTime(projection.at) })}
            {stopped ? ` · ${t('activity.projectionHeld')}` : ''}
          </p>
          {projection.blocks.length ? (
            <ol
              className="projected-blocks"
              aria-label={t('activity.projectedBlocks')}
              tabIndex={0}
            >
              {projection.blocks.map((block, i) => (
                <li key={i}>
                  <h3>
                    {t(i === 0 ? 'activity.nextBlock' : 'activity.projectedPosition', {
                      position: number(i + 1),
                    })}
                  </h3>
                  <p className="projected-median">
                    {decimal(block.median_rate)} <span>sat/vB</span>
                  </p>
                  <p className="form-note">{t('activity.medianPackageRate')}</p>
                  <svg
                    className="projected-mosaic"
                    viewBox="0 0 300 220"
                    role="img"
                    aria-label={t('activity.projectionMosaic', {
                      position: number(i + 1),
                      total: number(block.count),
                      size: bytes(block.vsize),
                    })}
                  >
                    {mosaic(block).map(({ x, y, width, height, tile }, index) => (
                      <rect
                        key={index}
                        x={x + 0.75}
                        y={y + 0.75}
                        width={Math.max(0, width - 1.5)}
                        height={Math.max(0, height - 1.5)}
                        fill={
                          tile.min_rate < 5
                            ? palette.series[3]
                            : tile.min_rate < 20
                              ? palette.series[0]
                              : palette.series[2]
                        }
                      >
                        <title>
                          {t('activity.feeGroup', {
                            total: number(tile.count),
                            min: decimal(tile.min_rate),
                            max: decimal(tile.max_rate),
                          })}
                        </title>
                      </rect>
                    ))}
                  </svg>
                  <dl className="projected-readings">
                    <div>
                      <dt>{t('activity.transactions')}</dt>
                      <dd>{number(block.count)}</dd>
                    </div>
                    <div>
                      <dt>{t('activity.vsize')}</dt>
                      <dd>{bytes(block.vsize)}</dd>
                    </div>
                    <div>
                      <dt>{t('activity.effectiveRange')}</dt>
                      <dd>
                        {decimal(block.min_rate)}–{decimal(block.max_rate)} sat/vB
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ol>
          ) : (
            <Notice>
              {t(projection.count === 0 ? 'activity.emptyMempool' : 'activity.emptyProjection')}
            </Notice>
          )}
          {projection.remaining_count > 0 && (
            <p className="form-note">
              {t('activity.remainingBacklog', {
                total: number(projection.remaining_count),
                size: bytes(projection.remaining_vsize),
              })}
            </p>
          )}
          <ul className="activity-legend" aria-label={t('activity.feeRate')}>
            {[
              { label: '< 5 sat/vB', color: palette.series[3] },
              { label: '5–<20 sat/vB', color: palette.series[0] },
              { label: '≥20 sat/vB', color: palette.series[2] },
            ].map((band) => (
              <li key={band.label}>
                <span style={{ background: band.color }} aria-hidden />
                {band.label}
              </li>
            ))}
          </ul>
        </>
      )}
      <details className="projection-method">
        <summary>{t('workspace.projectionMethod')}</summary>
        <p className="form-note">{t('activity.projectionExplanation')}</p>
      </details>
    </section>
  );
}
