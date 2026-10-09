import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowDownLeft, ArrowUpRight, ArrowUpDown, Search, X } from 'lucide-react';
import type { Peer } from '../types';
import { bytes, duration, number, decimal } from '../format';
import { Empty, SectionHeading } from './ui';

export default function PeerTable({
  peers,
  compact = false,
  now,
}: {
  peers: Peer[];
  compact?: boolean;
  now: number;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [direction, setDirection] = useState('all');
  const [sort, setSort] = useState('traffic');
  const [ascending, setAscending] = useState(false);
  const [selectedID, setSelectedID] = useState<number | null>(null);
  const [page, setPage] = useState(1);

  const selected = peers.find((p) => p.id === selectedID);
  const filtered = peers
    .filter(
      (p) =>
        (direction === 'all' || p.inbound === (direction === 'inbound')) &&
        `${p.addr} ${p.subver} ${p.network}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => {
      let diff: number;

      if (sort === 'traffic') diff = a.bytesrecv + a.bytessent - b.bytesrecv - b.bytessent;
      else if (sort === 'latency') diff = (a.pingtime ?? Infinity) - (b.pingtime ?? Infinity);
      else if (sort === 'duration') diff = b.conntime - a.conntime;
      else diff = a.addr.localeCompare(b.addr);

      return ascending ? diff : -diff;
    });

  const pages = Math.max(1, Math.ceil(filtered.length / 20));
  const currentPage = Math.min(page, pages);
  const visible = compact
    ? filtered.slice(0, 5)
    : filtered.slice((currentPage - 1) * 20, currentPage * 20);

  function order(key: string) {
    if (sort === key) setAscending(!ascending);
    else {
      setSort(key);
      setAscending(key === 'latency' || key === 'address');
    }

    setPage(1);
  }

  const columns = [
    ['address', t('peers.address')],
    ['direction', t('peers.direction')],
    ['client', t('peers.client')],
    ['latency', t('peers.latency')],
    ['traffic', t('peers.traffic')],
    ['duration', t('history.connected')],
  ];

  return (
    <Dialog.Root
      open={!!selected}
      onOpenChange={(open) => {
        if (!open) setSelectedID(null);
      }}
    >
      <section className="panel peer-panel">
        <SectionHeading
          title={t(compact ? 'peers.yourConnections' : 'nav.peers')}
          subtitle={t(compact ? 'peers.live' : 'peers.explore')}
        >
          {compact ? (
            <Link className="text-link" to="/peers">
              {t('peers.viewAll')}
              <ArrowUpRight size={15} />
            </Link>
          ) : (
            <span className="count-badge">{number(peers.length)}</span>
          )}
        </SectionHeading>
        {!compact && (
          <div className="table-controls">
            <label className="search-box">
              <Search size={16} />
              <input
                aria-label={t('peers.search')}
                placeholder={t('peers.searchPlaceholder')}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            <select
              aria-label={t('peers.filter')}
              value={direction}
              onChange={(e) => {
                setDirection(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">{t('peers.allDirections')}</option>
              <option value="inbound">{t('common.inbound')}</option>
              <option value="outbound">{t('common.outbound')}</option>
            </select>
          </div>
        )}
        <div className="table-scroll">
          <table className="peers-table">
            <thead>
              <tr>
                {columns.map(([key, label]) => (
                  <th
                    key={key}
                    aria-sort={sort === key ? (ascending ? 'ascending' : 'descending') : undefined}
                  >
                    {['address', 'latency', 'traffic', 'duration'].includes(key!) ? (
                      <button onClick={() => order(key!)}>
                        {label}
                        <ArrowUpDown size={12} />
                      </button>
                    ) : (
                      label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Dialog.Trigger asChild>
                      <button className="peer-address" onClick={() => setSelectedID(p.id)}>
                        {p.addr}
                      </button>
                    </Dialog.Trigger>
                    <span className="network-tag">{p.network}</span>
                  </td>
                  <td>
                    <span className={`direction ${p.inbound ? 'inbound' : ''}`}>
                      {p.inbound ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />}{' '}
                      {t(p.inbound ? 'common.inbound' : 'common.outbound')}
                    </span>
                  </td>
                  <td className="client-cell">{p.subver.replaceAll('/', '')}</td>
                  <td className="numeric">
                    {p.pingtime == null ? '—' : `${decimal(p.pingtime * 1000, 0)} ms`}
                  </td>
                  <td className="numeric">{bytes(p.bytesrecv + p.bytessent)}</td>
                  <td>{duration(now / 1000 - p.conntime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!visible.length && (
          <Empty
            title={t(peers.length ? 'peers.noMatch' : 'peers.empty')}
            description={t(peers.length ? 'peers.trySearch' : 'peers.discover')}
          />
        )}
        {!compact && pages > 1 && (
          <div className="pagination">
            <span>{t('peers.page', { page: number(currentPage), pages: number(pages) })}</span>
            <button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
              {t('common.previous')}
            </button>
            <button disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>
              {t('common.next')}
            </button>
          </div>
        )}
      </section>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-backdrop" />
        <Dialog.Content className="peer-dialog">
          <Dialog.Close asChild>
            <button className="icon-button dialog-close" aria-label={t('peers.close')}>
              <X size={20} />
            </button>
          </Dialog.Close>
          <Dialog.Title>{t('peers.details')}</Dialog.Title>
          <Dialog.Description className="mono break">{selected?.addr}</Dialog.Description>
          {selected && (
            <dl className="detail-list">
              {[
                [
                  t('peers.transport'),
                  `${selected.network} / ${selected.transport_protocol_type || '—'}`,
                ],
                [t('peers.type'), selected.connection_type || '—'],
                [t('peers.protocol'), selected.version],
                [
                  t('peers.transferred'),
                  `${bytes(selected.bytesrecv)} / ${bytes(selected.bytessent)}`,
                ],
                [
                  t('peers.minLatency'),
                  selected.minping == null ? '—' : `${decimal(selected.minping * 1000, 1)} ms`,
                ],
                [
                  t('peers.syncedHeaders'),
                  `${number(selected.synced_blocks)} / ${number(selected.synced_headers)}`,
                ],
                [t('peers.services'), selected.servicesnames?.join(', ') || '—'],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
