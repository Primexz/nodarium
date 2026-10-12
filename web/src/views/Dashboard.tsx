import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation } from 'react-router';
import type { Readings } from '../state';
import { historyRanges } from '../types';
import { useRememberedRange } from '../useRememberedRange';
import HistoryRangePicker from '../components/HistoryRangePicker';
import Activity from './Activity';
import { message } from '../i18n';
import { bytes, duration, fee, number, decimal, dateTime } from '../format';
import { Metric, Notice, SectionHeading, Empty } from '../components/ui';
import HistoryChart from '../components/HistoryChart';
import PeerMap from '../components/PeerMap';
import PeerCountries from '../components/PeerCountries';
import DifficultyPeriod from '../components/DifficultyPeriod';
import MiningCharts from '../components/MiningCharts';
import MiningPools from '../components/MiningPools';
import PoolHistory from '../components/PoolHistory';
import FeeEstimates, { FeeHistory } from '../components/FeeEstimates';
import BlockEconomics from '../components/BlockEconomics';
import PeerTable from '../components/PeerTable';
import BlockHistory from '../components/BlockHistory';
import { ShieldCheck } from 'lucide-react';
import { BitcoinValue } from '../fiat';

const views = {
  mempool: ['live', 'trends'],
  blocks: ['explorer', 'analytics'],
  mining: ['network', 'pools'],
  node: ['overview', 'peers', 'traffic', 'events'],
} as const;

type Destination = keyof typeof views;

export default function Dashboard({
  page: destination,
  node,
}: {
  page: Destination;
  node: Readings;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const requestedView = location.pathname.split('/')[2];
  const view = views[destination].find((item) => item === requestedView) ?? views[destination][0];
  const page =
    destination === 'node'
      ? view === 'overview'
        ? 'node'
        : view
      : destination === 'mining' && view === 'pools'
        ? 'pools'
        : destination;

  const [blockHash, setBlockHash] = useState<string | null>(null);
  const mempoolRange = useRememberedRange('mempool', historyRanges, '24h');
  const peerRange = useRememberedRange('peers', historyRanges, '24h');
  const trafficRange = useRememberedRange('traffic', historyRanges, '24h');
  const miningRange = useRememberedRange('mining', historyRanges, '24h');
  const [range, setRange] =
    page === 'mempool'
      ? mempoolRange
      : page === 'peers'
        ? peerRange
        : page === 'traffic'
          ? trafficRange
          : miningRange;

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [destination, view]);

  const overview = node.overview?.overview.data;
  const database = node.overview?.database;
  const chain = overview?.blockchain;
  const network = overview?.network;
  const traffic = node.traffic.data;
  const mempool = node.mempool.data;
  const latest = node.blocks.data?.[0];

  const progress = Math.min(100, (chain?.verificationprogress ?? 0) * 100);
  const synced = chain && !chain.initialblockdownload && chain.blocks >= chain.headers;

  const warnings = [chain?.warnings, network?.warnings]
    .flat()
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);

  const counts: Record<string, number> = {};
  node.peers.data?.forEach((p) => (counts[p.network] = (counts[p.network] ?? 0) + 1));
  const mix = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const section =
    page === 'peers'
      ? node.peers
      : page === 'traffic'
        ? node.traffic
        : page === 'mempool'
          ? node.mempool
          : page === 'blocks'
            ? node.blocks
            : node.overview?.overview;

  const historyTitle =
    page === 'mining'
      ? 'mining.title'
      : page === 'peers'
        ? 'history.connections'
        : page === 'mempool'
          ? 'history.mempool'
          : 'history.bandwidth';

  return (
    <main id="content" className="page-content" tabIndex={-1}>
      <div className="page-heading">
        <h1>{t(`nav.${destination}`)}</h1>
        <p>{t(`workspace.${view}Description`)}</p>
      </div>
      <nav className="view-navigation" aria-label={t('workspace.views')}>
        {views[destination].map((item, index) => (
          <NavLink key={item} end to={index === 0 ? `/${destination}` : `/${destination}/${item}`}>
            {t(`workspace.${item}`)}
          </NavLink>
        ))}
      </nav>
      {node.loading && <Notice>{t('dashboard.collecting')}</Notice>}
      {node.error && <Notice error>{message(node.error)}</Notice>}
      {(node.overview?.status === 'disconnected' || section?.stale || section?.error) && (
        <Notice error>
          <strong>
            {t(
              node.overview?.status === 'disconnected'
                ? 'dashboard.lost'
                : section?.stale
                  ? 'dashboard.stale'
                  : 'dashboard.partial',
            )}
          </strong>
          <span>
            {message(section?.error) || t('dashboard.reconnect')}
            {section?.updated_at
              ? t('dashboard.lastReading', { time: dateTime(section.updated_at) })
              : ''}
          </span>
        </Notice>
      )}
      {node.overview?.persistence_error && (
        <Notice error>{message(node.overview.persistence_error)}</Notice>
      )}
      {warnings.map((warning) => (
        <Notice key={String(warning)} error>
          {String(warning)}
        </Notice>
      ))}
      {page === 'node' && (
        <>
          <section className="health-summary">
            <div className="health-title">
              <ShieldCheck size={22} />
              <h2>{t(!chain ? 'sync.awaiting' : synced ? 'sync.synced' : 'sync.syncing')}</h2>
              <span>{chain ? `${decimal(progress)}%` : '—'}</span>
            </div>
            <div className="health-meta">
              <span>
                {chain?.chain || t('sync.unknown')} /{' '}
                {chain ? t(chain.pruned ? 'sync.pruned' : 'sync.full') : '—'}
              </span>
              <span>
                {latest
                  ? t('sync.lastBlock', { time: duration(node.now / 1000 - latest.time) })
                  : t('sync.awaitingBlock')}
              </span>
            </div>
            {chain && !synced && (
              <progress aria-label={t('sync.heading')} max={100} value={progress} />
            )}
          </section>
        </>
      )}
      {page === 'traffic' && (
        <>
          <dl className="metrics-grid two">
            <Metric
              label={t('traffic.downloadRate')}
              value={traffic?.receive_rate == null ? '—' : `${bytes(traffic.receive_rate)}/s`}
              detail={t('traffic.current')}
            />
            <Metric
              label={t('traffic.uploadRate')}
              value={traffic?.send_rate == null ? '—' : `${bytes(traffic.send_rate)}/s`}
              detail={t('traffic.current')}
            />
          </dl>
        </>
      )}
      {page === 'mempool' && view === 'live' && <FeeEstimates overview={node.overview?.overview} />}
      {page === 'mempool' && view === 'live' && <Activity view="live" />}
      {page === 'mempool' && view === 'live' && (
        <details className="mempool-policy">
          <summary>{t('workspace.mempoolPolicy')}</summary>
          <dl className="metrics-grid two">
            <Metric
              label={t('mempool.pending')}
              value={number(mempool?.size)}
              detail={t(mempool?.loaded ? 'mempool.loaded' : 'mempool.waiting')}
            />
            <Metric
              label={t('mempool.virtualSize')}
              value={bytes(mempool?.bytes)}
              detail={t('mempool.discounted')}
            />
            <Metric
              label={t('mempool.memoryUsage')}
              value={bytes(mempool?.usage)}
              detail={t('mempool.maximum', { size: bytes(mempool?.maxmempool) })}
            />
            <Metric
              label={t('mempool.minimumFee')}
              value={fee(mempool?.mempoolminfee)}
              detail={
                <BitcoinValue btc={mempool?.total_fee ?? null}>
                  {t('mempool.totalFees', { fee: decimal(mempool?.total_fee, 8) })}
                </BitcoinValue>
              }
            />
          </dl>
        </details>
      )}
      {page === 'peers' && (
        <dl className="metrics-grid">
          <Metric
            label={t('nav.peers')}
            value={number(node.peers.data?.length)}
            detail={t('peers.active')}
          />
          <Metric
            label={t('common.inbound')}
            value={number(network?.connections_in)}
            detail={t('peers.inboundDescription')}
          />
          <Metric
            label={t('common.outbound')}
            value={number(network?.connections_out)}
            detail={t('peers.outboundDescription')}
          />
          <Metric
            label={t('peers.networkTypes')}
            value={node.peers.data ? number(mix.length) : '—'}
            detail={mix.map(([name]) => name).join(' · ') || t('peers.awaiting')}
          />
        </dl>
      )}
      {page === 'peers' && <PeerMap section={node.peerMap} />}
      {page === 'mining' && (
        <>
          <DifficultyPeriod section={node.overview?.overview} />
        </>
      )}
      {page === 'pools' && (
        <>
          <MiningPools />
          <PoolHistory />
        </>
      )}
      {page === 'peers' && <PeerTable peers={node.peers.data ?? []} now={node.now} />}
      {(page === 'mining' ||
        page === 'peers' ||
        page === 'traffic' ||
        (page === 'mempool' && view === 'trends')) && (
        <HistoryRangePicker title={t(historyTitle)} range={range} onChange={setRange} />
      )}
      {page === 'mining' && (
        <MiningCharts mining={node.mining} overview={node.overview?.overview} range={range} />
      )}
      {page === 'traffic' && (
        <div className="full-chart">
          <HistoryChart
            title={t('nav.traffic')}
            subtitle={t('history.flowing')}
            metrics={['rx_rate', 'tx_rate']}
            labels={[t('history.download'), t('history.upload')]}
            range={range}
            unit="rate"
            toggleSeries
          />
        </div>
      )}
      {page === 'traffic' && (
        <>
          <section className="upload-panel">
            <div>
              <h2>{t('traffic.target')}</h2>
              <p>
                {t(
                  !traffic
                    ? 'traffic.awaiting'
                    : traffic.uploadtarget.target === 0
                      ? 'traffic.noTarget'
                      : traffic.uploadtarget.target_reached
                        ? 'traffic.reached'
                        : 'traffic.available',
                )}
              </p>
            </div>
            <dl>
              <Metric
                label={t('traffic.remaining')}
                value={
                  traffic?.uploadtarget.target
                    ? bytes(traffic.uploadtarget.bytes_left_in_cycle)
                    : '—'
                }
              />
              <Metric
                label={t('traffic.reset')}
                value={
                  traffic?.uploadtarget.target
                    ? duration(traffic.uploadtarget.time_left_in_cycle)
                    : '—'
                }
              />
            </dl>
          </section>
          <dl className="metrics-grid two">
            <Metric
              label={t('traffic.received')}
              value={bytes(traffic?.totalbytesrecv)}
              detail={t('traffic.sinceStart')}
            />
            <Metric
              label={t('traffic.sent')}
              value={bytes(traffic?.totalbytessent)}
              detail={t('traffic.sinceStart')}
            />
          </dl>
        </>
      )}
      {page === 'peers' && (
        <div className="chart-grid">
          <HistoryChart
            title={t('history.peerConnections')}
            metrics={['peers_in', 'peers_out']}
            labels={[t('common.inbound'), t('common.outbound')]}
            range={range}
          />
          <HistoryChart
            title={t('history.totalPeers')}
            metrics={['peers']}
            labels={[t('history.connected')]}
            range={range}
          />
        </div>
      )}
      {page === 'mempool' && view === 'trends' && <FeeHistory range={range} />}
      {page === 'mempool' && view === 'trends' && (
        <div className="chart-grid">
          <HistoryChart
            title={t('mempool.pending')}
            metrics={['mempool_count']}
            labels={[t('history.transactions')]}
            range={range}
          />
          <HistoryChart
            title={t('history.memory')}
            metrics={['mempool_usage', 'mempool_bytes']}
            labels={[t('history.memoryLabel'), t('mempool.virtualSize')]}
            range={range}
            unit="bytes"
          />
          <HistoryChart
            title={t('history.acceptanceFee')}
            metrics={['mempool_fee']}
            labels={[t('history.feeRate')]}
            range={range}
            unit="fee"
          />
        </div>
      )}
      {page === 'peers' && <PeerCountries section={node.peerMap} />}
      {page === 'peers' && (
        <section className="panel network-panel">
          <SectionHeading title={t('peers.networks')} subtitle={t('peers.distribution')} />
          <dl className="network-list">
            {mix.map(([name, count]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>
                  {number(count)}{' '}
                  <small>{Math.round((count / (node.peers.data?.length || 1)) * 100)}%</small>
                </dd>
              </div>
            ))}
          </dl>
          {!mix.length && <Empty title={t('peers.emptyDistribution')} />}
        </section>
      )}
      {page === 'node' && (
        <>
          {(node.mempool.stale || node.mempool.error) && (
            <Notice error>{t('node.relayFeeStale')}</Notice>
          )}
          <dl className="metrics-grid node-metrics">
            <Metric
              label={t('metrics.height')}
              value={number(chain?.blocks)}
              detail={t('metrics.headers', { total: number(chain?.headers) })}
            />
            <Metric
              label={t('nav.peers')}
              value={number(network?.connections)}
              detail={`${t('metrics.inbound', { total: number(network?.connections_in) })} / ${t('metrics.outbound', { total: number(network?.connections_out) })}`}
            />
            <Metric label={t('metrics.uptime')} value={duration(overview?.uptime)} />
            <Metric label={t('node.disk')} value={bytes(chain?.size_on_disk)} />
            <Metric
              label={t('node.database')}
              value={bytes(database?.data?.size_bytes)}
              detail={t(
                !database?.data
                  ? 'node.databaseUnavailable'
                  : database.stale || database.error
                    ? 'node.databaseStale'
                    : database.data.in_memory
                      ? 'node.databaseMemory'
                      : database.data.driver === 'postgres'
                        ? 'node.databasePostgres'
                        : 'node.databaseSQLite',
              )}
            />
            <Metric
              label={t('node.mode')}
              value={!chain ? '—' : t(chain.pruned ? 'sync.pruned' : 'sync.full')}
            />
          </dl>
          <section className="panel">
            <SectionHeading title={t('node.essentials')} />
            <dl className="node-details">
              {[
                [t('node.network'), chain?.chain ?? '—'],
                [t('node.coreVersion'), network?.subversion?.replaceAll('/', '') || '—'],
                [t('node.protocolVersion'), number(network?.protocolversion)],
                [t('node.relayFee'), fee(mempool?.minrelaytxfee)],
                [
                  t('node.networkActivity'),
                  !network ? '—' : t(network.networkactive ? 'node.enabled' : 'node.disabled'),
                ],
                [t('node.services'), network?.localservicesnames?.join(' · ') || '—'],
                [t('node.bestBlock'), chain?.bestblockhash ?? '—'],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        </>
      )}
      {page === 'events' && <Activity view="timeline" />}
      {page === 'blocks' && (
        <>
          {view === 'explorer' && (
            <dl className="chain-context">
              <div>
                <dt>{t('blocks.height')}</dt>
                <dd>{number(chain?.blocks)}</dd>
              </div>
              <div>
                <dt>{t('blocks.latest')}</dt>
                <dd>
                  {latest
                    ? t('blocks.ago', { time: duration(node.now / 1000 - latest.time) })
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>{t('blocks.status')}</dt>
                <dd>{!chain ? '—' : synced ? t('blocks.synced') : t('blocks.syncing')}</dd>
              </div>
            </dl>
          )}
          <div hidden={view !== 'explorer'}>
            <BlockHistory
              selectedHash={blockHash}
              onSelect={setBlockHash}
              recent={node.blocks.data ?? []}
              stale={node.blocks.stale}
              tipHeight={chain?.blocks}
            />
          </div>
          {view === 'analytics' && (
            <BlockEconomics section={node.blocks} syncing={chain != null && !synced} />
          )}
        </>
      )}
    </main>
  );
}
