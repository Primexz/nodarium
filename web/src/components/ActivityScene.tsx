import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme';
import { chartPalette } from './useChart';
import type { ActivityLive, ActivityTransaction } from '../activity';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Tile extends Rect {
  tx: ActivityTransaction;
  alpha: number;
}

// Binary treemap: area is proportional to vsize. Pending metadata uses a neutral
// placeholder weight and is identified separately in the readable table.
function layout(txs: ActivityTransaction[], rect: Rect, result: Map<string, Tile>) {
  if (!txs.length) return;

  if (txs.length === 1) {
    result.set(txs[0].txid, { ...rect, tx: txs[0], alpha: 1 });

    return;
  }

  const weight = (tx: ActivityTransaction) => tx.vsize ?? 150;
  const total = txs.reduce((sum, tx) => sum + weight(tx), 0);
  let sum = 0;
  let split = 1;

  for (let i = 0; i < txs.length - 1; i++) {
    sum += weight(txs[i]);
    split = i + 1;

    if (sum >= total / 2) break;
  }

  const ratio = sum / total;

  if (rect.width >= rect.height) {
    const width = rect.width * ratio;
    layout(txs.slice(0, split), { ...rect, width }, result);
    layout(txs.slice(split), { ...rect, x: rect.x + width, width: rect.width - width }, result);
  } else {
    const height = rect.height * ratio;
    layout(txs.slice(0, split), { ...rect, height }, result);
    layout(txs.slice(split), { ...rect, y: rect.y + height, height: rect.height - height }, result);
  }
}

export default function ActivityScene({ live, paused }: { live: ActivityLive; paused: boolean }) {
  const { t } = useTranslation();
  const { effective } = useTheme();
  const canvas = useRef<HTMLCanvasElement>(null);
  const update = useRef<((live: ActivityLive, paused: boolean) => void) | null>(null);

  useLayoutEffect(() => {
    const node = canvas.current;
    const context = node?.getContext('2d');

    if (!node || !context) return;

    const palette = chartPalette(effective === 'dark');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let painted = new Map<string, Tile>();
    let current = painted;
    let target = new Map<string, Tile>();
    let started = performance.now();
    let settled = false;
    let generation: number | null = null;
    let reading: { live: ActivityLive; paused: boolean } | null = null;
    let width = 0;
    let height = 0;

    function paint(now: number) {
      const progress = settled || reduced.matches ? 1 : Math.min(1, (now - started) / 800);
      const ease = 1 - (1 - progress) ** 4;
      context!.clearRect(0, 0, width, height);
      const next = new Map<string, Tile>();

      for (const [id, tile] of target) {
        const from = current.get(id) ?? { ...tile, y: tile.y - 30, alpha: 0 };
        const value = { ...tile };

        for (const key of ['x', 'y', 'width', 'height', 'alpha'] as const)
          value[key] = from[key] + (tile[key] - from[key]) * ease;

        next.set(id, value);
        context!.globalAlpha = value.alpha;
        context!.fillStyle =
          tile.tx.vsize == null || tile.tx.fee_rate == null
            ? palette.land
            : tile.tx.fee_rate < 5
              ? palette.series[3]
              : tile.tx.fee_rate < 20
                ? palette.series[0]
                : palette.series[2];

        context!.fillRect(
          value.x + 1,
          value.y + 1,
          Math.max(0, value.width - 2),
          Math.max(0, value.height - 2),
        );
      }

      context!.globalAlpha = 1;
      painted = next;
      frame = 0;

      if (progress < 1) frame = requestAnimationFrame(paint);
    }

    function retarget(live: ActivityLive, paused: boolean, resized = false) {
      const next = new Map<string, Tile>();
      const mobile = width < 600;
      const waiting = mobile
        ? { x: 0, y: 0, width, height: height * 0.58 }
        : { x: 0, y: 0, width: width * 0.66, height };

      const block = mobile
        ? { x: 0, y: height * 0.65, width, height: height * 0.35 }
        : { x: width * 0.73, y: 0, width: width * 0.27, height };

      const sort = (txs: ActivityTransaction[]) =>
        [...txs].sort((a, b) => a.txid.localeCompare(b.txid));

      layout(sort(live.transactions), waiting, next);
      layout(sort(live.block?.transactions ?? []), block, next);

      const unchanged =
        next.size === target.size &&
        [...next].every(([id, tile]) => {
          const old = target.get(id);

          return (
            old &&
            tile.x === old.x &&
            tile.y === old.y &&
            tile.width === old.width &&
            tile.height === old.height &&
            tile.tx.vsize === old.tx.vsize &&
            tile.tx.fee_rate === old.tx.fee_rate
          );
        });

      const reset = generation !== live.generation;

      // Counts and timestamps update much more often than the sampled mosaic.
      // Leave an in-flight animation alone when its destination hasn't changed.
      if (unchanged && !reset && !resized && !paused) return;

      cancelAnimationFrame(frame);
      current = reset ? new Map() : painted;
      target = next;
      generation = live.generation;
      settled = paused || reset || resized;
      started = performance.now();
      // Paint synchronously: a resized backing store must never reach the screen blank.
      paint(started);
    }

    function resize() {
      const nextWidth = node!.clientWidth;
      const nextHeight = node!.clientHeight;
      const scale = Math.min(2, devicePixelRatio || 1);
      const pixelsWide = Math.round(nextWidth * scale);
      const pixelsHigh = Math.round(nextHeight * scale);

      if (
        width === nextWidth &&
        height === nextHeight &&
        node!.width === pixelsWide &&
        node!.height === pixelsHigh
      )
        return;

      width = nextWidth;
      height = nextHeight;

      if (node!.width !== pixelsWide) node!.width = pixelsWide;

      if (node!.height !== pixelsHigh) node!.height = pixelsHigh;

      context!.setTransform(scale, 0, 0, scale, 0, 0);

      if (reading) retarget(reading.live, reading.paused, true);
    }

    function motionChanged() {
      if (reading) retarget(reading.live, reading.paused, true);
    }

    update.current = (live, paused) => {
      reading = { live, paused };
      resize();
      retarget(live, paused);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(node);
    reduced.addEventListener('change', motionChanged);
    resize();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      reduced.removeEventListener('change', motionChanged);
      update.current = null;
    };
  }, [effective]);

  useLayoutEffect(() => {
    update.current?.(live, paused);
  }, [live, paused, effective]);

  return (
    <canvas ref={canvas} className="activity-canvas" aria-label={t('activity.scene')} role="img" />
  );
}
