import Vue from 'vue';

/**
 * Pool Operator Store
 *
 * Manages state for SPO (Staking Pool Operator) features:
 * cold key management, pool registration status, multi-node monitoring.
 */

export interface MonitoredNode {
  id: string;                         // Unique ID (uuid)
  name: string;                       // Display name (e.g., "Block Producer", "Relay EU-1")
  type: 'bp' | 'relay';              // Node type
  url: string;                        // Tunnel URL (https://xxx.trycloudflare.com)
  connected: boolean;
  lastSeen: number | null;            // Unix timestamp
  data: any | null;                   // Last status response
}

export interface PoolOperatorState {
  // Cold key management
  coldKeySource: 'none' | 'imported' | 'ledger';
  coldKeyHash: string | null;
  vrfKeyHash: string | null;

  // Pool state (fetched from chain)
  poolId: string | null;
  isRegistered: boolean;
  isRetiring: boolean;
  retirementEpoch: number | null;
  registeredParams: any | null;

  // KES state
  kesCounter: number;
  kesExpiry: number | null;

  // Multi-node monitoring
  nodes: MonitoredNode[];

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

  nodes: [] as MonitoredNode[],

  loading: false,
  error: null,
});

/**
 * Load pool operator config from wallet DB
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
    const nodesEntry = await config.where({ key: 'spo_nodes' }).first();

    poolOperatorStore.coldKeySource = coldKeySource?.value || 'none';
    poolOperatorStore.coldKeyHash = coldKeyHash?.value || null;
    poolOperatorStore.vrfKeyHash = vrfKeyHash?.value || null;
    poolOperatorStore.poolId = poolId?.value || null;

    // Load nodes
    if (nodesEntry?.value) {
      try {
        poolOperatorStore.nodes = JSON.parse(nodesEntry.value);
      } catch {
        poolOperatorStore.nodes = [];
      }
    }

    // Migrate old single-node config to multi-node
    if (poolOperatorStore.nodes.length === 0) {
      const oldUrl = await config.where({ key: 'spo_nodeMonitorUrl' }).first();
      if (oldUrl?.value) {
        poolOperatorStore.nodes = [{
          id: crypto.randomUUID(),
          name: 'Block Producer',
          type: 'bp',
          url: oldUrl.value.trim().replace(/\/+$/, ''),
          connected: false,
          lastSeen: null,
          data: null,
        }];
        await saveNodes(walletId);
      }
    }
  } catch (e) {
    console.warn('Failed to load pool operator config:', e);
  }
}

/**
 * Save nodes list to wallet DB
 */
export async function saveNodes(walletId: number): Promise<void> {
  const { setWalletConfiguration } = await import('@/db/wallet-db');
  // Strip runtime data before saving
  const toSave = poolOperatorStore.nodes.map(n => ({
    id: n.id, name: n.name, type: n.type, url: n.url,
    connected: false, lastSeen: null, data: null,
  }));
  await setWalletConfiguration(walletId, 'spo_nodes', JSON.stringify(toSave));
}

/**
 * Reset pool operator store
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
  poolOperatorStore.nodes = [];
  poolOperatorStore.loading = false;
  poolOperatorStore.error = null;
}

export default poolOperatorStore;
