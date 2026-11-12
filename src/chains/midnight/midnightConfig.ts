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
import { midnightLedgerOrNewest, type MidnightLedger } from './midnightLedger';

export interface MidnightNetworkEndpoints {
  /** Network identifier (matches `Network` enum). */
  network: string;
  /** Nexus base URL (the REST gateway). */
  nexusBaseUrl: string;
  /** Gero-Sync WebSocket URL for live push. */
  geroSyncWsUrl: string;
  /**
   * The default local proof server: the loopback port for the ledger the
   * chain runs (`defaultLocalProofServerUrl`), read when asked, never fixed
   * by the network's name. Proof inputs include sensitive data, so a local
   * server is preferred over a hosted one.
   */
  readonly defaultProofServerUrl: string;
  /**
   * Arkhia zkPaaS proof-server base URL for this network (the Midnight
   * ecosystem's hosted prover, run by BCW behind the Arkhia gateway inside
   * Google Confidential Compute). The gateway relays the NATIVE proof-server
   * API (`/prove`, `/check`) under this base, so the wallet's hand-rolled
   * ProvingProvider works against it unchanged apart from `x-api-key` /
   * `x-api-secret` auth headers. Arkhia only distinguishes mainnet vs
   * testnet in the documented default URLs. Stagenet and Preprod now use
   * different ledger generations, so a reachable shared URL does not establish
   * compatibility. Stagenet requires a ledger-9-capable service; override its
   * URL per device via `midnightStore.proofServer.zkpaasUrl` as needed.
   */
  zkpaasProofServerUrl: string;
  /**
   * Indexer endpoint (HTTP GraphQL) the wallet SDKs sync against. For mainnet
   * and preprod this is gero-sync's restricted indexer relay, which forwards
   * only the operations the SDKs use to Gero's self-hosted (in-cluster)
   * indexer. The indexer itself is never exposed publicly.
   */
  publicIndexerUrl: string;
  /** Indexer endpoint (WebSocket GraphQL subscriptions, graphql-transport-ws). */
  publicIndexerWsUrl: string;
  /**
   * Public Substrate RPC. Only stagenet still has one (third-party, while
   * stagenet self-hosting is parked); it is not advertised to dApps.
   */
  publicRpcUrl?: string;
  /** Faucet URL (testnets only). */
  faucetUrl?: string;
  /** Block explorer URL (for tx history links in the UI). */
  blockExplorerUrl?: string;
  /**
   * SDK NetworkId — the string the `@midnightntwrk/wallet-sdk-*` packages use
   * internally for serialization and address-format selection. Lowercase.
   */
  sdkNetworkId: 'mainnet' | 'preprod' | 'stagenet' | 'undeployed';
}

/**
 * Default Nexus base — overridable via `import.meta.env.VITE_NEXUS_API_URL`.
 * Empty default means "same-origin" — useful for local dev when the wallet runs
 * against a port-forwarded Nexus on `http://localhost:8080`.
 */
const NEXUS_BASE = (typeof import.meta !== 'undefined'
  && import.meta.env
  && import.meta.env['VITE_NEXUS_API_URL']) || 'https://nexus.gerowallet.io';

/**
 * gero-sync base URL — the same `VITE_SYNC_WS_URL` the sync WebSocket service
 * uses (`src/services/websocket.service.ts`), e.g. `wss://sync.gerowallet.io`.
 */
const GERO_SYNC_BASE = ((typeof import.meta !== 'undefined'
  && import.meta.env
  && import.meta.env['VITE_SYNC_WS_URL']) || 'wss://sync.gerowallet.io').replace(/\/+$/, '');

const GERO_SYNC_WS = `${GERO_SYNC_BASE}/ws/sync`;

/**
 * gero-sync's restricted Midnight indexer relay for one network
 * (`/midnight/{network}/graphql`, WebSocket at `.../graphql/ws`). The wallet
 * SDKs sync through it; Gero's indexers stay in-cluster.
 */
function geroSyncIndexerRelay(network: 'mainnet' | 'preprod'): { publicIndexerUrl: string; publicIndexerWsUrl: string } {
  const wsBase = `${GERO_SYNC_BASE}/midnight/${network}/graphql`;
  return { publicIndexerUrl: wsBase.replace(/^ws/, 'http'), publicIndexerWsUrl: `${wsBase}/ws` };
}

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
  /**
   * Stagenet — the network that replaced preview. Nexus retired the
   * `midnight-preview` slug on 2026-09-06 (its `Network.fromString` now 400s
   * on it), so preview is gone from this map rather than kept alongside.
   *
   * Stagenet is the ledger-9 pre-release network and is NOT hosted under
   * `*.midnight.network` — the Foundation serves it from `shielded.tools`.
   * These URLs match the `MIDNIGHT_STAGENET_*` values Nexus itself is
   * deployed with, so the wallet's direct-access fallback and the Nexus proxy
   * talk to the same chain.
   *
   * Read paths (blocks, transactions, DUST status) work today. The Nexus tx
   * sidecar is still pinned to `@midnight-ntwrk/ledger-v8` and answers 501 for
   * stagenet on `tx/build-unshielded`, `tx/submit` and the DUST registration
   * routes until its ledger-9 port lands — see issue #1024.
   */
  [Network.STAGENET]: {
    network: Network.STAGENET,
    nexusBaseUrl: NEXUS_BASE,
    geroSyncWsUrl: GERO_SYNC_WS,
    get defaultProofServerUrl() { return defaultLocalProofServerUrl(Network.STAGENET); },
    zkpaasProofServerUrl: ARKHIA_ZKPAAS_TESTNET,
    publicIndexerUrl: 'https://indexer.stagenet.shielded.tools/api/v4/graphql',
    publicIndexerWsUrl: 'wss://indexer.stagenet.shielded.tools/api/v4/graphql/ws',
    publicRpcUrl: 'https://rpc.stagenet.shielded.tools',
    faucetUrl: 'https://faucet.stagenet.shielded.tools',
    blockExplorerUrl: 'https://polkadot.js.org/apps/?rpc=wss%3A%2F%2Frpc.stagenet.shielded.tools#/explorer',
    sdkNetworkId: 'stagenet',
  },
  [Network.PREPROD]: {
    network: Network.PREPROD,
    nexusBaseUrl: NEXUS_BASE,
    geroSyncWsUrl: GERO_SYNC_WS,
    get defaultProofServerUrl() { return defaultLocalProofServerUrl(Network.PREPROD); },
    zkpaasProofServerUrl: ARKHIA_ZKPAAS_TESTNET,
    ...geroSyncIndexerRelay('preprod'),
    faucetUrl: 'https://midnight-tmnight-preprod.nethermind.dev',
    // Explorers as listed in Midnight's networks guide. The old polkadot.js
    // link rode on rpc.preprod.midnight.network, which is on its retired list.
    blockExplorerUrl: 'https://preprod.midnightexplorer.com',
    sdkNetworkId: 'preprod',
  },
  [Network.MAINNET]: {
    network: Network.MAINNET,
    nexusBaseUrl: NEXUS_BASE,
    geroSyncWsUrl: GERO_SYNC_WS,
    get defaultProofServerUrl() { return defaultLocalProofServerUrl(Network.MAINNET); },
    zkpaasProofServerUrl: ARKHIA_ZKPAAS_MAINNET,
    ...geroSyncIndexerRelay('mainnet'),
    // explorer.mainnet.cloudwalk.io now 301s to Cloudwalk's homepage.
    blockExplorerUrl: 'https://midnightexplorer.com',
    sdkNetworkId: 'mainnet',
  },
};

/**
 * Midnight Preview's public tNIGHT faucet. Stagenet wallets are told to get new
 * tNIGHT here before they move to Preview (issue 1477). Preview has no entry in
 * the endpoint map above yet; when it gets one, its `faucetUrl` is this value.
 */
export const MIDNIGHT_PREVIEW_FAUCET_URL = 'https://midnight-tmnight-preview.nethermind.dev';

/**
 * The Cardano network a Midnight network's cNIGHT lives on.
 *
 * Until stagenet these two vocabularies happened to coincide — Midnight
 * "Preview"/"Preprod"/"Mainnet" all named a Cardano network too, so every
 * cNIGHT lookup could pass the Midnight network straight through. Stagenet
 * has no Cardano namesake, and its cNIGHT policy + DUST mapping validator are
 * the ones deployed on Cardano **preprod** (identical to preprod's, per
 * Nexus's `midnight.dust.*.stagenet-*` pins), so it maps there.
 *
 * Both are testnet (`networkId` 0), so a wallet's derived Cardano twin address
 * is byte-identical before and after this mapping — only the lookup changes.
 */
export function cardanoTwinNetwork(midnightNetwork: string): string {
  return midnightNetwork === Network.STAGENET ? Network.PREPROD : midnightNetwork;
}

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
 * Example: `nexusUrlFor(Network.STAGENET, 'dust/status')` →
 * `https://nexus.gerowallet.io/api/midnight/midnight-stagenet/dust/status`
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

/**
 * The ledger 9 proof-server release: 9.0.0, the version upstream lists for
 * ledger 9.1.0.1 on mainnet, preprod and Preview (patch releases of 9.0.x
 * serve the same circuits). Mainnet, preprod and Preview all run ledger 9 now.
 */
export const PROOF_SERVER_DOCKER_TAG_LEDGER9 = '9.0.0';

/**
 * True when `network`'s chain runs ledger 9: what the chain last reported,
 * else the newest ledger (see `midnightLedgerOrNewest`). Never the network
 * name. Accepts the wallet `Network` value or a `midnight-<id>` slug.
 */
export function isLedger9Network(network?: string): boolean {
  return midnightLedgerOrNewest(network) === 9;
}

/** The proof-server release whose circuits match `ledger`. */
export function midnightProofServerTagForLedger(ledger: MidnightLedger): string {
  return ledger === 9 ? PROOF_SERVER_DOCKER_TAG_LEDGER9 : PROOF_SERVER_DOCKER_TAG;
}

/** The proof-server release for `network`'s chain ledger. */
export function midnightProofServerTag(network?: string): string {
  return midnightProofServerTagForLedger(midnightLedgerOrNewest(network));
}

/**
 * Host port each ledger's local proof server binds by default. Deliberately
 * different so a user can run both at once — the ledger-8 and ledger-9
 * servers are different circuit families and one server cannot serve both.
 * The wallet picks the URL by the ledger of the active wallet's chain, so
 * there is no profile to switch when moving between networks.
 *
 * Decision for the ledger 9 upgrade (#1452 M8): ledger 9 keeps 6301 on every
 * network rather than taking over 6300. A ledger 8 server a user still runs
 * on 6300 then never receives ledger 9 jobs (it would fail them with
 * opaque circuit errors), the ledger 9 URL users already set is kept, and
 * moving mainnet and preprod users to a new server is one instruction ("start
 * the 9.0.0 server", the migration notice of #1475).
 */
export function midnightProofServerPortForLedger(ledger: MidnightLedger): number {
  return ledger === 9 ? 6301 : 6300;
}

export function midnightProofServerPort(network?: string): number {
  return midnightProofServerPortForLedger(midnightLedgerOrNewest(network));
}

/** The default loopback URL of the local proof server for `network`'s chain ledger. */
export function defaultLocalProofServerUrl(network?: string): string {
  return `http://localhost:${midnightProofServerPort(network)}`;
}

export const DEFAULT_LOCAL_PROOF_SERVER_URL = 'http://localhost:6300';
export const DEFAULT_LOCAL_PROOF_SERVER_URL_LEDGER9 = 'http://localhost:6301';

/**
 * The one command the wallet suggests for starting a local proof server, for
 * the given network's ledger. Every surface that shows a command (Settings →
 * Proof server, Remote signing → "Prove for your phone", the restart notice)
 * builds it here so they cannot drift apart.
 *
 * No verbose flag: verbose mode writes request contents, including private
 * transaction inputs, to the container log, and the wallet never reads that
 * output. `--rm` removes the container (and its log) when it stops, and the
 * port is bound to loopback so the server is not reachable from the network.
 */
export function midnightProofServerCommandForLedger(ledger: MidnightLedger): string {
  const port = midnightProofServerPortForLedger(ledger);
  return `docker run --rm -p 127.0.0.1:${port}:6300 midnightntwrk/proof-server:${midnightProofServerTagForLedger(ledger)} midnight-proof-server`;
}

export function midnightProofServerCommand(network?: string): string {
  return midnightProofServerCommandForLedger(midnightLedgerOrNewest(network));
}

/**
 * The command for the ledger 9 server that Cross-Device Proving serves from
 * (it advertises the ledger 9 profile, see localProverProfile.ts).
 */
export const PROOF_SERVER_DOCKER_COMMAND = midnightProofServerCommandForLedger(9);
