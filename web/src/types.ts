export interface Section<T> {
  data: T | null;
  updated_at: string | null;
  error?: string;
  stale: boolean;
}

export interface Blockchain {
  chain: string;
  blocks: number;
  headers: number;
  bestblockhash: string;
  difficulty: number;
  verificationprogress: number;
  initialblockdownload: boolean;
  size_on_disk: number;
  pruned: boolean;
  warnings: string | string[] | null;
}

export interface Network {
  version: number;
  subversion: string;
  protocolversion: number;
  connections: number;
  connections_in: number;
  connections_out: number;
  networkactive: boolean;
  localservicesnames: string[];
  warnings: string | string[] | null;
}

export interface Overview {
  blockchain: Blockchain;
  network: Network;
  uptime: number | null;
}

export interface OverviewResponse {
  status: string;
  checked_at: string | null;
  persistence_error?: string;
  overview: Section<Overview>;
}

export interface Mining {
  height: number;
  hashrate_144: number;
  hashrate_1008: number;
}

export interface FeeRate {
  fee_rate: number;
  estimated_blocks: number;
}

export interface FeeTarget extends Section<FeeRate> {
  target_blocks: number;
}

export interface Fees {
  mode: 'conservative';
  targets: FeeTarget[];
}

export interface Peer {
  id: number;
  addr: string;
  network: string;
  subver: string;
  version: number;
  inbound: boolean;
  connection_type: string;
  transport_protocol_type: string;
  conntime: number;
  pingtime: number | null;
  minping: number | null;
  bytessent: number;
  bytesrecv: number;
  servicesnames: string[];
  synced_headers: number | null;
  synced_blocks: number | null;
}

export interface Traffic {
  totalbytesrecv: number;
  totalbytessent: number;
  receive_rate: number | null;
  send_rate: number | null;
  uploadtarget: {
    timeframe: number;
    target: number;
    target_reached: boolean;
    serve_historical_blocks: boolean;
    bytes_left_in_cycle: number;
    time_left_in_cycle: number;
  };
}

export interface Mempool {
  loaded: boolean;
  size: number;
  bytes: number;
  usage: number;
  maxmempool: number;
  total_fee: number;
  mempoolminfee: number;
  minrelaytxfee: number;
}

export interface Block {
  subsidy_sats: string | null;
  average_fee_rate: number | null;
  total_transaction_amount_sats: string | null;
  transaction_count: number | null;
  total_fees_sats: string | null;
  size_bytes: number | null;
  weight_units: number | null;
  capacity_percent: number | null;
  median_fee_rate: number | null;
  hash: string;
  height: number;
  time: number;
  confirmations: number;
  previousblockhash: string;
}

export interface HistoryPoint {
  at: number;
  value: number | null;
  peak: number | null;
  total: number;
  coverage: number;
  samples: number;
}

export interface History {
  metric: string;
  range: string;
  interval_seconds: number;
  points: HistoryPoint[];
  total: number;
}

export interface GeoLocation {
  latitude: number;
  longitude: number;
  city: string;
  country: string;
  country_code: string;
}

export interface MapPeer {
  id: number;
  address: string;
  inbound: boolean;
  location: GeoLocation | null;
  reason?: string;
}

export interface MapNode extends GeoLocation {
  ip: string;
  label: string;
  source: 'configured_ip' | 'advertised_ip';
}

export interface PeerMapData {
  node: MapNode | null;
  node_message?: string;
  peers: MapPeer[];
  located: number;
  unlocated: number;
  status: 'ready' | 'loading' | 'unavailable';
  message?: string;
  database_date: string | null;
  attribution: { name: string; url: string };
}

export interface BlockTransaction {
  txid: string;
  size: number;
  vsize: number;
  weight: number;
  fee_sats: string | null;
  fee_rate: number | null;
  output_sats: string | null;
  input_count: number;
  output_count: number;
  coinbase: boolean;
}

export interface BlockTransactions {
  hash: string;
  height: number;
  confirmations: number;
  transactions: BlockTransaction[];
  mining_pool: PoolAttribution;
}

export interface TransactionInput {
  txid: string;
  vout: number;
  coinbase: boolean;
  sequence: number;
  value_sats: string | null;
  address: string;
  script_type: string;
}

export interface TransactionOutput {
  index: number;
  value_sats: string | null;
  address: string;
  script_type: string;
}

export interface TransactionDetails extends BlockTransaction {
  wtxid: string;
  block_hash: string;
  confirmations: number;
  version: number;
  locktime: number;
  inputs: TransactionInput[];
  outputs: TransactionOutput[];
}

export interface MiningPool {
  id: number;
  name: string;
  link: string;
}

export interface PoolAttribution {
  status: 'identified' | 'unknown' | 'unavailable' | 'unsupported';
  pool: MiningPool | null;
  method?: 'coinbase_tag' | 'payout_address';
}

export interface PoolShare {
  pool: MiningPool | null;
  blocks: number;
  percent: number;
}

export interface PoolDistribution {
  status: 'loading' | 'indexing' | 'ready' | 'partial' | 'unavailable' | 'syncing' | 'unsupported';
  stale: boolean;
  window: number;
  target: number;
  scanned: number;
  height: number;
  tip: string;
  updated_at: string | null;
  shares: PoolShare[];
  definitions: { source: string; commit: string; sha256: string };
}
