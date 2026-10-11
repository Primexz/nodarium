import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useActivity } from './activity';

class Stream extends EventTarget {
  static instances: Stream[] = [];

  onopen: (() => void) | null = null;

  onerror: (() => void) | null = null;

  closed = false;

  constructor(public url: string) {
    super();
    Stream.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  send(kind: string, data: unknown) {
    this.dispatchEvent(new MessageEvent(kind, { data: JSON.stringify(data) }));
  }
}

beforeEach(() => {
  Stream.instances = [];
  vi.stubGlobal('EventSource', Stream);
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('activity subscriptions', () => {
  it('closes when paused, hidden or unmounted and resumes with a fresh snapshot', () => {
    const hook = renderHook(({ paused }) => useActivity('live', paused), {
      initialProps: { paused: false },
    });

    const stream = Stream.instances[0]!;
    act(() => {
      stream.onopen?.();
      stream.send('snapshot', { source: 'rpc', generation: 1, transactions: [] });
    });

    expect(hook.result.current.connected).toBe(true);
    hook.rerender({ paused: true });
    expect(stream.closed).toBe(true);
    expect(hook.result.current.connected).toBe(false);
    hook.rerender({ paused: false });
    expect(Stream.instances).toHaveLength(2);
    act(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(Stream.instances[1]!.closed).toBe(true);
    act(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(Stream.instances).toHaveLength(3);
    hook.unmount();
    expect(Stream.instances[2]!.closed).toBe(true);
  });

  it('deduplicates replayed events, signals gaps and never pauses timeline subscriptions', () => {
    const hook = renderHook(() => useActivity('timeline', true));
    const stream = Stream.instances[0]!;
    expect(stream.url).toContain('view=timeline');
    act(() => {
      stream.send('event', { id: 'same' });
      stream.send('event', { id: 'same' });
    });

    expect(hook.result.current.updates).toBe(1);
    act(() => stream.send('reset', {}));
    expect(hook.result.current.updates).toBe(2);
    const expired = vi.fn();
    window.addEventListener('session-expired', expired);
    act(() => stream.send('expired', {}));
    expect(expired).toHaveBeenCalledOnce();
    expect(stream.closed).toBe(true);
    window.removeEventListener('session-expired', expired);
  });
});
