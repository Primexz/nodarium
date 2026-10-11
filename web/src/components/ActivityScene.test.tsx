import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ActivityScene from './ActivityScene';
import type { ActivityLive } from '../activity';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../theme', () => ({ useTheme: () => ({ effective: 'dark' }) }));

let frames: Map<number, FrameRequestCallback>;
let clock: number;
let nextFrame: number;
let widthWrites: ReturnType<typeof vi.spyOn>;
const context = { clearRect: vi.fn(), fillRect: vi.fn(), setTransform: vi.fn(), globalAlpha: 1 };
const live: ActivityLive = {
  source: 'zmq',
  status: 'ready',
  at: 0,
  generation: 1,
  count: 1,
  arrivals: 0,
  transactions: [{ txid: 'a'.repeat(64), at: 0, vsize: 150, fee_rate: 2, output_sats: null }],
  block: null,
  persistence_error: false,
};

function advance(milliseconds = 16) {
  clock += milliseconds;
  const pending = [...frames.values()];
  frames.clear();
  act(() => pending.forEach((callback) => callback(clock)));
}

beforeEach(() => {
  clock = 0;
  nextFrame = 0;
  frames = new Map();
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'clientWidth', 'get').mockReturnValue(900);
  vi.spyOn(HTMLCanvasElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
  widthWrites = vi.spyOn(HTMLCanvasElement.prototype, 'width', 'set');
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);

    return nextFrame;
  });

  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}

      disconnect() {}
    },
  );

  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('preserves the painted canvas across rapid ZMQ readings at the same size', () => {
  const view = render(<ActivityScene live={live} paused={false} />);
  advance();
  const writes = widthWrites.mock.calls.length;

  for (let i = 1; i <= 20; i++) {
    view.rerender(<ActivityScene live={{ ...live, at: i * 100, arrivals: i }} paused={false} />);
    advance(100);
  }

  expect(widthWrites.mock.calls.length - writes).toBe(0);
});

it('continues arrivals smoothly when unchanged readings interrupt the animation', () => {
  const view = render(<ActivityScene live={live} paused={false} />);
  const arrival = { txid: 'b'.repeat(64), at: 100, vsize: 200, fee_rate: 8, output_sats: null };
  const next = { ...live, at: 100, transactions: [...live.transactions, arrival] };
  view.rerender(<ActivityScene live={next} paused={false} />);
  advance(100);
  const pending = [...frames.keys()];
  view.rerender(<ActivityScene live={{ ...next, at: 200 }} paused={false} />);
  expect([...frames.keys()]).toEqual(pending);
  advance(800);
  expect(frames.size).toBe(0);
  expect(context.fillRect).toHaveBeenCalled();
});

it('settles the current animation on pause and cancels frames on unmount', () => {
  const view = render(<ActivityScene live={live} paused={false} />);
  const next = {
    ...live,
    transactions: [...live.transactions, { ...live.transactions[0]!, txid: 'b'.repeat(64) }],
  };

  view.rerender(<ActivityScene live={next} paused={false} />);
  expect(frames.size).toBe(1);
  view.rerender(<ActivityScene live={next} paused />);
  expect(frames.size).toBe(0);
  view.rerender(
    <ActivityScene live={{ ...next, transactions: live.transactions }} paused={false} />,
  );

  expect(frames.size).toBe(1);
  view.unmount();
  expect(frames.size).toBe(0);
});
