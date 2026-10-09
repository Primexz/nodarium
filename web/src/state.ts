import { useEffect, useState } from 'react';
import { QueryClient, useQuery } from '@tanstack/react-query';
import { api } from './api';
import type {
  OverviewResponse,
  Section,
  Peer,
  PeerMapData,
  Traffic,
  Mempool,
  Block,
  Mining,
} from './types';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false },
  },
});

export const empty = <T>(): Section<T> => ({ data: null, updated_at: null, stale: false });

export function sectionResult<T>(data: Section<T> | undefined, failed: boolean): Section<T> {
  const section = data ?? empty<T>();

  return failed ? { ...section, stale: true, error: 'Refresh failed' } : section;
}

function useSection<T>(path: string) {
  return useQuery({
    queryKey: ['node', path],
    queryFn: ({ signal }) => api<T>(path, { signal }),
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
  });
}

export function useReadings() {
  const overview = useSection<OverviewResponse>('overview');
  const peers = useSection<Section<Peer[]>>('peers');
  const peerMap = useSection<Section<PeerMapData>>('peer-map');
  const traffic = useSection<Section<Traffic>>('traffic');
  const mempool = useSection<Section<Mempool>>('mempool');
  const blocks = useSection<Section<Block[]>>('blocks');
  const mining = useSection<Section<Mining>>('mining');

  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(clock);
  }, []);

  return {
    overview:
      overview.isError && overview.data
        ? {
            ...overview.data,
            status: 'disconnected',
            overview: { ...overview.data.overview, stale: true },
          }
        : overview.data,
    peers: sectionResult(peers.data, peers.isError),
    peerMap: sectionResult(peerMap.data, peerMap.isError),
    traffic: sectionResult(traffic.data, traffic.isError),
    mempool: sectionResult(mempool.data, mempool.isError),
    blocks: sectionResult(blocks.data, blocks.isError),
    mining: sectionResult(mining.data, mining.isError),
    loading: overview.isPending && overview.isFetching,
    error: [overview, peers, traffic, mempool, blocks, mining].some((q) => q.isError)
      ? 'Could not refresh all readings. Showing the last available data.'
      : '',
    now,
  };
}

export type Readings = ReturnType<typeof useReadings>;

export async function refresh() {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['node'] }),
    queryClient.invalidateQueries({ queryKey: ['explorer'], refetchType: 'active' }),
    queryClient.invalidateQueries({ queryKey: ['history'], refetchType: 'active' }),
  ]);
}
