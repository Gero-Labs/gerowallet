/**
 * Midnight Chain — Network Endpoint Configuration
 *
 * Per-network URLs for the Midnight infrastructure the wallet talks to.
 * Three layers:
 *
 * 1. **Nexus** (Gero's REST gateway) — block/tx lookups, DUST status, contract state,
 *    DUST registration tx-build, GraphQL+RPC proxies. Routes through `gero-sync`'s
 *    REST adapter rather than calling the indexer directly so we get auth + rate
 *    limit + observability.
 *
 * 2. **Gero-Sync** (WebSocket push-sync) — live tip updates, per-address `unshieldedTransactions`
 *    push. Wallet subscribes once per chain at login.
 *
 * 3. **Direct Midnight Foundation infrastructure** — only used by the SDK for things
 *    the wallet handles locally (proof server for ZK proof gen, optionally shielded
 *    subscriptions via the indexer's GraphQL WS proxy through Nexus).
 *
 * URLs are env-overridable so the wallet can be pointed at staging vs prod, or at
 * the public Foundation indexer for local dev when our infra is offline.
 */

import { Network } from '@/models/types';

export interface MidnightNetworkEndpoints {
  /** Network identifier (matches `Network` enum). */
  network: string;
  /** Nexus base URL (the REST gateway). */
  nexusBaseUrl: string;
  /** Gero-Sync WebSocket URL for live push. */
  geroSyncWsUrl: string;
  /**
   * Proof server URL. For privacy, prefer `localhost:6300` (user runs Docker)
   * over a hosted service — proof inputs include sensitive data the proof server sees.
   * Set to empty string to opt the user into "in-browser WASM proving" (PR-future)
   * once that path is built.
   */
  defaultProofServerUrl: string;
  /**
   * Public Foundation indexer endpoint (HTTP GraphQL). Used by the SDK for
   * one-shot queries when the Nexus proxy is unavailable, or by power users who
   * opt out of the Gero proxy.
   */
  publicIndexerUrl: string;
  /** Public Foundation indexer endpoint (WebSocket GraphQL subscriptions). */
  publicIndexerWsUrl: string;
  /** Public Foundation Substrate RPC. */
  publicRpcUrl: string;
  /** Faucet URL (testnets only). */
  faucetUrl?: string;
  /** Block explorer URL (for tx history links in the UI). */
  blockExplorerUrl?: string;
  /**
   * SDK NetworkId — the string the `@midnight-ntwrk/wallet-sdk-*` packages use
   * internally for serialization and address-format selection. Lowercase.
   */
  sdkNetworkId: 'mainnet' | 'preprod' | 'preview' | 'undeployed';
}

/**
 * Default Nexus base — overridable via `import.meta.env.VITE_NEXUS_API_URL`.
 * Empty default means "same-origin" — useful for local dev when the wallet runs
 * against a port-forwarded Nexus on `http://localhost:8080`.
 */
const NEXUS_BASE = (typeof import.meta !== 'undefined'
  && import.meta.env
  && import.meta.env['VITE_NEXUS_API_URL']) || 'https://nexus.gerowallet.io';

const GERO_SYNC_WS = (typeof import.meta !== 'undefined'
  && import.meta.env
  && import.meta.env['VITE_GERO_SYNC_WS_URL']) || 'wss://sync.gerowallet.io/ws/sync';

const MIDNIGHT_NETWORK_ENDPOINTS: Record<string, MidnightNetworkEndpoints> = {
  [Network.PREVIEW]: {
    network: Network.PREVIEW,
    nexusBaseUrl: NEXUS_BASE,
    geroSyncWsUrl: GERO_SYNC_WS,
    defaultProofServerUrl: 'http://localhost:6300',
    publicIndexerUrl: 'https://indexer.preview.midnight.network/api/v4/graphql',
    publicIndexerWsUrl: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
    publicRpcUrl: 'https://rpc.preview.midnight.network',
    faucetUrl: 'https://faucet.preview.midnight.network',
    blockExplorerUrl: 'https://polkadot.js.org/apps/?rpc=wss%3A%2F%2Frpc.preview.midnight.network#/explorer',
    sdkNetworkId: 'preview',
  },
  [Network.PREPROD]: {
    network: Network.PREPROD,
    nexusBaseUrl: NEXUS_BASE,
    geroSyncWsUrl: GERO_SYNC_WS,
    defaultProofServerUrl: 'http://localhost:6300',
    publicIndexerUrl: 'https://indexer.preprod.midnight.network/api/v4/graphql',
    publicIndexerWsUrl: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
    publicRpcUrl: 'https://rpc.preprod.midnight.network',
    faucetUrl: 'https://faucet.preprod.midnight.network',
    blockExplorerUrl: 'https://polkadot.js.org/apps/?rpc=wss%3A%2F%2Frpc.preprod.midnight.network#/explorer',
    sdkNetworkId: 'preprod',
  },
  [Network.MAINNET]: {
    network: Network.MAINNET,
    nexusBaseUrl: NEXUS_BASE,
    geroSyncWsUrl: GERO_SYNC_WS,
    defaultProofServerUrl: 'http://localhost:6300',
    publicIndexerUrl: 'https://indexer.mainnet.midnight.network/api/v4/graphql',
    publicIndexerWsUrl: 'wss://indexer.mainnet.midnight.network/api/v4/graphql/ws',
    publicRpcUrl: 'https://rpc.mainnet.midnight.network',
    blockExplorerUrl: 'https://explorer.mainnet.cloudwalk.io',
    sdkNetworkId: 'mainnet',
  },
};

/**
 * Look up endpoint config for a Midnight network. Returns `undefined` if the
 * network isn't a recognized Midnight network — caller should treat that as a
 * configuration error.
 */
export function getMidnightEndpoints(network: string): MidnightNetworkEndpoints | undefined {
  return MIDNIGHT_NETWORK_ENDPOINTS[network];
}

/**
 * Compose the full Nexus URL for a per-network Midnight REST resource.
 *
 * Example: `nexusUrlFor(Network.PREVIEW, 'dust/status')` →
 * `https://nexus.gerowallet.io/api/v1/midnight/midnight-preview/dust/status`
 *
 * Network slug mapping mirrors what Nexus expects in its `?network=` parameter
 * for chain-agnostic endpoints, and the `{network}` path segment for Midnight-only
 * endpoints (`/api/v1/midnight/{network}/...`).
 */
export function nexusMidnightPathFor(network: string, subpath: string): string {
  const endpoints = MIDNIGHT_NETWORK_ENDPOINTS[network];
  if (!endpoints) {
    throw new Error(`Unknown Midnight network: ${network}`);
  }
  // Nexus path segment uses `midnight-<networkid>` form.
  const slug = `midnight-${endpoints.sdkNetworkId}`;
  const trimmedSubpath = subpath.startsWith('/') ? subpath.slice(1) : subpath;
  return `${endpoints.nexusBaseUrl}/api/v1/midnight/${slug}/${trimmedSubpath}`;
}
