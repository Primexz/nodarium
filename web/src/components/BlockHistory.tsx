import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { api, APIError } from '../api';
import type { Block, BlockHistoryPage, BlockIndexStatus, IndexedBlock } from '../types';
import { number } from '../format';
import { BlockDetails } from './BlockTable';
import VirtualBlockStrip from './VirtualBlockStrip';
import { Empty, Notice, SectionHeading } from './ui';

type PageParam = { cursor?: string; height?: number };

class BackfillPending extends Error {}

export default function BlockHistory({
  selectedHash,
  onSelect,
  recent,
  stale,
  tipHeight,
}: {
  selectedHash: string | null;
  onSelect: (hash: string | null) => void;
  recent: Block[];
  stale: boolean;
  tipHeight?: number;
}) {
  const { t } = useTranslation();
  const [startHeight, setStartHeight] = useState<number>();
  const [generation, setGeneration] = useState(0);
  const [heightInput, setHeightInput] = useState('');
  const [heightError, setHeightError] = useState(false);
  const detailPanel = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!selectedHash) return;

    const previous = document.activeElement;
    const panel = detailPanel.current;
    panel?.focus({ preventScroll: true });
    panel?.scrollIntoView({ block: 'nearest', behavior: 'instant' });

    return () => {
      if (
        panel?.contains(document.activeElement) &&
        previous instanceof HTMLElement &&
        previous.isConnected
      )
        previous.focus({ preventScroll: true });
    };
  }, [selectedHash]);

  const visible = useRef({ start: 0, end: 0 });
  const status = useQuery({
    queryKey: ['node', 'block-index'],
    queryFn: ({ signal }) => api<BlockIndexStatus>('blocks/index', { signal }),
    refetchInterval: 5000,
  });

  const history = useInfiniteQuery({
    queryKey: ['node', 'block-history', startHeight ?? 'tip', generation],
    initialPageParam: { height: startHeight } as PageParam,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '50' });

      if (pageParam.cursor) params.set('cursor', pageParam.cursor);

      if (pageParam.height != null) params.set('start_height', String(pageParam.height));

      const page = await api<BlockHistoryPage>(`blocks/history?${params}`, { signal });

      if (pageParam.cursor && !page.blocks.length && page.backfill_pending)
        throw new BackfillPending();

      return page;
    },
    getNextPageParam: (last) => (last.older_cursor ? { cursor: last.older_cursor } : undefined),
    getPreviousPageParam: (first) =>
      first.newer_cursor ? { cursor: first.newer_cursor } : undefined,
    maxPages: 10,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => (query.state.data?.pages[0]?.blocks.length ? false : 5000),
  });

  const pages = history.data?.pages;
  const blocks = useMemo(() => pages?.flatMap((page) => page.blocks) ?? [], [pages]);
  const anchorHeight = pages?.[0]?.anchor_height ?? tipHeight ?? 0;
  const selected = useQuery({
    queryKey: ['node', 'indexed-block', selectedHash],
    queryFn: ({ signal }) => api<IndexedBlock>(`blocks/${selectedHash}`, { signal }),
    enabled: !!selectedHash,
    initialData: (): IndexedBlock | undefined => {
      const block = recent.find((block) => block.hash === selectedHash);

      return block
        ? { ...block, pool: { status: 'unavailable', pool: null }, stale, updated_at: null }
        : undefined;
    },
    retry: false,
    refetchInterval: 10000,
  });

  const inactive = selected.error instanceof APIError && selected.error.status === 409;
  const cursorExpired = history.error instanceof APIError && history.error.status === 409;
  const pending = history.error instanceof BackfillPending;
  const failed = history.isError;
  const indexedHeaders = status.data?.headers;
  const frontierAttempt = useRef<number | undefined>(undefined);

  const {
    isFetching,
    isFetchingNextPage,
    isFetchingPreviousPage,
    hasNextPage,
    hasPreviousPage,
    fetchNextPage,
    fetchPreviousPage,
  } = history;

  const load = useCallback(
    (direction: 'older' | 'newer') => {
      if (isFetching) return direction === 'older' ? isFetchingNextPage : isFetchingPreviousPage;

      if (cursorExpired || (failed && !pending)) return false;

      if (direction === 'older' && pending && frontierAttempt.current === indexedHeaders)
        return false;

      frontierAttempt.current = indexedHeaders;

      if (direction === 'older' && hasNextPage) {
        void fetchNextPage();

        return true;
      }

      if (direction === 'newer' && hasPreviousPage) {
        void fetchPreviousPage();

        return true;
      }

      return false;
    },
    [
      isFetching,
      isFetchingNextPage,
      isFetchingPreviousPage,
      hasNextPage,
      hasPreviousPage,
      fetchNextPage,
      fetchPreviousPage,
      cursorExpired,
      failed,
      pending,
      indexedHeaders,
    ],
  );

  const rangeChanged = useCallback(
    (range: { start: number; end: number }) => {
      visible.current = range;

      if (range.end >= blocks.length - 12) load('older');
      else if (range.start < 12) load('newer');
    },
    [blocks.length, load],
  );

  useEffect(() => {
    if (visible.current.end >= blocks.length - 12) load('older');
  }, [status.data?.headers, blocks.length, load]);

  function restart(height?: number) {
    setStartHeight(height);
    setGeneration((value) => value + 1);
  }

  return (
    <>
      <section className="panel block-history">
        <SectionHeading title={t('blockHistory.title')} subtitle={t('blockHistory.description')}>
          <form
            className="block-height-form"
            onSubmit={(event) => {
              event.preventDefault();
              const height = Number(heightInput);

              if (
                !/^\d+$/.test(heightInput) ||
                !Number.isSafeInteger(height) ||
                height < 0 ||
                (tipHeight != null && height > tipHeight)
              ) {
                setHeightError(true);

                return;
              }

              setHeightError(false);
              restart(height);
            }}
          >
            <label htmlFor="block-height">{t('blockHistory.jump')}</label>
            <input
              id="block-height"
              inputMode="numeric"
              value={heightInput}
              aria-invalid={heightError}
              aria-describedby={heightError ? 'block-height-error' : undefined}
              onChange={(event) => {
                setHeightInput(event.target.value);
                setHeightError(false);
              }}
            />
            <button type="submit">{t('blockHistory.go')}</button>
          </form>
        </SectionHeading>
        {heightError && (
          <p id="block-height-error" role="alert">
            {t('blockHistory.invalidHeight')}
          </p>
        )}
        {status.data && status.data.status !== 'ready' && (
          <Notice error={status.data.status === 'paused' || status.data.status === 'offline'}>
            {t(`blockHistory.${status.data.status}`, {
              total: number(status.data.headers),
              target: number(status.data.target),
            })}
          </Notice>
        )}
        {status.data && status.data.pruned > 0 && (
          <p className="block-explanation">{t('blockHistory.pruned')}</p>
        )}
        {(tipHeight ?? 0) > anchorHeight && blocks.length > 0 && (
          <button className="history-new-blocks" onClick={() => restart()}>
            {t('blockHistory.newBlocks', { total: number((tipHeight ?? 0) - anchorHeight) })}
          </button>
        )}
        {history.isPending && <Notice>{t('blockHistory.loading')}</Notice>}
        {history.isError && !pending && (
          <Notice error>
            {t(cursorExpired ? 'blockHistory.reorg' : 'blockHistory.error')}
            <button
              onClick={() =>
                cursorExpired
                  ? restart(blocks[visible.current.start]?.height)
                  : void history.refetch()
              }
            >
              {t('common.retry')}
            </button>
          </Notice>
        )}
        {!!blocks.length && (
          <VirtualBlockStrip
            key={`${startHeight ?? 'tip'}:${generation}`}
            blocks={blocks}
            selectedHash={selectedHash}
            onSelect={onSelect}
            tipHeight={tipHeight ?? anchorHeight}
            onRangeChange={rangeChanged}
            onBoundary={load}
          />
        )}
        {isFetchingNextPage || isFetchingPreviousPage ? (
          <p role="status" className="table-scroll-note">
            {t('blockHistory.loading')}
          </p>
        ) : (
          pending && (
            <p role="status" className="table-scroll-note">
              {t('blockHistory.frontier')}
            </p>
          )
        )}
        {!history.isPending && !history.isError && !blocks.length && (
          <Empty title={t('blocks.empty')} description={t('blockHistory.notIndexed')} />
        )}
      </section>
      {selectedHash && (
        <section
          ref={detailPanel}
          tabIndex={-1}
          className="panel selected-block-panel"
          aria-label={t('blockHistory.selected')}
        >
          <div className="block-detail-heading">
            <h2>{t('blockHistory.selected')}</h2>
            <button
              className="icon-button"
              aria-label={t('goggles.close')}
              onClick={() => onSelect(null)}
            >
              <X size={18} />
            </button>
          </div>
          {selected.isPending && <Notice>{t('blockHistory.loadingDetails')}</Notice>}
          {inactive && <Notice error>{t('goggles.inactive')}</Notice>}
          {selected.isError && !inactive && !selected.data && (
            <Notice error>
              {t('blockHistory.detailsUnavailable')}
              <button onClick={() => void selected.refetch()}>{t('common.retry')}</button>
            </Notice>
          )}
          {selected.data && !inactive && (
            <BlockDetails
              block={selected.data}
              stale={stale || selected.isError || selected.data.stale}
            />
          )}
        </section>
      )}
    </>
  );
}
