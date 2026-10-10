import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Block } from '../types';
import { BlockTile } from './BlockTable';

// A 148px tile, its side face, and the space before the next block.
const stride = 172;

export default function VirtualBlockStrip({
  blocks,
  selectedHash,
  onSelect,
  tipHeight,
  onRangeChange,
  onBoundary,
}: {
  blocks: Block[];
  selectedHash: string | null;
  onSelect: (hash: string | null) => void;
  tipHeight: number;
  onRangeChange: (range: { start: number; end: number }) => void;
  onBoundary: (direction: 'older' | 'newer') => boolean;
}) {
  const { t } = useTranslation();
  const hint = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ hash: string; offset: number } | null>(null);
  const pendingFocus = useRef<number | null>(null);
  const [focusedHash, setFocusedHash] = useState<string | null>(null);
  const getItemKey = useCallback((index: number) => blocks[index]!.hash, [blocks]);
  const focusedIndex = blocks.findIndex((block) => block.hash === focusedHash);
  const virtualizer = useVirtualizer({
    count: blocks.length,
    horizontal: true,
    getScrollElement: () => viewport.current,
    getItemKey,
    estimateSize: () => stride,
    overscan: 4,
    rangeExtractor: (range) =>
      [
        ...new Set([...defaultRangeExtractor(range), ...(focusedIndex >= 0 ? [focusedIndex] : [])]),
      ].sort((a, b) => a - b),
  });

  const start = virtualizer.range?.startIndex ?? 0;
  const end = virtualizer.range?.endIndex ?? 0;

  useEffect(() => onRangeChange({ start, end }), [start, end, onRangeChange]);

  // Preserve the visible hash when a cursor page is prepended or evicted.
  useLayoutEffect(() => {
    const node = viewport.current;

    if (!node) return;

    anchor.current ??= { hash: blocks[0]!.hash, offset: 0 };
    const index = blocks.findIndex((block) => block.hash === anchor.current!.hash);

    if (index >= 0) node.scrollLeft = index * stride + anchor.current.offset;

    const next = blocks.findIndex((block) => block.height === pendingFocus.current);

    if (next >= 0) {
      setFocusedHash(blocks[next]!.hash);
      virtualizer.scrollToIndex(next, { align: 'auto' });
    }
  }, [blocks, virtualizer]);

  useLayoutEffect(() => {
    if (pendingFocus.current == null) return;

    const index = blocks.findIndex((block) => block.height === pendingFocus.current);
    const button = viewport.current?.querySelector<HTMLButtonElement>(
      `li[data-index="${index}"] button`,
    );

    if (button) {
      pendingFocus.current = null;
      button.focus({ preventScroll: true });
    }
  });

  function focus(index: number) {
    pendingFocus.current = blocks[index]!.height;
    setFocusedHash(blocks[index]!.hash);
    virtualizer.scrollToIndex(index, { align: 'auto' });
  }

  function traverse(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    const tile = (event.target as HTMLElement).closest<HTMLElement>('li[data-index]');

    if (!tile) return;

    const index = Number(tile.dataset.index);
    let next: number;

    if (event.key === 'ArrowRight') next = index + 1;
    else if (event.key === 'ArrowLeft') next = index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = blocks.length - 1;
    else if (event.key === 'Tab') {
      next = index + (event.shiftKey ? -1 : 1);

      if (viewport.current?.querySelector(`li[data-index="${next}"]`)) return;

      // Tab can leave the strip at its loaded boundaries; arrows continue history.
      if (next < 0 || next >= blocks.length) return;
    } else return;

    if (next < 0 || next >= blocks.length) {
      if (onBoundary(next < 0 ? 'newer' : 'older')) {
        event.preventDefault();
        pendingFocus.current = blocks[index]!.height + (next < 0 ? 1 : -1);
      }

      return;
    }

    event.preventDefault();
    focus(next);
  }

  function scroll(direction: number) {
    const index = direction < 0 ? start : end;
    const step = Math.max(1, Math.floor((viewport.current?.clientWidth ?? stride) / stride) - 1);
    virtualizer.scrollToIndex(Math.min(blocks.length - 1, Math.max(0, index + direction * step)), {
      align: direction < 0 ? 'start' : 'end',
    });

    if (direction < 0 && start === 0) onBoundary('newer');

    if (direction > 0 && end === blocks.length - 1) onBoundary('older');
  }

  return (
    <div className="block-browser">
      <div className="block-browser-toolbar">
        <p id={hint}>
          {t('blockHistory.scrollHint')}
          <span className="sr-only"> {t('blockHistory.keyboardHint')}</span>
        </p>
        <div className="block-browser-controls">
          <button
            className="icon-button"
            aria-label={t('blockHistory.newer')}
            disabled={start === 0 && blocks[0]!.height === tipHeight}
            onClick={() => scroll(-1)}
          >
            <ArrowLeft size={18} aria-hidden />
          </button>
          <button
            className="icon-button"
            aria-label={t('blockHistory.older')}
            disabled={end === blocks.length - 1 && blocks.at(-1)!.height === 0}
            onClick={() => scroll(1)}
          >
            <ArrowRight size={18} aria-hidden />
          </button>
        </div>
      </div>
      <div
        ref={viewport}
        className="block-strip virtual-block-strip"
        role="region"
        aria-label={t('blocks.strip')}
        aria-describedby={hint}
        tabIndex={0}
        onKeyDown={traverse}
        onScroll={() => {
          const node = viewport.current!;
          const index = Math.min(blocks.length - 1, Math.floor(node.scrollLeft / stride));
          anchor.current = { hash: blocks[index]!.hash, offset: node.scrollLeft - index * stride };
        }}
        onFocusCapture={(event) => {
          const tile = (event.target as HTMLElement).closest<HTMLElement>('li[data-index]');

          if (tile) setFocusedHash(blocks[Number(tile.dataset.index)]!.hash);
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setFocusedHash(null);
        }}
      >
        <ol style={{ width: virtualizer.getTotalSize() + 18 }} aria-label={t('blocks.strip')}>
          {virtualizer.getVirtualItems().map((item) => {
            const block = blocks[item.index]!;

            return (
              <li
                key={item.key}
                data-index={item.index}
                aria-posinset={tipHeight - block.height + 1}
                aria-setsize={tipHeight + 1}
                style={{ left: item.start + 3 }}
              >
                <BlockTile
                  fullTime
                  block={block}
                  tip={block.height === tipHeight}
                  selected={block.hash === selectedHash}
                  onSelect={() => onSelect(block.hash === selectedHash ? null : block.hash)}
                />
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
