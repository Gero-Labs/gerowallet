import axios from 'axios';
import { Network } from '@/models/types';

/**
 * SPO (Staking Pool Operator) API
 *
 * Direct Koios API client for pool operator data not available through the Gero backend.
 * Provides: epoch history, block log, stake snapshots, epoch parameters.
 */

const KOIOS_URLS: Record<string, string> = {
  [Network.MAINNET]: 'https://api.koios.rest/api/v1',
  [Network.PREPROD]: 'https://preprod.koios.rest/api/v1',
  [Network.PREVIEW]: 'https://preview.koios.rest/api/v1',
};

function getKoiosUrl(network: string): string {
  return KOIOS_URLS[network] || KOIOS_URLS[Network.MAINNET];
}

function createClient(network: string) {
  return axios.create({
    baseURL: getKoiosUrl(network),
    timeout: 30000,
    headers: { 'Content-Type': 'application/json' },
  });
}

export interface PoolEpochHistory {
  epoch_no: number;
  active_stake: string;
  active_stake_pct: number | null;
  saturation_pct: number;
  block_cnt: number;
  delegator_cnt: number;
  margin: number;
  fixed_cost: string;
  pool_fees: string;
  deleg_rewards: string;
  member_rewards: string | null;
  epoch_ros: number;
}

export interface PoolBlock {
  epoch_no: number;
  epoch_slot: number;
  abs_slot: number;
  block_height: number;
  block_hash: string;
  block_time: number;
}

export interface EpochParams {
  epoch_no: number;
  nonce: string;
  active_stake: string | null;
}

export interface EpochInfo {
  epoch_no: number;
  blk_count: number;
  start_time: number;
  end_time: number;
  active_stake: string | null;
  total_rewards: string | null;
}

export interface PoolStakeSnapshot {
  snapshot: 'mark' | 'set' | 'go';
  pool_stake: string;
  active_stake: string;
  epoch_no: number;
  nonce: string;
}

const spoApi = {
  /**
   * Get pool epoch-by-epoch history (blocks, rewards, stake, luck)
   */
  async getPoolHistory(poolId: string, network: string, limit = 20): Promise<PoolEpochHistory[]> {
    const client = createClient(network);
    const { data } = await client.get(`/pool_history?_pool_bech32=${poolId}&limit=${limit}&offset=0&order=epoch_no.desc`);
    return data;
  },

  /**
   * Get pool blocks for a specific epoch (or all recent)
   */
  async getPoolBlocks(poolId: string, network: string, epochNo?: number, limit = 50): Promise<PoolBlock[]> {
    const client = createClient(network);
    let url = `/pool_blocks?_pool_bech32=${poolId}&limit=${limit}&offset=0&order=abs_slot.desc`;
    if (epochNo != null) url += `&_epoch_no=${epochNo}`;
    const { data } = await client.get(url);
    return data;
  },

  /**
   * Get epoch parameters (nonce for leader schedule)
   */
  async getEpochParams(network: string, epochNo: number): Promise<EpochParams> {
    const client = createClient(network);
    const { data } = await client.get(`/epoch_params?_epoch_no=${epochNo}`);
    return data[0];
  },

  /**
   * Get epoch info (total blocks, active stake, timestamps)
   */
  async getEpochInfo(network: string, epochNo: number): Promise<EpochInfo> {
    const client = createClient(network);
    const { data } = await client.get(`/epoch_info?_epoch_no=${epochNo}`);
    return data[0];
  },

  /**
   * Get pool stake snapshots (mark/set/go) for leader schedule calculation
   */
  async getPoolStakeSnapshot(poolId: string, network: string): Promise<PoolStakeSnapshot[]> {
    const client = createClient(network);
    const { data } = await client.get(`/pool_stake_snapshot?_pool_bech32=${poolId}`);
    return data;
  },

  /**
   * Calculate expected blocks for an epoch based on pool's active stake
   * expected = sigma * total_epoch_slots * activeSlotCoeff
   * Since total_epoch_slots * activeSlotCoeff ≈ total_blocks_in_epoch (for completed epochs)
   * we can use: expected = active_stake_pct/100 * epoch_block_count
   */
  calculateExpectedBlocks(activeStakePct: number, epochBlockCount: number): number {
    return (activeStakePct / 100) * epochBlockCount;
  },

  /**
   * Calculate luck percentage
   * luck = (blocks_produced / expected_blocks) * 100
   */
  calculateLuck(blocksProduced: number, expectedBlocks: number): number {
    if (expectedBlocks <= 0) return 0;
    return (blocksProduced / expectedBlocks) * 100;
  },
};

export default spoApi;
