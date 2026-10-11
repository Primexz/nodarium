import { useEffect, useState } from 'react';
import { api, APIError } from './api';

export interface ActivityTransaction {
  txid: string;
  at: number;
  vsize: number | null;
  fee_rate: number | null;
  output_sats: string | null;
}

export interface ActivityBlock {
  hash: string;
  height: number;
  time: number;
  transactions: ActivityTransaction[];
}

export interface ActivityLive {
  source: 'rpc' | 'zmq';
  status: 'waiting' | 'ready' | 'resynchronizing' | 'unavailable' | 'capacity';
  at: number;
  generation: number;
  count: number;
  arrivals: number;
  transactions: ActivityTransaction[];
  block: ActivityBlock | null;
  persistence_error: boolean;
}

export interface ActivityEvent {
  id: string;
  at: number;
  kind: 'connection' | 'block' | 'reorg';
  status?: 'connected' | 'partial' | 'disconnected' | 'connecting';
  previous_status?: string;
  hash?: string;
  height: number | null;
  block_time: number | null;
  previous_hash?: string;
  depth: number | null;
}

export interface ActivityPage {
  events: ActivityEvent[];
  cursor?: string;
  persistence_error: boolean;
}

export function useActivity(view: 'live' | 'timeline', paused: boolean) {
  const [live, setLive] = useState<ActivityLive | null>(null);
  const [connected, setConnected] = useState(false);
  const [updates, setUpdates] = useState(0);
  const [visible, setVisible] = useState(!document.hidden);

  useEffect(() => {
    const change = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', change);

    return () => document.removeEventListener('visibilitychange', change);
  }, []);

  useEffect(() => {
    if (!visible || (view === 'live' && paused)) return;

    let alive = true;
    let lastCheck = 0;
    const seen = new Set<string>();
    const stream = new EventSource(`/api/1.0/activity/stream?view=${view}`);
    const reading = (event: MessageEvent<string>) => {
      try {
        const value: ActivityLive = JSON.parse(event.data);

        if (alive && value.source) setLive(value);
      } catch {
        setConnected(false);
      }
    };

    stream.onopen = () => setConnected(true);
    stream.onerror = () => {
      setConnected(false);

      if (Date.now() - lastCheck > 10000) {
        lastCheck = Date.now();
        void api('auth/session').catch((error: unknown) => {
          if (alive && error instanceof APIError && error.status === 401) {
            stream.close();
            window.dispatchEvent(new Event('session-expired'));
          }
        });
      }
    };

    stream.addEventListener('snapshot', reading);
    stream.addEventListener('live', reading);
    stream.addEventListener('status', reading);
    stream.addEventListener('event', (event: MessageEvent<string>) => {
      try {
        const value: ActivityEvent = JSON.parse(event.data);

        if (!seen.has(value.id)) {
          seen.add(value.id);
          setUpdates((n) => n + 1);

          if (seen.size > 1000) seen.delete(seen.values().next().value!);
        }
      } catch {
        setConnected(false);
      }
    });

    stream.addEventListener('reset', () => setUpdates((n) => n + 1));
    stream.addEventListener('expired', () => {
      stream.close();
      window.dispatchEvent(new Event('session-expired'));
    });

    return () => {
      alive = false;
      stream.close();
      setConnected(false);
    };
  }, [view, paused, visible]);

  return { live, connected, updates, visible };
}
