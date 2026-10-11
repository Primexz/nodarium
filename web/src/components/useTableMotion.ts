import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Key, RefObject } from 'react';

// Only mounted rows move. Retarget from the current painted position so a
// second SSE arrival continues the slide rather than restarting it.
export function useTableMotion<T>(
  viewport: RefObject<HTMLDivElement | null>,
  rows: T[],
  rowKey: (row: T) => Key,
  enabled: boolean,
  active: boolean,
  resetKey?: string,
) {
  const previous = useRef(new Map<string, number>());
  const known = useRef(new Set<string>());
  const initialized = useRef(false);
  const animations = useRef(new Map<Element, Animation>());

  useEffect(() => {
    if (!active) return;

    const node = viewport.current;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const settle = () => {
      animations.current.forEach((animation) => animation.cancel());
      animations.current.clear();
      previous.current.clear();
    };

    node?.addEventListener('scroll', settle, { passive: true });
    media.addEventListener('change', settle);

    return () => {
      node?.removeEventListener('scroll', settle);
      media.removeEventListener('change', settle);
      settle();
    };
  }, [viewport, active]);

  useLayoutEffect(() => {
    initialized.current = false;
    previous.current.clear();
    known.current.clear();
    animations.current.forEach((animation) => animation.cancel());
    animations.current.clear();
  }, [resetKey]);

  useLayoutEffect(() => {
    if (!active) return;

    const node = viewport.current;

    if (!node) return;

    const canMove =
      enabled && node.clientHeight > 0 && !matchMedia('(prefers-reduced-motion: reduce)').matches;

    const next = new Map<string, number>();
    const measurements = [...node.querySelectorAll<HTMLTableRowElement>('tr[data-row-key]')].map(
      (row) => {
        const transform = getComputedStyle(row).transform;
        const y = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42;
        const top = row.getBoundingClientRect().top - node.getBoundingClientRect().top - y;
        const key = row.dataset.rowKey!;
        next.set(key, top);

        return {
          row,
          key,
          top,
          y,
          height: row.getBoundingClientRect().height,
          clip: getComputedStyle(row).clipPath,
        };
      },
    );

    // Reveal each new group from its insertion boundary. The rows and their
    // rules travel together, without painting over the rows ahead of them.
    const entries = new Map<string, { shift: number; clip: number; endClip: number }>();
    let shift = 0;

    for (let i = 0; i < measurements.length;) {
      const item = measurements[i]!;

      if (!initialized.current || known.current.has(item.key)) {
        shift = (previous.current.get(item.key) ?? item.top) - item.top;
        i++;
        continue;
      }

      let end = i;
      let height = 0;

      while (end < measurements.length && !known.current.has(measurements[end]!.key)) {
        height += measurements[end]!.height;
        end++;
      }

      shift -= height;
      let offset = 0;

      for (; i < end; i++) {
        const item = measurements[i]!;
        entries.set(item.key, { shift, clip: height - offset, endClip: -offset });
        offset += item.height;
      }
    }

    for (const { row, key, top, y, clip } of measurements) {
      const before = previous.current.get(key);
      const incoming = initialized.current && !known.current.has(key);
      const moved = before != null && Math.abs(before - top) > 0.5;

      if (!canMove || !row.animate) {
        animations.current.get(row)?.cancel();
        animations.current.delete(row);
      } else if (incoming || moved) {
        animations.current.get(row)?.cancel();
        const entry = entries.get(key);
        const animation = row.animate(
          [
            {
              transform: entry
                ? `translate(-28px, ${entry.shift}px)`
                : `translateY(${before! + y - top}px)`,
              clipPath: entry ? `inset(${entry.clip}px 0 0)` : clip,
            },
            {
              transform: 'translate(0, 0)',
              clipPath: entry ? `inset(${entry.endClip}px 0 0)` : 'inset(0px 0 0)',
            },
          ],
          { duration: 380, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
        );

        animations.current.set(row, animation);
        animation.onfinish = () => {
          if (animations.current.get(row) === animation) animations.current.delete(row);
        };
      }
    }

    for (const [row, animation] of animations.current) {
      if (!row.isConnected) {
        animation.cancel();
        animations.current.delete(row);
      }
    }

    previous.current = next;
    known.current = new Set(rows.map((row) => String(rowKey(row))));
    initialized.current = rows.length > 0;
  });
}
