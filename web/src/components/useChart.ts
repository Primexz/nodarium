import { useLayoutEffect, useRef } from 'react';
import {
  init,
  use as registerCharts,
  type EChartsCoreOption,
  type EChartsType,
} from 'echarts/core';
import {
  LineChart,
  LinesChart,
  ScatterChart,
  TreemapChart,
  PieChart,
  BarChart,
} from 'echarts/charts';
import { GridComponent, TooltipComponent, GeoComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

registerCharts([
  LineChart,
  LinesChart,
  ScatterChart,
  TreemapChart,
  PieChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  GeoComponent,
  CanvasRenderer,
]);

export function chartPalette(dark: boolean) {
  return dark
    ? {
        text: '#b4b8b0',
        ink: '#e8e8e0',
        rule: '#393d38',
        ground: '#171817',
        land: '#2d332c',
        edge: '#525b50',
        panel: '#222620',
        series: ['#f3a653', '#78c4b4', '#beb0dc', '#c0c975'],
      }
    : {
        text: '#62695e',
        ink: '#202420',
        rule: '#d7d9ce',
        ground: '#f5f3ee',
        land: '#e0e3d7',
        edge: '#bac2b1',
        panel: '#fffef9',
        series: ['#ac530c', '#287e71', '#7662a0', '#6c7629'],
      };
}

type ChartOptions = EChartsCoreOption | ((width: number, height: number) => EChartsCoreOption);

export function useChart(options: ChartOptions, onClick?: (peer: number | null) => void) {
  const element = useRef<HTMLDivElement>(null);
  const instance = useRef<EChartsType | null>(null);
  const latest = useRef(options);

  useLayoutEffect(() => {
    latest.current = options;
    const node = element.current;
    const chart = instance.current;

    if (node && chart && node.clientWidth > 0 && node.clientHeight > 0)
      chart.setOption(
        typeof options === 'function' ? options(node.clientWidth, node.clientHeight) : options,
        { replaceMerge: ['series'] },
      );
  }, [options]);

  useLayoutEffect(() => {
    const node = element.current;

    if (!node) return;

    const chart = init(node, undefined, { renderer: 'canvas' });
    instance.current = chart;
    let alive = true;
    let ready = false;

    function update() {
      const current = latest.current;
      chart.setOption(
        typeof current === 'function' ? current(node!.clientWidth, node!.clientHeight) : current,
        { replaceMerge: ['series'] },
      );

      ready = true;
    }

    if (node.clientWidth > 0 && node.clientHeight > 0) update();

    if (onClick)
      chart.on('click', (params) => {
        const data = params.data as { peerID?: number } | undefined;
        onClick(data?.peerID ?? null);
      });

    const observer = new ResizeObserver(() => {
      // Hidden/detached canvases produce a singular geo transform in ECharts.
      // Ignore queued callbacks after disposal, and wait for real layout before resizing.
      if (!alive || node.clientWidth <= 0 || node.clientHeight <= 0) return;

      chart.resize();

      if (!ready || typeof latest.current === 'function') update();
    });

    observer.observe(node);

    return () => {
      alive = false;
      observer.disconnect();
      chart.dispose();
      instance.current = null;
    };
  }, [onClick]);

  return { element, instance };
}
