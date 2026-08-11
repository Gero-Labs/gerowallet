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
   * Arkhia zkPaaS proof-server base URL for this network (the Midnight
   * ecosystem's hosted prover, run by BCW behind the Arkhia gateway inside
   * Google Confidential Compute). The gateway relays the NATIVE proof-server
   * API (`/prove`, `/check`) under this base, so the wallet's hand-rolled
   * ProvingProvider works against it unchanged apart from `x-api-key` /
   * `x-api-secret` auth headers. Arkhia only distinguishes mainnet vs
   * testnet, so preview and preprod share the testnet base — proving is
   * circuit-level (ledger-generation-coupled), not network-specific, so
   * that sharing is sound. Users can override per device via
   * `midnightStore.proofServer.zkpaasUrl`.
   */
  zkpaasProofServerUrl: string;
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
   * SDK NetworkId — the string the `@midnightntwrk/wallet-sdk-*` packages use
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

/**
 * Arkhia zkPaaS bases. Path shape comes from the zkPaaS guide's Arkhia
 * project pages (`.claude/ZkPaaS Guide.pdf`): the per-project endpoint is
 * `https://starter.arkhia.io/midnight/zkpaas/{mainnet|testnet}/` with the
 * API key supplied as an `x-api-key` header (or embedded as a trailing
 * path segment — both are accepted by the gateway).
 */
const ARKHIA_ZKPAAS_MAINNET = 'https://starter.arkhia.io/midnight/zkpaas/mainnet';
const ARKHIA_ZKPAAS_TESTNET = 'https://starter.arkhia.io/midnight/zkpaas/testnet';

const MIDNIGHT_NETWORK_ENDPOINTS: Record<string, MidnightNetworkEndpoints> = {
  [Network.PREVIEW]: {
    network: Network.PREVIEW,
    nexusBaseUrl: NEXUS_BASE,
    geroSyncWsUrl: GERO_SYNC_WS,
    defaultProofServerUrl: 'http://localhost:6300',
    zkpaasProofServerUrl: ARKHIA_ZKPAAS_TESTNET,
    publicIndexerUrl: 'https://indexer.preview.midnight.network/api/v4/graphql',
    publicIndexerWsUrl: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
    publicRpcUrl: 'https://rpc.preview.midnight.network',
    faucetUrl: 'https://midnight-tmnight-preview.nethermind.dev',
    blockExplorerUrl: 'https://polkadot.js.org/apps/?rpc=wss%3A%2F%2Frpc.preview.midnight.network#/explorer',
    sdkNetworkId: 'preview',
  },
  [Network.PREPROD]: {
    network: Network.PREPROD,
    nexusBaseUrl: NEXUS_BASE,
    geroSyncWsUrl: GERO_SYNC_WS,
    defaultProofServerUrl: 'http://localhost:6300',
    zkpaasProofServerUrl: ARKHIA_ZKPAAS_TESTNET,
    publicIndexerUrl: 'https://indexer.preprod.midnight.network/api/v4/graphql',
    publicIndexerWsUrl: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
    publicRpcUrl: 'https://rpc.preprod.midnight.network',
    faucetUrl: 'https://midnight-tmnight-preprod.nethermind.dev',
    blockExplorerUrl: 'https://polkadot.js.org/apps/?rpc=wss%3A%2F%2Frpc.preprod.midnight.network#/explorer',
    sdkNetworkId: 'preprod',
  },
  [Network.MAINNET]: {
    network: Network.MAINNET,
    nexusBaseUrl: NEXUS_BASE,
    geroSyncWsUrl: GERO_SYNC_WS,
    defaultProofServerUrl: 'http://localhost:6300',
    zkpaasProofServerUrl: ARKHIA_ZKPAAS_MAINNET,
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
 * `https://nexus.gerowallet.io/api/midnight/midnight-preview/dust/status`
 *
 * Network slug mapping mirrors what Nexus expects in its `?network=` parameter
 * for chain-agnostic endpoints, and the `{network}` path segment for Midnight-only
 * endpoints (`/api/midnight/{network}/...`).
 *
 * Note: nexus PR #416 (merged 2026-06-08) dropped the `/v1` version segment
 * from all public endpoints. Previously this was `/api/v1/midnight/...`.
 */
export function nexusMidnightPathFor(network: string, subpath: string): string {
  const endpoints = MIDNIGHT_NETWORK_ENDPOINTS[network];
  if (!endpoints) {
    throw new Error(`Unknown Midnight network: ${network}`);
  }
  // Nexus path segment uses `midnight-<networkid>` form.
  const slug = `midnight-${endpoints.sdkNetworkId}`;
  const trimmedSubpath = subpath.startsWith('/') ? subpath.slice(1) : subpath;
  return `${endpoints.nexusBaseUrl}/api/midnight/${slug}/${trimmedSubpath}`;
}

/**
 * Pinned to the 8.x proof-server release that matches the installed
 * @midnight-ntwrk/ledger-v8 (^8.1.0) - verified against Docker Hub
 * (midnightntwrk/proof-server tags) on 2026-07-13. Deliberately not
 * `latest`, which tracks the 9.0.0-rc stream (a newer, mismatched ledger
 * generation).
 *
 * Lives here rather than in useProofServerSettings.ts (which re-exports it for
 * the UI) because the BACKGROUND worker needs it too: Cross-Device Proving
 * advertises this tag as `proverLedgerVersion` in DEVICE_REGISTER and refuses
 * jobs whose requester pinned a different one, and the BG cannot import a Vue
 * composable.
 */
export const PROOF_SERVER_DOCKER_TAG = '8.1.0';
export const PROOF_SERVER_DOCKER_COMMAND =
  `docker run -p 6300:6300 midnightntwrk/proof-server:${PROOF_SERVER_DOCKER_TAG} midnight-proof-server -v`;
