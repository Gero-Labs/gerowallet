import Vue from 'vue';

/**
 * Pool Operator Store
 *
 * Manages state for SPO (Staking Pool Operator) features:
 * cold key management, pool registration status, KES rotation state.
 */

export interface PoolOperatorState {
  // Cold key management
  coldKeySource: 'none' | 'imported' | 'ledger';
  coldKeyHash: string | null;         // Ed25519KeyHash — also the Pool ID hex
  vrfKeyHash: string | null;          // VrfVkHex from node

  // Pool state (fetched from chain)
  poolId: string | null;              // Bech32 pool ID
  isRegistered: boolean;
  isRetiring: boolean;
  retirementEpoch: number | null;
  registeredParams: any | null;       // Current on-chain PoolParameters

  // KES state
  kesCounter: number;
  kesExpiry: number | null;           // Epoch when KES key expires

  // UI state
  loading: boolean;
  error: string | null;
}

export const poolOperatorStore: PoolOperatorState = Vue.observable({
  coldKeySource: 'none' as 'none' | 'imported' | 'ledger',
  coldKeyHash: null,
  vrfKeyHash: null,

  poolId: null,
  isRegistered: false,
  isRetiring: false,
  retirementEpoch: null,
  registeredParams: null,

  kesCounter: 0,
  kesExpiry: null,

  loading: false,
  error: null,
});

/**
 * Load pool operator config from wallet DB (called on wallet login)
 */
export async function loadPoolOperatorConfig(walletId: number): Promise<void> {
  try {
    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(walletId);
    const config = db['config'];

    const coldKeySource = await config.where({ key: 'spo_coldKeySource' }).first();
    const coldKeyHash = await config.where({ key: 'spo_coldKeyHash' }).first();
    const vrfKeyHash = await config.where({ key: 'spo_vrfKeyHash' }).first();
    const poolId = await config.where({ key: 'spo_poolId' }).first();

    poolOperatorStore.coldKeySource = coldKeySource?.value || 'none';
    poolOperatorStore.coldKeyHash = coldKeyHash?.value || null;
    poolOperatorStore.vrfKeyHash = vrfKeyHash?.value || null;
    poolOperatorStore.poolId = poolId?.value || null;
  } catch (e) {
    console.warn('Failed to load pool operator config:', e);
  }
}

/**
 * Reset pool operator store (called on wallet logout)
 */
export function resetPoolOperatorStore(): void {
  poolOperatorStore.coldKeySource = 'none';
  poolOperatorStore.coldKeyHash = null;
  poolOperatorStore.vrfKeyHash = null;
  poolOperatorStore.poolId = null;
  poolOperatorStore.isRegistered = false;
  poolOperatorStore.isRetiring = false;
  poolOperatorStore.retirementEpoch = null;
  poolOperatorStore.registeredParams = null;
  poolOperatorStore.kesCounter = 0;
  poolOperatorStore.kesExpiry = null;
  poolOperatorStore.loading = false;
  poolOperatorStore.error = null;
}

export default poolOperatorStore;
