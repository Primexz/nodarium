import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Pause, Play, X } from 'lucide-react';
import { api } from '../api';
import {
  useActivity,
  type ActivityEvent,
  type ActivityPage,
  type ActivityTransaction,
} from '../activity';
import { number, decimal, dateTime, shortHash, bitcoinAmount } from '../format';
import { Notice, Empty, Metric } from '../components/ui';
import VirtualTable from '../components/VirtualTable';
import ProjectedBlocks from '../components/ProjectedBlocks';
import BlockGoggles from '../components/BlockGoggles';

const eventKey = (event: ActivityEvent) => event.id;
const transactionKey = (tx: ActivityTransaction) => tx.txid;

export default function Activity() {
  const { t } = useTranslation();
  const [view, setView] = useState<'live' | 'timeline'>('live');
  const [paused, setPaused] = useState(false);
  const [kind, setKind] = useState('');
  const [generation, setGeneration] = useState(0);
  const detailPanel = useRef<HTMLElement>(null);
  const [acknowledged, setAcknowledged] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const { live, connected, updates, visible } = useActivity(view, paused);
  const readyTransactions = useMemo(
    () =>
      live?.transactions.filter(
        (tx) => tx.output_sats != null && tx.vsize != null && tx.fee_rate != null,
      ) ?? [],
    [live?.transactions],
  );

  const pendingTransactions = (live?.transactions.length ?? 0) - readyTransactions.length;
  const history = useInfiniteQuery({
    queryKey: ['activity', 'events', kind, generation],
    queryFn: ({ pageParam, signal }) =>
      api<ActivityPage>(
        `activity/events?kind=${kind}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        { signal },
      ),
    initialPageParam: '',
    getNextPageParam: (page) => page.cursor || undefined,
    getPreviousPageParam: () => undefined,
    maxPages: 10,
    enabled: view === 'timeline',
  });

  const events = useMemo(
    () => history.data?.pages.flatMap((page) => page.events) ?? [],
    [history.data],
  );

  const loadOlder = useCallback(
    ({ end }: { start: number; end: number }) => {
      if (
        end >= events.length - 5 &&
        history.hasNextPage &&
        !history.isFetchingNextPage &&
        !history.isFetchNextPageError
      )
        void history.fetchNextPage();
    },
    [events.length, history],
  );

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  useLayoutEffect(() => {
    if (!selected) return;

    const previous = document.activeElement;
    const panel = detailPanel.current;
    panel?.focus({ preventScroll: true });
    panel?.scrollIntoView({ block: 'nearest', behavior: 'instant' });

    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, [selected]);

  function eventText(event: ActivityEvent) {
    if (event.kind === 'connection')
      return t('activity.connectionEvent', { status: t(`status.${event.status ?? 'connecting'}`) });

    if (event.kind === 'reorg')
      return t('activity.reorgEvent', {
        height: number(event.height),
        depth: event.depth == null ? t('activity.unknown') : number(event.depth),
      });

    return t('activity.blockEvent', { height: number(event.height) });
  }

  return (
    <main id="content" className="page-content activity-page" tabIndex={-1}>
      <div className="page-heading">
        <h1>{t('activity.title')}</h1>
        <p>{t('activity.description')}</p>
      </div>
      <div className="activity-controls">
        <div className="segmented" role="group" aria-label={t('activity.view')}>
          {(['live', 'timeline'] as const).map((tab) => (
            <button
              key={tab}
              aria-pressed={view === tab}
              onClick={() => {
                setView(tab);
                setSelected(null);
              }}
            >
              {t(`activity.${tab}`)}
            </button>
          ))}
        </div>
        <div className="activity-source" role="status">
          <span className={`status-dot ${connected ? '' : 'offline'}`} />
          {paused && view === 'live'
            ? t('activity.paused')
            : !connected
              ? t('activity.reconnecting')
              : live?.source === 'zmq'
                ? t('activity.zmq')
                : t('activity.rpc')}
        </div>
        {view === 'live' && (
          <button onClick={() => setPaused(!paused)}>
            {paused ? <Play size={16} aria-hidden /> : <Pause size={16} aria-hidden />}
            {t(paused ? 'activity.resume' : 'activity.pause')}
          </button>
        )}
      </div>
      {(live?.persistence_error || history.data?.pages.some((p) => p.persistence_error)) && (
        <Notice error>{t('activity.persistenceError')}</Notice>
      )}
      {view === 'live' ? (
        <>
          {live && live.status !== 'ready' && <Notice>{t(`activity.${live.status}`)}</Notice>}
          {!live && <Notice>{t('activity.waiting')}</Notice>}
          <ProjectedBlocks
            projection={live?.projection ?? null}
            error={live?.projection_error ?? false}
            stopped={paused || !visible || !connected}
          />
          {live?.block && (
            <button className="activity-block-link" onClick={() => setSelected(live.block!.hash)}>
              {t('activity.inspectBlock', { height: number(live.block.height) })}
            </button>
          )}
          <dl className="activity-metrics metrics-grid two">
            <Metric
              label={t('activity.arrivals')}
              value={live ? number(live.arrivals) : '—'}
              detail={t('activity.sinceBaseline')}
            />
            <Metric
              label={t('activity.sampleCount')}
              value={live ? number(live.transactions.length) : '—'}
              detail={t('activity.sampleLimit')}
            />
          </dl>
          <p className="form-note">{t('activity.sampleExplanation')}</p>
          <section>
            <h2>{t('activity.sampleDetails')}</h2>
            <p className="form-note">{t('activity.amountNote')}</p>
            <p className="form-note">
              {t('activity.metadataWaiting', {
                count: pendingTransactions,
                total: number(pendingTransactions),
              })}
            </p>
            <VirtualTable
              rows={readyTransactions}
              liveRows
              animateRows={!paused && visible && connected}
              resetKey={String(live?.generation ?? 0)}
              rowKey={transactionKey}
              columns={4}
              label={t('activity.sampleDetails')}
              className="activity-transactions-table"
              header={
                <>
                  <th>{t('activity.amount')}</th>
                  <th>{t('activity.transaction')}</th>
                  <th>{t('activity.vsize')}</th>
                  <th>{t('activity.feeRate')}</th>
                </>
              }
              renderRow={(tx) => (
                <>
                  <td
                    className="activity-amount"
                    title={tx.output_sats == null ? t('activity.pending') : undefined}
                  >
                    {bitcoinAmount(tx.output_sats, 8)}
                  </td>
                  <td className="mono activity-txid" title={tx.txid}>
                    {tx.txid}
                  </td>
                  <td>{tx.vsize == null ? t('activity.pending') : `${number(tx.vsize)} vB`}</td>
                  <td>{tx.fee_rate == null ? '—' : `${decimal(tx.fee_rate)} sat/vB`}</td>
                </>
              )}
            />
          </section>
        </>
      ) : (
        <section className="activity-timeline">
          <div className="activity-controls">
            <label>
              {t('activity.category')}
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  setAcknowledged(updates);
                }}
              >
                <option value="">{t('activity.all')}</option>
                <option value="connection">{t('activity.connections')}</option>
                <option value="block">{t('activity.blocks')}</option>
                <option value="reorg">{t('activity.reorgs')}</option>
              </select>
            </label>
            {updates > acknowledged && (
              <button
                onClick={() => {
                  setAcknowledged(updates);
                  setGeneration((n) => n + 1);
                }}
              >
                {t('activity.newEvents')}
              </button>
            )}
          </div>
          <p className="form-note">{t('activity.retention')}</p>
          {history.isPending && <Notice>{t('activity.loading')}</Notice>}
          {history.isError && !history.isFetchNextPageError && (
            <Notice error>
              {t('activity.historyError')}{' '}
              <button onClick={() => void history.refetch()}>{t('common.retry')}</button>
            </Notice>
          )}
          {!history.isPending && !history.isError && !events.length && (
            <Empty title={t('activity.emptyHistory')} />
          )}
          {!!events.length && (
            <VirtualTable
              rows={events}
              rowKey={eventKey}
              columns={3}
              label={t('activity.timeline')}
              className="activity-events-table"
              resetKey={`${kind}:${generation}`}
              onRangeChange={loadOlder}
              header={
                <>
                  <th>{t('activity.observedAt')}</th>
                  <th>{t('activity.event')}</th>
                  <th>{t('activity.block')}</th>
                </>
              }
              renderRow={(event) => (
                <>
                  <td>{dateTime(event.at)}</td>
                  <td>{eventText(event)}</td>
                  <td>
                    {event.hash ? (
                      <button
                        className="table-link"
                        title={event.hash}
                        onClick={() => setSelected(event.hash!)}
                      >
                        {shortHash(event.hash)}
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                </>
              )}
            />
          )}
          {history.isFetchingNextPage && <Notice>{t('activity.loading')}</Notice>}
          {history.isFetchNextPageError && (
            <Notice error>
              {t('activity.historyError')}{' '}
              <button onClick={() => void history.fetchNextPage()}>{t('common.retry')}</button>
            </Notice>
          )}
        </section>
      )}
      {selected && (
        <section
          ref={detailPanel}
          tabIndex={-1}
          className="panel selected-block-panel"
          aria-label={t('activity.block')}
        >
          <div className="panel-heading">
            <h2>{t('activity.block')}</h2>
            <button
              className="icon-button"
              aria-label={t('activity.close')}
              onClick={() => setSelected(null)}
            >
              <X size={18} />
            </button>
          </div>
          <BlockGoggles hash={selected} />
        </section>
      )}
    </main>
  );
}
