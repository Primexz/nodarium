import { Fragment, useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { Key, KeyboardEvent, ReactNode } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import { number } from '../format';

const controls = 'button:not(:disabled), a[href], input, select, [tabindex="0"]';

function Spacer({ height, columns }: { height: number; columns: number }) {
  return height > 0 ? (
    <tr className="virtual-spacer" aria-hidden="true">
      <td colSpan={columns} style={{ height }} />
    </tr>
  ) : null;
}

export default function VirtualTable<T>({
  rows,
  rowKey,
  renderRow,
  header,
  columns,
  label,
  className = '',
  resetKey,
  keepKey,
  estimate = 52,
  compact = false,
}: {
  rows: T[];
  rowKey: (row: T) => Key;
  renderRow: (row: T) => ReactNode;
  header: ReactNode;
  columns: number;
  label: string;
  className?: string;
  resetKey?: string;
  keepKey?: Key | null;
  estimate?: number;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const viewport = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLTableSectionElement>(null);
  const [headerHeight, setHeaderHeight] = useState(48);
  const [focusedKey, setFocusedKey] = useState<Key | null>(null);
  const pendingFocus = useRef<{ index: number; reverse: boolean } | null>(null);
  const virtual = !compact && rows.length > 50;
  const getItemKey = useCallback((index: number) => rowKey(rows[index]!), [rowKey, rows]);
  const retained = rows.flatMap((row, index) =>
    rowKey(row) === focusedKey || rowKey(row) === keepKey ? [index] : [],
  );

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count: rows.length,
    getScrollElement: () => viewport.current,
    getItemKey,
    estimateSize: () => estimate,
    enabled: virtual,
    overscan: 6,
    scrollMargin: headerHeight,
    scrollPaddingStart: headerHeight,
    rangeExtractor: (range) =>
      [...new Set([...defaultRangeExtractor(range), ...retained])].sort((a, b) => a - b),
  });

  useLayoutEffect(() => {
    const node = heading.current;

    if (!node) return;

    const measure = () => setHeaderHeight(node.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (viewport.current) viewport.current.scrollTop = 0;

    setFocusedKey(null);
    pendingFocus.current = null;
  }, [resetKey]);

  useLayoutEffect(() => {
    const pending = pendingFocus.current;

    if (!pending) return;

    const row = viewport.current?.querySelector(`[data-index="${pending.index}"]`);
    const buttons = row?.querySelectorAll<HTMLElement>(controls);
    const target = pending.reverse ? buttons?.[buttons.length - 1] : buttons?.[0];

    if (target) {
      pendingFocus.current = null;
      target.focus({ preventScroll: true });
    }
  });

  function traverse(event: KeyboardEvent<HTMLDivElement>) {
    if (!virtual || event.altKey || event.ctrlKey || event.metaKey) return;

    const target = event.target as HTMLElement;
    const row = target.closest<HTMLTableRowElement>('tr[data-index]');

    if (!row) return;

    const index = Number(row.dataset.index);
    let next: number;

    if (event.key === 'Tab') {
      const buttons = [...row.querySelectorAll<HTMLElement>(controls)];
      const boundary = event.shiftKey ? buttons[0] : buttons.at(-1);

      if (target !== boundary) return;

      next = index + (event.shiftKey ? -1 : 1);

      // Keep normal tab order whenever the adjacent row is already mounted.
      if (viewport.current?.querySelector(`[data-index="${next}"]`)) return;
    } else if (event.key === 'ArrowDown') next = index + 1;
    else if (event.key === 'ArrowUp') next = index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = rows.length - 1;
    else return;

    if (next < 0 || next >= rows.length) return;

    event.preventDefault();
    pendingFocus.current = { index: next, reverse: event.shiftKey };
    setFocusedKey(rowKey(rows[next]!));
    virtualizer.scrollToIndex(next, { align: 'auto' });
  }

  const items = virtual
    ? virtualizer.getVirtualItems()
    : rows.map((row, index) => ({ index, key: rowKey(row), start: 0, end: 0 }));

  let previousEnd = 0;

  return (
    <>
      <div
        ref={viewport}
        className={`table-scroll virtual-table-scroll ${compact ? 'compact-table-scroll' : ''}`}
        role="region"
        aria-label={label}
        tabIndex={rows.length ? 0 : undefined}
        onKeyDown={traverse}
        onFocusCapture={(event) => {
          const row = (event.target as HTMLElement).closest<HTMLTableRowElement>('tr[data-index]');

          if (row) setFocusedKey(rowKey(rows[Number(row.dataset.index)]!));
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setFocusedKey(null);
        }}
      >
        <table className={className} aria-label={label} aria-rowcount={rows.length + 1}>
          <thead ref={heading}>
            <tr aria-rowindex={1}>{header}</tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const gap = virtual ? item.start - headerHeight - previousEnd : 0;
              previousEnd = item.end - headerHeight;

              return (
                <Fragment key={item.key}>
                  <Spacer height={gap} columns={columns} />
                  <tr
                    data-index={item.index}
                    aria-rowindex={item.index + 2}
                    ref={virtual ? virtualizer.measureElement : undefined}
                  >
                    {renderRow(rows[item.index]!)}
                  </tr>
                </Fragment>
              );
            })}
            {virtual && (
              <Spacer height={virtualizer.getTotalSize() - previousEnd} columns={columns} />
            )}
          </tbody>
        </table>
      </div>
      {!compact && rows.length > 0 && (
        <div className="table-scroll-note">
          <span>{t('tables.rows', { count: rows.length, total: number(rows.length) })}</span>
          <span>{t('tables.scroll')}</span>
        </div>
      )}
    </>
  );
}
