import { StrictMode } from 'react';
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  charts: [] as {
    setOption: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  }[],
}));

vi.mock('echarts/core', () => ({
  use: vi.fn(),
  init: vi.fn(() => {
    const chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(), on: vi.fn() };
    mocks.charts.push(chart);

    return chart;
  }),
}));

import { useChart } from './useChart';

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(320);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  mocks.charts.length = 0;
});

it('cleans up every Strict Mode instance and updates data without recreating a chart', () => {
  const disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();

      disconnect = disconnect;
    },
  );

  function Probe({ color }: { color: string }) {
    const { element } = useChart({ color: [color] });

    return <div ref={element} />;
  }

  const view = render(
    <StrictMode>
      <Probe color="orange" />
    </StrictMode>,
  );

  expect(mocks.charts).toHaveLength(2);
  expect(mocks.charts[0]!.dispose).toHaveBeenCalledOnce();
  view.rerender(
    <StrictMode>
      <Probe color="green" />
    </StrictMode>,
  );

  expect(mocks.charts).toHaveLength(2);
  expect(mocks.charts[1]!.setOption).toHaveBeenLastCalledWith(
    { color: ['green'] },
    { replaceMerge: ['series'] },
  );

  view.unmount();
  expect(mocks.charts.every((chart) => chart.dispose.mock.calls.length === 1)).toBe(true);
  expect(disconnect).toHaveBeenCalledTimes(2);
});

it('ignores zero-size and queued post-disposal resize callbacks and fits options to real dimensions', () => {
  let resize: () => void = () => {};

  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }

      observe = vi.fn();

      disconnect = vi.fn();
    },
  );

  function Probe() {
    const { element } = useChart((width, height) => ({
      geo: { layoutSize: Math.min(width * 0.94, height * 2.2) },
    }));

    return <div ref={element} />;
  }

  const view = render(<Probe />);
  const chart = mocks.charts[0]!;

  expect(chart.setOption).toHaveBeenCalledWith(
    { geo: { layoutSize: 601.5999999999999 } },
    { replaceMerge: ['series'] },
  );

  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(0);
  act(resize);
  expect(chart.resize).not.toHaveBeenCalled();
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
  act(resize);
  expect(chart.resize).toHaveBeenCalledOnce();
  expect(chart.setOption).toHaveBeenLastCalledWith(
    { geo: { layoutSize: 366.59999999999997 } },
    { replaceMerge: ['series'] },
  );

  view.unmount();
  act(resize);
  expect(chart.resize).toHaveBeenCalledOnce();
});
