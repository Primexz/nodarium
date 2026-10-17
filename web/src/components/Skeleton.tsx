import type { ReactNode } from 'react';

type SkeletonProps = { className?: string };

export function Skeleton({ className = '' }: SkeletonProps) {
  return <span className={`skeleton ${className}`.trim()} aria-hidden="true" />;
}

export function LoadingSkeleton({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="loading-skeleton">
      <span className="sr-only" role="status">
        {label}
      </span>
      <div aria-hidden="true" aria-busy="true">
        {children}
      </div>
    </div>
  );
}

export function MetricsSkeleton({ count = 3, className = '' }: SkeletonProps & { count?: number }) {
  const layout = className.split(' ').includes('fee-readings') ? '' : 'metrics-grid';
  const columns = count === 2 ? 'two' : count === 3 ? 'three' : count === 6 ? 'node-metrics' : '';

  return (
    <div className={`${layout} ${columns} metrics-skeleton ${className}`.trim()} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div className="metric" key={i}>
          <Skeleton className="skeleton-label" />
          <div className="skeleton-reading">
            <Skeleton className="skeleton-value" />
            <Skeleton className="skeleton-detail" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton() {
  return (
    <div className="table-skeleton" aria-hidden="true">
      {Array.from({ length: 6 }, (_, row) => (
        <div className="skeleton-table-row" key={row}>
          {Array.from({ length: 4 }, (_, column) => (
            <Skeleton key={column} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="chart-skeleton" aria-hidden="true">
      <div className="skeleton-chart-labels">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
      <div className="skeleton-chart-plot">
        <span />
        <span />
        <span />
      </div>
      <div className="skeleton-chart-ticks">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    </div>
  );
}

export function ProjectionSkeleton() {
  return (
    <div className="projection-skeleton" aria-hidden="true">
      <MetricsSkeleton className="projection-metrics" />
      <Skeleton className="skeleton-updated projection-updated" />
      <div className="projected-blocks">
        {Array.from({ length: 4 }, (_, block) => (
          <div key={block}>
            <Skeleton className="skeleton-block-title" />
            <Skeleton className="skeleton-value" />
            <Skeleton className="skeleton-detail" />
            <div className="skeleton-mosaic">
              {Array.from({ length: 8 }, (_, tile) => (
                <Skeleton key={tile} />
              ))}
            </div>
            {Array.from({ length: 3 }, (_, row) => (
              <div className="skeleton-projected-reading" key={row}>
                <Skeleton />
                <Skeleton />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
