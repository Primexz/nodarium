import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Readings } from '../state';
import { message } from '../i18n';
import { bytes, duration, fee, number, decimal, dateTime } from '../format';
import { Metric, Notice, SectionHeading, Empty } from '../components/ui';
import HistoryChart from '../components/HistoryChart';
import PeerMap from '../components/PeerMap';
import PeerCountries from '../components/PeerCountries';
import DifficultyPeriod from '../components/DifficultyPeriod';
import MiningCharts from '../components/MiningCharts';
import MiningPools from '../components/MiningPools';
import FeeEstimates, { FeeHistory } from '../components/FeeEstimates';
import PeerTable from '../components/PeerTable';
import BlockTable, { BlockStrip } from '../components/BlockTable';
import { ArrowUpRight, ShieldCheck } from 'lucide-react';

export default function Dashboard({
  page,
  node,
  range,
  setRange,
}: {
  page: string;
  node: Readings;
  range: string;
  setRange: (range: string) => void;
}) {
  const { t } = useTranslation();
  const [blockHash, setBlockHash] = useState<string | null>(null);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [page]);

  const overview = node.overview?.overview.data;
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
        <h1>{t(`dashboard.${page}Title`)}</h1>
        <p>{t(`dashboard.${page}Description`)}</p>
      </div>
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
      {(page === 'overview' || page === 'node') && (
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
          {page === 'overview' && (
            <dl className="metrics-grid">
              <Metric
                label={t('metrics.height')}
                value={number(chain?.blocks)}
                detail={t('metrics.headers', { count: number(chain?.headers) })}
              />
              <Metric
                label={t('nav.peers')}
                value={number(network?.connections)}
                detail={`${t('metrics.inbound', { count: number(network?.connections_in) })} / ${t('metrics.outbound', { count: number(network?.connections_out) })}`}
              />
              <Metric
                label={t('metrics.mempoolTransactions')}
                value={number(mempool?.size)}
                detail={t('metrics.virtualSize', { size: bytes(mempool?.bytes) })}
              />
              <Metric
                label={t('metrics.uptime')}
                value={duration(overview?.uptime)}
                detail={network?.subversion?.replaceAll('/', '') || t('metrics.waiting')}
              />
            </dl>
          )}
        </>
      )}
      {page === 'traffic' && (
        <>
          <dl className="metrics-grid">
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
        </>
      )}
      {page === 'mempool' && <FeeEstimates overview={node.overview?.overview} />}
      {page === 'mempool' && (
        <dl className="metrics-grid">
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
            detail={t('mempool.totalFees', { fee: decimal(mempool?.total_fee, 8) })}
          />
        </dl>
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
      {page === 'overview' && (
        <BlockStrip blocks={node.blocks.data ?? []} stale={node.blocks.stale} />
      )}
      {page === 'overview' && (
        <div className="overview-links">
          {['node', 'mining', 'peers', 'traffic', 'mempool'].map((destination) => (
            <Link key={destination} to={`/${destination}`} className="text-link">
              {t(`nav.${destination}`)} <ArrowUpRight size={15} aria-hidden />
            </Link>
          ))}
        </div>
      )}
      {page === 'mining' && (
        <>
          <DifficultyPeriod section={node.overview?.overview} />
          <MiningPools />
        </>
      )}
      {['mining', 'peers', 'traffic', 'mempool'].includes(page) && (
        <div className="section-toolbar">
          <h2>{t(historyTitle)}</h2>
          <div className="range-picker" role="group" aria-label={t('history.range')}>
            {['1h', '24h', '7d', '30d', '1y'].map((r) => (
              <button
                key={r}
                aria-pressed={range === r}
                className={range === r ? 'active' : ''}
                onClick={() => setRange(r)}
              >
                {t(`range.${r}`)}
              </button>
            ))}
          </div>
        </div>
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
          />
        </div>
      )}
      {page === 'traffic' && (
        <div className="chart-grid">
          <HistoryChart
            title={t('traffic.downloadRate')}
            subtitle={t('history.receivedRate')}
            metrics={['rx_rate']}
            labels={[t('history.download')]}
            range={range}
            unit="rate"
          />
          <HistoryChart
            title={t('traffic.uploadRate')}
            subtitle={t('history.sentRate')}
            metrics={['tx_rate']}
            labels={[t('history.upload')]}
            range={range}
            unit="rate"
          />
        </div>
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
      {page === 'mempool' && <FeeHistory range={range} />}
      {page === 'mempool' && (
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
      {page === 'peers' && <PeerTable peers={node.peers.data ?? []} now={node.now} />}
      {page === 'node' && (
        <>
          {(node.mempool.stale || node.mempool.error) && (
            <Notice error>{t('node.relayFeeStale')}</Notice>
          )}
          <dl className="metrics-grid">
            <Metric
              label={t('metrics.height')}
              value={number(chain?.blocks)}
              detail={t('metrics.headers', { count: number(chain?.headers) })}
            />
            <Metric label={t('metrics.uptime')} value={duration(overview?.uptime)} />
            <Metric label={t('node.disk')} value={bytes(chain?.size_on_disk)} />
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
      {page === 'blocks' && (
        <>
          <dl className="metrics-grid three">
            <Metric
              label={t('blocks.height')}
              value={number(chain?.blocks)}
              detail={t('blocks.tip')}
            />
            <Metric
              label={t('blocks.latest')}
              value={
                latest ? t('blocks.ago', { time: duration(node.now / 1000 - latest.time) }) : '—'
              }
              detail={t('blocks.since')}
            />
            <Metric
              label={t('blocks.status')}
              value={!chain ? '—' : synced ? t('blocks.synced') : t('blocks.syncing')}
              detail={
                chain ? t('blocks.verified', { percent: decimal(progress) }) : t('sync.awaiting')
              }
            />
          </dl>
          <BlockStrip
            blocks={node.blocks.data ?? []}
            stale={node.blocks.stale}
            selectedHash={blockHash}
            onSelect={setBlockHash}
          />
          <section className="panel">
            <SectionHeading
              title={t('nav.blocks')}
              subtitle={`${t('blocks.headers')} · ${t('blocks.expandHint')}`}
            />
            <p className="block-explanation">
              {t('blocks.amountDescription')} {t('blocks.amountPrecision')}
            </p>
            <BlockTable
              blocks={node.blocks.data ?? []}
              stale={node.blocks.stale}
              selectedHash={blockHash}
              onSelect={setBlockHash}
            />
          </section>
        </>
      )}
    </main>
  );
}
