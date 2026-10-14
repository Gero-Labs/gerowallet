import type { MonitoredNode } from '@/stores/poolOperatorStore';

/** Fields consumed from the node monitor's status, versions and schedule APIs. */
export interface NodeStatus {
  epoch?: number;
  epochSlot?: number;
  epochSlotsRemaining?: number;
  blockHeight?: number;
  tipRef?: number;
  forks?: number;
  slotNo?: number;
  density?: number;
  txsProcessed?: number;
  syncProgress?: number;
  mempoolTxs?: number;
  mempoolBytes?: number;
  peers?: number;
  lastBlockDelay?: number;
  cpuPercent?: number;
  memoryMb?: number;
  diskPct?: number;
  kesPeriod?: number;
  kesRemaining?: number;
  kesExpiry?: number;
  nodeVersion?: string;
  uptimeSeconds?: number;
  tipHash?: string;
  connections?: { biDir?: number; inWarm?: number; outWarm?: number; duplex?: number; inHot?: number; outHot?: number };
  blockDelayPct?: { within1s?: number; within3s?: number; within5s?: number };
  opCert?: { disk?: number; chain?: number };
}
export type DisplayNode = Omit<MonitoredNode, 'data'> & { data: NodeStatus | null };
export interface NodeVersions {
  versions?: { cardanoNode?: string; cncli?: string; geroNodeMonitor?: string };
  updates?: Record<string, { current?: string; latest?: string }>;
}
export interface LeaderSlot {
  slot: number;
  timestamp: number;
  slotInEpoch?: number;
  slot_in_epoch?: number;
  produced?: boolean | null;
  status?: string;
  blockNo?: number;
}
export interface LeaderSchedule {
  epoch: number;
  totalSlots: number;
  slots: LeaderSlot[];
  producedCount?: number;
  missedCount?: number;
  pendingCount?: number;
}
export interface PoolRelay {
  __typename?: 'RelayByName' | 'RelayByAddress' | 'RelayByNameMultihost';
  dns?: string;
  hostname?: string;
  ipv4?: string;
  ipv6?: string;
  ip?: string;
  srv?: string;
  dnsName?: string;
  port?: number;
}
export interface Ratio { numerator: number; denominator: number }
export interface PoolInfo {
  ticker?: string;
  name?: string;
  description?: string;
  live_saturation?: number;
  live_pledge?: string | number;
  pledge?: string | number;
  live_stake?: string | number;
  live_delegators?: number;
  block_count?: number;
  ros?: number;
  fixed_cost?: string | number;
  cost?: string | number;
  margin_of_cost?: number;
  margin?: number | Ratio;
  relays?: PoolRelay[];
  owners?: string[];
  pool_extended_info?: string;
  meta_url?: string;
  metadata_url?: string;
  meta_hash?: string;
  metadata_hash?: string;
  reward_addr?: string;
  rewardAccount?: string;
}
export interface KesRotateResponse { success?: boolean; error?: string; steps?: string[] }
