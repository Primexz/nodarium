import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { registerMap } from 'echarts/core';
import { Minus, Plus, RotateCcw, MapPin } from 'lucide-react';
import world from '../assets/world.json';
import type { PeerMapData, Section } from '../types';
import { locationName, unlocatedReason } from '../map';
import { message } from '../i18n';
import { dateTime } from '../format';
import { useTheme } from '../theme';
import { chartPalette, useChart } from './useChart';
import { Notice, SectionHeading } from './ui';

registerMap('peer-world', world as Parameters<typeof registerMap>[1]);
const home = { center: [0, 20], zoom: 1 };

function PeerMap({ section }: { section: Section<PeerMapData> }) {
  const { t } = useTranslation();
  const { effective } = useTheme();

  const [direction, setDirection] = useState('all');
  const [selectedID, setSelectedID] = useState<number | null>(null);
  const [motionAllowed, setMotionAllowed] = useState(false);

  const data = section.data;
  const node = data?.node;
  const palette = chartPalette(effective === 'dark');
  const nodeLabel = !node?.label || node.label === 'My node' ? t('map.defaultNode') : node.label;

  const filtered = useMemo(
    () =>
      (data?.peers ?? []).filter(
        (p) => direction === 'all' || p.inbound === (direction === 'inbound'),
      ),
    [data, direction],
  );

  const located = filtered.filter((p) => p.location);
  const unknown = filtered.filter((p) => !p.location);
  const selected = located.find((p) => p.id === selectedID);

  const onClick = useCallback((id: number | null) => setSelectedID(id), []);
  const { element, instance } = useChart(
    (width, height) => ({
      animation: false,
      tooltip: {
        trigger: 'item',
        renderMode: 'richText',
        formatter: '{b}',
        backgroundColor: palette.panel,
        borderColor: palette.rule,
        textStyle: { color: palette.ink, fontSize: 12 },
        confine: true,
      },
      geo: {
        map: 'peer-world',
        roam: true,
        scaleLimit: { min: 0.8, max: 8 },
        boundingCoords: [
          [-180, -60],
          [180, 85],
        ],
        layoutCenter: ['50%', '50%'],
        layoutSize: Math.min(width * 0.94, height * 2.2),
        aspectScale: 1,
        itemStyle: { areaColor: palette.land, borderColor: palette.edge, borderWidth: 0.5 },
        emphasis: { disabled: true },
        tooltip: { show: false },
      },
      series: [
        {
          id: 'connections',
          type: 'lines',
          coordinateSystem: 'geo',
          zlevel: 1,
          effect: {
            show: motionAllowed && !section.stale && !section.error,
            period: 5,
            trailLength: 0.15,
            symbol: 'circle',
            symbolSize: 3,
          },
          lineStyle: { width: 1.3, opacity: section.stale ? 0.2 : 0.6, curveness: 0.22 },
          tooltip: { show: false },
          data: node
            ? located.map((p) => ({
                peerID: p.id,
                coords: [
                  [p.location!.longitude, p.location!.latitude],
                  [node.longitude, node.latitude],
                ],
                lineStyle: { color: palette.series[p.inbound ? 1 : 0] },
              }))
            : [],
        },
        {
          id: 'peers',
          type: 'scatter',
          coordinateSystem: 'geo',
          zlevel: 2,
          symbolSize: 8,
          itemStyle: {
            borderColor: palette.panel,
            borderWidth: 1,
            opacity: section.stale ? 0.4 : 1,
          },
          data: located.map((p) => ({
            name: `${p.address}\n${locationName(p.location!)}\n${t(p.inbound ? 'common.inbound' : 'common.outbound')}`,
            peerID: p.id,
            value: [p.location!.longitude, p.location!.latitude],
            itemStyle: { color: palette.series[p.inbound ? 1 : 0] },
          })),
        },
        {
          id: 'node',
          type: 'scatter',
          coordinateSystem: 'geo',
          zlevel: 3,
          symbol: 'diamond',
          symbolSize: 15,
          itemStyle: { color: palette.series[0], borderColor: palette.ink, borderWidth: 1 },
          label: {
            show: true,
            formatter: () => nodeLabel,
            position: 'bottom',
            color: palette.ink,
            fontSize: 12,
            distance: 10,
          },
          data: node
            ? [
                {
                  name: `${nodeLabel}\n${node.ip}\n${locationName(node)}`,
                  value: [node.longitude, node.latitude],
                },
              ]
            : [],
        },
      ],
    }),
    onClick,
  );

  useEffect(() => {
    const canvas = element.current;

    if (!canvas) return;

    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let visible = false;
    const update = () => setMotionAllowed(visible && !document.hidden && !preference.matches);
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      update();
    });

    observer.observe(canvas);
    preference.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);

    return () => {
      observer.disconnect();
      preference.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [element]);

  function zoom(factor: number) {
    const current = instance.current?.getOption() as
      { geo?: { zoom?: number; center?: number[] }[] } | undefined;

    instance.current?.setOption({
      geo: { zoom: Math.min(8, Math.max(0.8, (current?.geo?.[0]?.zoom ?? 1) * factor)) },
    });
  }

  return (
    <section className="panel peer-map-panel">
      <SectionHeading title={t('map.title')} subtitle={t('map.subtitle')}>
        <select
          aria-label={t('map.direction')}
          value={direction}
          onChange={(e) => {
            setDirection(e.target.value);
            setSelectedID(null);
          }}
        >
          <option value="all">{t('map.all')}</option>
          <option value="inbound">{t('common.inbound')}</option>
          <option value="outbound">{t('common.outbound')}</option>
        </select>
      </SectionHeading>
      {(section.stale || section.error) && (
        <Notice error>{message(section.error) || t('map.stale')}</Notice>
      )}
      {data?.message && <Notice>{message(data.message)}</Notice>}
      <div className="peer-map-layout">
        <div className="peer-map-stage">
          <div
            ref={element}
            className="peer-map-canvas"
            role="img"
            aria-label={t(node ? 'map.accessibleConnected' : 'map.accessible', {
              count: located.length,
              node: nodeLabel,
            })}
          />
          <div className="map-controls">
            <button className="icon-button" aria-label={t('map.zoomIn')} onClick={() => zoom(1.4)}>
              <Plus size={17} />
            </button>
            <button
              className="icon-button"
              aria-label={t('map.zoomOut')}
              onClick={() => zoom(1 / 1.4)}
            >
              <Minus size={17} />
            </button>
            <button
              className="icon-button"
              aria-label={t('map.reset')}
              onClick={() => instance.current?.setOption({ geo: home })}
            >
              <RotateCcw size={16} />
            </button>
          </div>
          <div className="map-legend">
            <span>
              <i style={{ background: palette.series[1] }} />
              {t('common.inbound')}
            </span>
            <span>
              <i style={{ background: palette.series[0] }} />
              {t('common.outbound')}
            </span>
            <span>
              <MapPin size={13} />
              {t('map.yourNode')}
            </span>
          </div>
          {!data && (
            <div className="map-loading" role="status">
              {section.error ? t('map.unavailable') : t('map.loading')}
            </div>
          )}
          {data?.status === 'ready' && !data.peers.length && (
            <div className="map-empty-label">{t('map.empty')}</div>
          )}
        </div>
        <aside className="map-details">
          <h3>{node ? nodeLabel : t('map.locate')}</h3>
          {node ? (
            <>
              <p>{locationName(node)}</p>
              <code>{node.ip}</code>
              <small>
                {t(node.source === 'configured_ip' ? 'map.configured' : 'map.advertised')}
              </small>
            </>
          ) : (
            <p>{message(data?.node_message) || t('map.waiting')}</p>
          )}
          <dl className="map-counts">
            <div>
              <dt>{t('map.located')}</dt>
              <dd>{located.length}</dd>
            </div>
            <div>
              <dt>{t('map.unlocated')}</dt>
              <dd>{unknown.length}</dd>
            </div>
          </dl>
          {located.length > 0 && (
            <select
              className="map-peer-select"
              aria-label={t('map.inspect')}
              value={selected?.id ?? ''}
              onChange={(e) => setSelectedID(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">{t('map.inspectPlaceholder')}</option>
              {located.map((p) => (
                <option key={p.id} value={p.id}>
                  {locationName(p.location!)} · {p.address}
                </option>
              ))}
            </select>
          )}
          {selected ? (
            <div className="selected-peer">
              <h4>{t('map.selected')}</h4>
              <code>{selected.address}</code>
              <p>{locationName(selected.location!)}</p>
              <span className="direction">
                {t(selected.inbound ? 'common.inbound' : 'common.outbound')}
              </span>
            </div>
          ) : (
            <p className="map-hint">{t('map.hint')}</p>
          )}
        </aside>
      </div>
      {unknown.length > 0 && (
        <details className="unlocated-peers">
          <summary>{t('map.unknownCount', { count: unknown.length })}</summary>
          <ul>
            {unknown.map((p) => (
              <li key={p.id}>
                <code>{p.address}</code>
                <span>{unlocatedReason(p.reason)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="map-foot">
        <span>{t('map.approximate')}</span>
        <span>
          {t('map.attribution')}{' '}
          <a href={data?.attribution.url || 'https://db-ip.com'} target="_blank" rel="noreferrer">
            {data?.attribution.name || 'DB-IP'}
          </a>{' '}
          ·{' '}
          <a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">
            Natural Earth
          </a>
          {data?.database_date && ` · ${dateTime(data.database_date, true)}`}
        </span>
      </div>
    </section>
  );
}

export default memo(PeerMap);
