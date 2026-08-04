/**
 * Midnight API Client
 *
 * Calls Nexus's Midnight REST endpoints. The wallet treats Nexus as the gateway
 * for one-shot reads (block lookup, tx detail, DUST status, contract state) and
 * for tx submission. Live updates flow through gero-sync's WS — see
 * `src/services/midnight-sync.service.ts` (PR-future).
 *
 * Endpoint shape mirrors what Nexus's `midnight-preview` PR shipped:
 * - `/api/blocks/...?network=midnight-{network}` for chain-agnostic reads
 *   (uses `?network=midnight-preview` etc., served by existing controllers)
 * - `/api/midnight/{network}/...` for Midnight-specific resources
 *   (DUST status, transaction UTxOs, GraphQL/RPC proxy, registration tx-build)
 *
 * All calls go through `nexusBaseUrl` from `midnightConfig.ts`.
 */

import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import { parseHttpError } from '@/shared/utils/parser';
import { getMidnightEndpoints, nexusMidnightPathFor } from '@/chains/midnight/midnightConfig';
import { getNexusAccessToken, reauthenticateNexus } from '@/services/nexusDevice.service';
import { debugLog } from '@/utils/debug';
import type { MidnightUnshieldedUtxo } from '@/chains/midnight/midnightTypes';

/**
 * Nexus's `BlockDto`-shaped block response (chain-agnostic — same struct as Cardano,
 * with Substrate-specific fields zeroed). Matches what `GET /api/blocks/...?network=midnight-*`
 * returns from the existing Cardano controllers.
 */
export interface MidnightBlockDto {
  hash: string;
  height: number;
  time: number;
  slot: number;        // 0 for Midnight (Substrate has no slot concept)
  epoch: number;       // 0 for Midnight
  epochSlot: number;   // 0 for Midnight
  txCount?: number;
  size?: number;
}

/**
 * Nexus's transaction-detail response shape.
 */
export interface MidnightTransactionDto {
  hash: string;
  blockHash: string;
  blockHeight: number;
  cbor?: string;       // Serialized substrate tx hex (named `cbor` for cross-chain consistency)
  raw?: string;        // Same as `cbor` for Midnight
  protocolVersion?: number;
}

/**
 * DUST registration status response from Nexus's `/dust/status`.
 *
 * One record per Cardano stake/reward address queried.
 */
export interface MidnightDustRegistrationStatusDto {
  cardanoRewardAddress: string;
  dustAddress: string | null;
  registered: boolean;
  /** Strings for BigInt portability across JSON. */
  nightBalance?: string;
  generationRate?: string;
  maxCapacity?: string;
  currentCapacity?: string;
  registrationUtxoTxHash?: string | null;
  registrationUtxoOutputIndex?: number | null;
}

/** Wire-shape (snake_case) of Nexus's `DustRegistrationStatusDto`. */
interface MidnightDustRegistrationStatusWire {
  cardano_reward_address: string;
  dust_address: string | null;
  registered: boolean;
  night_balance?: string;
  generation_rate?: string;
  max_capacity?: string;
  current_capacity?: string;
  registration_utxo_tx_hash?: string | null;
  registration_utxo_output_index?: number | null;
}

/** Exported for `midnight-api.spec.ts` — this exact wire-conversion bug class
 *  (snake_case fields silently coming through as `undefined`) shipped
 *  undetected for a full release; see git history for the fix. */
export function convertDustStatus(wire: MidnightDustRegistrationStatusWire): MidnightDustRegistrationStatusDto {
  return {
    cardanoRewardAddress: wire.cardano_reward_address,
    dustAddress: wire.dust_address ?? null,
    registered: wire.registered,
    nightBalance: wire.night_balance,
    generationRate: wire.generation_rate,
    maxCapacity: wire.max_capacity,
    currentCapacity: wire.current_capacity,
    registrationUtxoTxHash: wire.registration_utxo_tx_hash ?? null,
    registrationUtxoOutputIndex: wire.registration_utxo_output_index ?? null,
  };
}

/**
 * A single live DUST registration UTxO for a stake credential, from Nexus's
 * `GET dust/registrations`. Midnight's pairing rule allows exactly ONE live
 * registration per stake credential — more than one invalidates the whole
 * set (the indexer reports `registered:false`, indistinguishable from
 * unregistered via `/dust/status` alone). This endpoint is the only way to
 * see the actual count and enumerate the duplicates for consolidation.
 */
export interface DustRegistrationUtxoDto {
  txHash: string;
  outputIndex: number;
  dustAddressHex: string;
  lovelace: string;
}

/** Wire-shape (snake_case) of a single registration UTxO entry. */
interface DustRegistrationUtxoWire {
  tx_hash: string;
  output_index: number;
  dust_address_hex: string;
  lovelace: string;
}

function convertRegistrationUtxo(wire: DustRegistrationUtxoWire): DustRegistrationUtxoDto {
  return {
    txHash: wire.tx_hash,
    outputIndex: wire.output_index,
    dustAddressHex: wire.dust_address_hex,
    lovelace: wire.lovelace,
  };
}

/**
 * Thrown by `buildDustRegistrationTx` when Nexus responds 409 `already_registered`
 * — a live registration UTxO already exists for this stake credential. Carries
 * the live registrations Nexus found so callers can flip straight into the
 * duplicate-consolidation UI instead of surfacing a raw error.
 */
export class DustAlreadyRegisteredError extends Error {
  readonly registrations: DustRegistrationUtxoDto[];
  constructor(registrations: DustRegistrationUtxoDto[]) {
    super('A live DUST registration already exists for this wallet.');
    this.name = 'DustAlreadyRegisteredError';
    this.registrations = registrations;
  }
}

/**
 * Tx-utxos response (Midnight-shaped, distinct from Cardano TxIO).
 */
export interface MidnightTransactionUtxosDto {
  txHash: string;
  createdOutputs: MidnightUnshieldedUtxo[];
  spentOutputs: MidnightUnshieldedUtxo[];
}

/**
 * Network info — what `WalletFacade.init({ configuration })` needs.
 */
export interface MidnightNetworkInfoDto {
  networkId: 'mainnet' | 'preprod' | 'preview' | 'undeployed';
  indexerUri: string;
  indexerWsUri: string;
  proverServerUri: string;
  substrateNodeUri: string;
  /** Current chain era / runtime version. */
  era?: string;
  /** Current chain tip height — saves the wallet from a separate `/api/blocks/latest` call on init. */
  currentBlockHeight?: number;
}

/**
 * Build-registration-tx request body. Wallet supplies the user's Cardano
 * BASE address + target Midnight dust address; Nexus derives the STAKE key
 * hash from the address (the datum's `c_wallet` — the credential Midnight's
 * observation layer keys DUST generation on) and replies with the unsigned
 * Cardano CBOR. The wallet must witness with BOTH its payment and stake keys
 * (both are in requiredSigners, so the standard SIGN_TX resolver picks them
 * up automatically).
 */
export interface BuildDustRegistrationTxRequest {
  cardanoAddress: string;
  /**
   * 28-byte hex payment-key hash. Optional cross-check only — Nexus verifies
   * it against the address's payment credential when present.
   */
  paymentKeyHashHex: string;
  /** Midnight dust address bytes as hex (≤33 bytes / 66 hex chars). */
  dustAddressHex: string;
}

export interface BuildDustRegistrationTxResponse {
  /** `complete` (full unsigned tx CBOR included) or `primitives_only` (legacy Nexus). */
  status: 'primitives_only' | 'complete';
  txCbor: string | null;
  txHash: string | null;
  validatorAddress: string;
  validatorScriptHash: string;
  datumCbor: string;
  redeemerCbor: string;
  /** +1 on register, -1 on deregister, null on update (the NFT moves, nothing mints). */
  mintAsset: {
    policyId: string;
    assetNameHex: string;
    quantity: number;
  } | null;
  note?: string;
  /**
   * `txHash#index` of a Gero-provided collateral UTxO, present only when the wallet had
   * no pure-ADA UTxO of its own. When set, the signed tx MUST be co-signed by the
   * collateral pool (`nexusCollateralApi.cosign`) and that witness merged in before
   * submitting, or the node rejects it as missing a witness.
   */
  sponsoredCollateralRef?: string | null;
}

/** Wire-shape (snake_case) of the Nexus response, before conversion to camelCase. */
interface BuildDustRegistrationTxResponseWire {
  status: 'primitives_only' | 'complete';
  tx_cbor: string | null;
  tx_hash: string | null;
  validator_address: string;
  validator_script_hash: string;
  datum_cbor: string;
  redeemer_cbor: string;
  /** Null on the update tx (the NFT moves, nothing mints). */
  mint_asset: {
    policy_id: string;
    asset_name_hex: string;
    quantity: number;
  } | null;
  note?: string;
  sponsored_collateral_ref?: string | null;
}

/**
 * Request body for the deregistration / update endpoints. The registration
 * UTxO outpoint comes from `getDustStatus` (`registrationUtxoTxHash` /
 * `registrationUtxoOutputIndex`).
 */
export interface BuildDustManageTxRequest {
  cardanoAddress: string;
  /** Optional cross-check; derived server-side when absent. */
  paymentKeyHashHex?: string;
  registrationUtxoTxHash: string;
  registrationUtxoOutputIndex: number;
  /** Update only: replacement Midnight DUST address bytes as hex (≤33 bytes). */
  dustAddressHex?: string;
}

function manageWireBody(request: BuildDustManageTxRequest) {
  return {
    cardano_address: request.cardanoAddress,
    payment_key_hash_hex: request.paymentKeyHashHex,
    registration_utxo_tx_hash: request.registrationUtxoTxHash,
    registration_utxo_output_index: request.registrationUtxoOutputIndex,
    dust_address_hex: request.dustAddressHex,
  };
}

function convertBuildDustTxResponse(data: BuildDustRegistrationTxResponseWire): BuildDustRegistrationTxResponse {
  return {
    status: data.status,
    txCbor: data.tx_cbor,
    txHash: data.tx_hash,
    validatorAddress: data.validator_address,
    validatorScriptHash: data.validator_script_hash,
    datumCbor: data.datum_cbor,
    redeemerCbor: data.redeemer_cbor,
    mintAsset: data.mint_asset
      ? {
          policyId: data.mint_asset.policy_id,
          assetNameHex: data.mint_asset.asset_name_hex,
          quantity: data.mint_asset.quantity,
        }
      : null,
    note: data.note,
    sponsoredCollateralRef: data.sponsored_collateral_ref ?? null,
  };
}

// ─── Native send: Build / Sign / Submit  ─────────────────────────────────────
//
// These types mirror the Cardano `nexus-tx-api` shape: Nexus runs the SDK
// server-side (`UnshieldedWallet.transferTransaction` for unshielded;
// `ShieldedWallet.transferTransaction` for shielded), returns an
// `UnprovenTransaction` plus the segments the wallet must sign locally.
// The wallet signs each segment with the relevant role-derived secret key,
// re-bundles, optionally proves (shielded only), and posts the result back to
// Nexus's submit endpoint which relays to the Midnight RPC node.

/** One sub-output the user wants to send. */
export interface MidnightTxOutput {
  /** Recipient `mn_addr_<network>1…` for unshielded; `mn_shield-addr_…` for shielded. */
  address: string;
  /** Token amount in base units (NIGHT = 6 decimals; DUST = 15 decimals). */
  amount: string;
  /** Token type — `NIGHT` for native NIGHT (only currently supported asset). */
  token: 'NIGHT';
}

/** A single 32-byte intent hash that needs a BIP-340 signature from the wallet. */
export interface MidnightSegmentToSign {
  /** Index inside the unproven transaction's segment array. */
  index: number;
  /** Which HD role the segment expects to be signed with. */
  role: 'NightExternal' | 'Zswap';
  /** Hex-encoded 32-byte intent hash. */
  dataHex: string;
}

/** Phase 1 + 3: Nexus-built unproven tx returned to the wallet for signing. */
export interface BuildMidnightTxRequest {
  /** Sender's unshielded `mn_addr_…` address. Nexus uses this to fetch UTxOs. */
  fromAddress: string;
  /** Raw signing public key hex — from `UnshieldedKeystore.getPublicKey()`. Sidecar uses this for seedless construction. */
  publicKeyHex: string;
  /** Address bytes as hex — from `UnshieldedKeystore.getAddress()`. Sidecar uses this for seedless construction. */
  addressHex: string;
  outputs: MidnightTxOutput[];
  /** Time-to-live: epoch ms. Nexus computes the equivalent block-tip TTL. */
  ttlMs: number;
}

export interface BuildMidnightTxResponse {
  /** Hex-encoded `UnprovenTransaction` — Substrate extrinsic-shaped bytes. */
  unprovenTxHex: string;
  /** SDK-computed tx hash for receipts; final hash may differ if proving rebinds. */
  txHash: string;
  segmentsToSign: MidnightSegmentToSign[];
}

/**
 * Shield-swap-mode request (WP-SH1, nexus repo): builds ONLY the unshielded
 * (public) half of a shield conversion — an unproven tx that spends the
 * sender's own NIGHT UTxOs covering {@code amount} and returns change ONLY
 * (no payment output; the consumed value is completed by the shielded
 * output the wallet builds separately via `ShieldedWallet.initSwap` — see
 * `midnightShieldSwapBuilder.ts`).
 *
 * WP-SH1 has shipped on nexus's `development` branch. The wire field names
 * were originally a best-effort guess (see docs/plans/2026-07-13-midnight-
 * shield-unshield.md section 0); `shieldAmount` turned out wrong and 400'd
 * with nexus's actual validator name: `swapAmountValidForMode: swapAmount
 * required (positive integer string) when swapMode is true`. Field names
 * below are now `swapMode` + `swapAmount`, confirmed against that response.
 */
export interface BuildShieldSwapTxRequest {
  /** Sender's unshielded `mn_addr_…` address. Nexus uses this to fetch UTxOs. */
  fromAddress: string;
  /** Raw signing public key hex — from `UnshieldedKeystore.getPublicKey()`. */
  publicKeyHex: string;
  /** Address bytes as hex — from `UnshieldedKeystore.getAddress()`. */
  addressHex: string;
  /** Amount of NIGHT (base units, 6 decimals) to move into the shielded pool. */
  amount: string;
  /** Time-to-live: epoch ms. */
  ttlMs: number;
}

/** Phase 1 + 3: signed (and proven, for shielded) tx submitted to Nexus. */
export interface SubmitMidnightTxRequest {
  /** Hex-encoded fully-signed tx ready for the Midnight RPC node. */
  signedTxHex: string;
  /** Optional: hint for Nexus to propagate finality status. */
  waitFor?: 'Submitted' | 'InBlock' | 'Finalized';
}

export interface SubmitMidnightTxResponse {
  txHash: string;
  status: 'Submitted' | 'InBlock' | 'Finalized';
  blockHash?: string;
  blockHeight?: number;
}

// ─── Path A: Midnight-native DUST registration (NIGHT-for-DUST) ──────────────
//
// Registers the wallet's OWN NIGHT UTxOs to generate DUST for the wallet's
// own dust address. Signed locally with the NightExternal key. No Cardano
// interaction. First-time registration is fee-free. Different shape from
// Path B (Cardano-side mapping validator); they coexist for cNIGHT holders.

export interface BuildNightDustRegistrationRequest {
  /** Sender's unshielded `mn_addr_…` address. Used by sidecar to read NIGHT UTxOs. */
  fromAddress: string;
  /** Raw signing public key hex — `UnshieldedKeystore.getPublicKey()`. */
  publicKeyHex: string;
  /** Address bytes as hex — `UnshieldedKeystore.getAddress()`. */
  addressHex: string;
  /** User's DUST address (bech32m `mn_dust-addr_<network>1…`). REQUIRED. */
  dustReceiverAddressBech32: string;
  /** Tx TTL as epoch ms (must be in the future). */
  ttlMs: number;
}

export interface BuildNightDustRegistrationResponse {
  unprovenTxHex: string;
  txHash: string;
  /** Single signature payload (hex). Signed with NightExternal key. */
  signaturePayloadHex: string;
}

export interface SubmitNightDustRegistrationRequest {
  unprovenTxHex: string;
  /** Hex of the NightExternal signature over the build's signaturePayloadHex. */
  signatureHex: string;
}

export interface SubmitNightDustRegistrationResponse {
  txHash: string;
  status: 'Submitted' | 'InBlock' | 'Finalized';
}

/**
 * Single shared axios instance — uses the Midnight network's Nexus URL from config.
 * Caller passes the `network` per call so we can reuse one instance across sessions.
 */
export class MidnightApi {
  private readonly network: string;
  private readonly nexusBaseUrl: string;
  private readonly axiosInstance: AxiosInstance;

  constructor(network: string) {
    const endpoints = getMidnightEndpoints(network);
    if (!endpoints) {
      throw new Error(`Midnight network not configured: ${network}`);
    }
    this.network = network;
    this.nexusBaseUrl = endpoints.nexusBaseUrl;
    this.axiosInstance = axios.create({
      baseURL: this.nexusBaseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Nexus's Midnight DUST controller (and the broader Midnight API surface)
    // is gated by `@PreAuthorize("@securityExpressions.canReadMidnight()")`,
    // so every request needs the device JWT. Mirror the auth + retry pattern
    // from `nexus-tx-api.ts`: bearer token on each request, drop + reauth +
    // retry once on 401.
    this.axiosInstance.interceptors.request.use(async (config) => {
      const token = await getNexusAccessToken();
      config.headers.Authorization = `Bearer ${token}`;
      return config;
    });
    this.axiosInstance.interceptors.response.use(
      (res) => res,
      async (error: AxiosError) => {
        const cfg = error.config as AxiosRequestConfig & { _retried?: boolean };
        // Retry on 401 (token invalid) AND 403 (token valid but missing
        // scopes — happens when Nexus adds new scopes to DEFAULT_SCOPES and
        // the wallet's cached JWT predates them; only a fresh login picks up
        // the new claim set). The _retried flag prevents loops if the
        // server genuinely denies after re-auth.
        const status = error.response?.status;
        if ((status === 401 || status === 403) && cfg && !cfg._retried) {
          cfg._retried = true;
          try {
            const token = await reauthenticateNexus();
            if (cfg.headers) {
              cfg.headers.Authorization = `Bearer ${token}`;
            }
            return this.axiosInstance.request(cfg);
          } catch (refreshErr) {
            debugLog(`[midnight-api] Reauth failed after ${status}:`, refreshErr);
            throw error;
          }
        }
        throw error;
      },
    );
  }

  /** The Nexus `?network=` slug for chain-agnostic endpoints (`midnight-preview` etc.). */
  private get nexusNetworkSlug(): string {
    return getMidnightEndpoints(this.network)!.sdkNetworkId === 'mainnet'
      ? 'midnight-mainnet'
      : `midnight-${getMidnightEndpoints(this.network)!.sdkNetworkId}`;
  }

  // ---------------------------------------------------------------- Blocks

  async getLatestBlock(): Promise<MidnightBlockDto> {
    try {
      const { data, status } = await this.axiosInstance.get<MidnightBlockDto>(
        `/api/blocks/latest?network=${this.nexusNetworkSlug}`,
      );
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async getBlockByHash(hash: string): Promise<MidnightBlockDto> {
    try {
      const { data, status } = await this.axiosInstance.get<MidnightBlockDto>(
        `/api/blocks/${encodeURIComponent(hash)}?network=${this.nexusNetworkSlug}`,
      );
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  // ---------------------------------------------------------------- Transactions

  async getTransaction(txHash: string): Promise<MidnightTransactionDto> {
    try {
      const { data, status } = await this.axiosInstance.get<MidnightTransactionDto>(
        `/transactions/${encodeURIComponent(txHash)}?network=${this.nexusNetworkSlug}`,
      );
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * Batch-fetch transaction CBORs by hash.
   * Backed by Nexus's `POST /transactions/cbor`.
   */
  async batchTransactionCbors(txHashes: string[]): Promise<Record<string, string>> {
    if (txHashes.length === 0) return {};
    try {
      const { data, status } = await this.axiosInstance.post<Record<string, string>>(
        `/transactions/cbor?network=${this.nexusNetworkSlug}`,
        { hashes: txHashes },
      );
      if (status === 200) return data ?? {};
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * Fetch the Midnight-shaped UTxOs for a given transaction (created + spent).
   * Backed by Nexus's `GET /api/midnight/{network}/transactions/{txHash}/utxos`.
   */
  async getTransactionUtxos(txHash: string): Promise<MidnightTransactionUtxosDto> {
    try {
      const url = nexusMidnightPathFor(this.network, `transactions/${encodeURIComponent(txHash)}/utxos`);
      const { data, status } = await this.axiosInstance.get<MidnightTransactionUtxosDto>(url);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  // NOTE: an older `submitTransaction()` targeting a Nexus `transactions/submit`
  // substrate-RPC proxy was removed — that endpoint does not exist on Nexus
  // (submission goes through `tx/submit` → sidecar finalize, see
  // `submitMidnightTx()`).

  // ---------------------------------------------------------------- DUST

  /**
   * Single-address DUST registration status.
   */
  async getDustStatus(cardanoRewardAddress: string): Promise<MidnightDustRegistrationStatusDto> {
    try {
      const url = nexusMidnightPathFor(this.network, 'dust/status') +
        `?cardanoRewardAddress=${encodeURIComponent(cardanoRewardAddress)}`;
      const { data, status } = await this.axiosInstance.get<MidnightDustRegistrationStatusWire>(url);
      if (status === 200) return convertDustStatus(data);
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * Live registration UTxOs for a stake credential — the source of truth for
   * duplicate detection. Empty array when there are none. A transient
   * failure here should NOT be treated as "no registrations" by callers;
   * see `useCnightDustRegistration`'s resilient wrapper.
   */
  async getDustRegistrations(cardanoRewardAddress: string): Promise<DustRegistrationUtxoDto[]> {
    try {
      const url = nexusMidnightPathFor(this.network, 'dust/registrations') +
        `?cardanoRewardAddress=${encodeURIComponent(cardanoRewardAddress)}`;
      const { data, status } = await this.axiosInstance.get<{ registrations: DustRegistrationUtxoWire[] }>(url);
      if (status === 200) return (data.registrations ?? []).map(convertRegistrationUtxo);
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * Batch DUST registration status. Nexus enforces a max of 50 addresses per call.
   */
  async getDustStatusBatch(cardanoRewardAddresses: string[]): Promise<MidnightDustRegistrationStatusDto[]> {
    if (cardanoRewardAddresses.length === 0) return [];
    if (cardanoRewardAddresses.length > 50) {
      throw new Error('getDustStatusBatch: max 50 addresses per call');
    }
    try {
      const url = nexusMidnightPathFor(this.network, 'dust/status/batch');
      const { data, status } = await this.axiosInstance.post<MidnightDustRegistrationStatusWire[]>(url, {
        cardanoRewardAddresses,
      });
      if (status === 200) return (data ?? []).map(convertDustStatus);
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * Submit a fully-signed Cardano transaction through Nexus's own submit
   * endpoint (`POST /api/transactions/submit`) on the anchored Cardano
   * network. Nexus owns provider routing internally — the wallet must NOT
   * submit via Blockfrost/Koios directly. On rejection Nexus returns the
   * node's actual ledger error in the response body, which parseHttpError
   * surfaces (unlike the bare 400 from the legacy blockchain-api path).
   */
  async submitCardanoTx(signedTxCborHex: string): Promise<string> {
    try {
      const endpoints = getMidnightEndpoints(this.network);
      if (!endpoints) throw new Error(`Unknown Midnight network: ${this.network}`);
      const url = `${endpoints.nexusBaseUrl}/api/transactions/submit?network=cardano-${endpoints.sdkNetworkId}`;
      const { data, status } = await this.axiosInstance.post<string>(url, signedTxCborHex, {
        headers: { 'Content-Type': 'text/plain' },
      });
      if (status === 200 && typeof data === 'string') return data.replace(/"/g, '');
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * Whether a Cardano transaction is on-chain, via Nexus
   * (`GET /api/transactions/{txHash}/utxos`). Returns `true` when the indexer
   * knows the tx (HTTP 200) and `false` on a definitive 404 (not on-chain).
   * Any other status/network failure THROWS, so callers can distinguish
   * "definitely absent" from "couldn't determine" — used to reconcile the local
   * DUST-pending guard against a submission that never actually landed.
   */
  async cardanoTxExists(txHash: string): Promise<boolean> {
    const endpoints = getMidnightEndpoints(this.network);
    if (!endpoints) throw new Error(`Unknown Midnight network: ${this.network}`);
    const url = `${endpoints.nexusBaseUrl}/api/transactions/${encodeURIComponent(txHash)}/utxos`
      + `?network=cardano-${endpoints.sdkNetworkId}`;
    const { status } = await this.axiosInstance.get(url, {
      validateStatus: (s) => s === 200 || s === 404,
    });
    return status === 200;
  }

  /**
   * Evaluate a Cardano transaction's Plutus scripts via Nexus
   * (`POST /api/transactions/evaluate`) WITHOUT submitting — returns per-redeemer
   * ExUnits or the script/ledger failure. Diagnostic aid for DUST-tx rejections.
   */
  async evaluateCardanoTx(txCborHex: string): Promise<unknown> {
    try {
      const endpoints = getMidnightEndpoints(this.network);
      if (!endpoints) throw new Error(`Unknown Midnight network: ${this.network}`);
      const url = `${endpoints.nexusBaseUrl}/api/transactions/evaluate?network=cardano-${endpoints.sdkNetworkId}`;
      const { data } = await this.axiosInstance.post(url, { cbor: txCborHex });
      return data;
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * Build the unsigned Cardano transaction that registers the wallet's DUST
   * address under the Midnight DUST mapping validator. The wallet signs the
   * returned `txCbor` with its payment + stake keys and submits via Nexus's
   * Cardano `submit` endpoint (never Blockfrost/Koios).
   *
   * Nexus's request/response use snake_case JSON; we convert at the wire
   * boundary so callers see the camelCase TS shape.
   */
  async buildDustRegistrationTx(
    request: BuildDustRegistrationTxRequest,
  ): Promise<BuildDustRegistrationTxResponse> {
    try {
      const url = nexusMidnightPathFor(this.network, 'dust/build-registration-tx');
      const wireBody = {
        cardano_address: request.cardanoAddress,
        payment_key_hash_hex: request.paymentKeyHashHex,
        dust_address_hex: request.dustAddressHex,
      };
      const { data, status } = await this.axiosInstance.post<BuildDustRegistrationTxResponseWire>(url, wireBody);
      if (status !== 200) throw parseHttpError(data);
      return convertBuildDustTxResponse(data);
    } catch (error) {
      // Nexus refuses to build a second registration when a live one already
      // exists (Midnight allows exactly one per stake credential). Surface a
      // typed error carrying the live registrations so the UI can flip into
      // the duplicate-consolidation state instead of a raw error toast.
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        const body = error.response.data as { error?: string; registrations?: DustRegistrationUtxoWire[] };
        if (body?.error === 'already_registered') {
          throw new DustAlreadyRegisteredError((body.registrations ?? []).map(convertRegistrationUtxo));
        }
      }
      throw parseHttpError(error);
    }
  }

  /**
   * Build the unsigned DEREGISTRATION tx: spends the on-chain registration UTxO
   * (outpoint comes from `getDustStatus`) and burns the mapping NFT. Accumulated
   * DUST decays to zero after relay. Same sign+submit contract as registration
   * (payment + stake key witnesses).
   */
  async buildDustDeregistrationTx(
    request: BuildDustManageTxRequest,
  ): Promise<BuildDustRegistrationTxResponse> {
    try {
      const url = nexusMidnightPathFor(this.network, 'dust/build-deregistration-tx');
      const { data, status } = await this.axiosInstance.post<BuildDustRegistrationTxResponseWire>(
        url, manageWireBody(request));
      if (status !== 200) throw parseHttpError(data);
      return convertBuildDustTxResponse(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * Build the unsigned mapping UPDATE tx: spends the registration UTxO and
   * re-outputs the NFT with a datum pointing at `dustAddressHex` (script-
   * authorized withdrawal handled server-side). Used to move the DUST
   * destination to this wallet's own address.
   */
  async buildDustUpdateTx(
    request: BuildDustManageTxRequest,
  ): Promise<BuildDustRegistrationTxResponse> {
    try {
      const url = nexusMidnightPathFor(this.network, 'dust/build-update-tx');
      const { data, status } = await this.axiosInstance.post<BuildDustRegistrationTxResponseWire>(
        url, manageWireBody(request));
      if (status !== 200) throw parseHttpError(data);
      return convertBuildDustTxResponse(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * Cardano UTxOs of `address` that hold `assetUnit` (policyId + assetNameHex),
   * via Nexus's chain-data API on the anchored Cardano network (the device
   * token carries CARDANO_READ). Used by the DUST sources panel to read
   * sibling wallets' cNIGHT balances through Nexus — the wallet never talks
   * to an explorer directly.
   *
   * Note: single page of up to 100 UTxOs — plenty for a balance display; a
   * wallet fragmented across more cNIGHT UTxOs would show a floor, not the
   * exact total.
   */
  async getCardanoAssetUtxos(
    address: string,
    assetUnit: string,
  ): Promise<Array<{ assets?: Array<{ unit?: string; policyId?: string; assetName?: string; quantity?: string }> }>> {
    try {
      const endpoints = getMidnightEndpoints(this.network);
      if (!endpoints) throw new Error(`Unknown Midnight network: ${this.network}`);
      const url = `${endpoints.nexusBaseUrl}/api/addresses/${encodeURIComponent(address)}`
        + `/utxos/${assetUnit}?network=cardano-${endpoints.sdkNetworkId}&pageSize=100`;
      const { data, status } = await this.axiosInstance.get(url);
      if (status === 200) return data ?? [];
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  // ---------------------------------------------------------------- Network info

  /**
   * Network info for `WalletFacade.init({ configuration })` — endpoints + current era.
   */
  async getNetworkInfo(): Promise<MidnightNetworkInfoDto> {
    try {
      const url = nexusMidnightPathFor(this.network, 'info');
      const { data, status } = await this.axiosInstance.get<MidnightNetworkInfoDto>(url);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  // ---------------------------------------------------------------- GraphQL passthrough

  /**
   * Raw GraphQL POST proxy — for queries Nexus doesn't expose as REST yet
   * (e.g. shielded subscription queries via the wallet SDK).
   *
   * Backed by Nexus's `POST /api/midnight/{network}/indexer/graphql`.
   */
  async graphql<T = unknown>(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    try {
      const url = nexusMidnightPathFor(this.network, 'indexer/graphql');
      const { data, status } = await this.axiosInstance.post<{ data?: T; errors?: unknown[] }>(url, {
        query,
        variables,
      });
      if (status !== 200) throw parseHttpError(data);
      if (data?.errors && data.errors.length > 0) {
        throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
      }
      return data.data as T;
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  // ─── Native send: build / submit ──────────────────────────────────────────

  /**
   * Phase 1: Nexus runs `UnshieldedWallet.transferTransaction(outputs, ttl)`
   * server-side and returns the UnprovenTransaction plus the intent-hash
   * segments the wallet must sign with its NightExternal role-derived key.
   *
   * This is the unshielded code path — no proof generation needed. Shielded
   * transfers route through `buildShieldedTx` (Phase 3) which returns the
   * same shape but the wallet must additionally call the proof server before
   * submitting.
   *
   * **Endpoint contract (Nexus-side TBD)**:
   * `POST /api/midnight/{network}/tx/build-unshielded`
   */
  async buildUnshieldedTx(request: BuildMidnightTxRequest): Promise<BuildMidnightTxResponse> {
    try {
      const url = nexusMidnightPathFor(this.network, 'tx/build-unshielded');
      const { data, status } = await this.axiosInstance.post<BuildMidnightTxResponse>(url, request);
      if (status !== 200) throw parseHttpError(data);
      return data;
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * Shield (public → private), unshielded half (WP-SH1 + WP-SH2): same
   * route as {@link buildUnshieldedTx} with an empty `outputs[]` and a
   * `swapMode` flag (see {@link BuildShieldSwapTxRequest}'s doc comment —
   * field names are now confirmed against nexus's own `swapAmountValidForMode`
   * validator, not just a guess). Response is the SAME shape as
   * `buildUnshieldedTx`'s — confirmed against the nexus route's own doc
   * comment (`{unprovenTxHex, txHash, segmentsToSign}`), so no separate
   * response type is declared.
   */
  async buildShieldSwapUnshieldedTx(request: BuildShieldSwapTxRequest): Promise<BuildMidnightTxResponse> {
    try {
      const url = nexusMidnightPathFor(this.network, 'tx/build-unshielded');
      const wireBody = {
        fromAddress: request.fromAddress,
        publicKeyHex: request.publicKeyHex,
        addressHex: request.addressHex,
        outputs: [] as MidnightTxOutput[],
        swapMode: true,
        swapAmount: request.amount,
        ttlMs: request.ttlMs,
      };
      const { data, status } = await this.axiosInstance.post<BuildMidnightTxResponse>(url, wireBody);
      if (status !== 200) throw parseHttpError(data);
      return data;
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * Phase 1 + 3: submit a fully signed (and proven, for shielded) tx via
   * Nexus's relay. Nexus calls `PolkadotNodeClient.sendMidnightTransaction`
   * against the Midnight RPC node and bubbles the resulting submission event
   * back to the caller. The wallet treats `Submitted` as enough to mark the
   * tx pending; `InBlock`/`Finalized` are surfaced if Nexus waits.
   *
   * **Endpoint contract (Nexus-side TBD)**:
   * `POST /api/midnight/{network}/tx/submit`
   */
  async submitMidnightTx(request: SubmitMidnightTxRequest): Promise<SubmitMidnightTxResponse> {
    try {
      const url = nexusMidnightPathFor(this.network, 'tx/submit');
      const { data, status } = await this.axiosInstance.post<SubmitMidnightTxResponse>(url, request);
      if (status !== 200) throw parseHttpError(data);
      return data;
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * Shielded: hand the SIGNED-but-UNPROVEN shielded tx hex to Nexus's relay,
   * which forwards to the sidecar's /tx/prove-and-submit. The sidecar runs
   * the ZK prover, binds the tx, and submits via the Midnight RPC node.
   *
   * Endpoint: POST /api/midnight/{network}/tx/prove-and-submit
   *
   * Privacy: the {@code signedTxHex} body contains witness data that lets
   * whoever reads it link the user's shielded notes to this spend. The
   * wallet must surface explicit user consent before calling this (see
   * ShieldedProvingConsentDialog). Sidecar pledges not to log or persist
   * the body — see sidecar/src/routes/proveAndSubmit.ts.
   *
   * Phase 1 returns {@code SubmitMidnightTxResponse} — same shape as the
   * unshielded path. A dedicated response type may follow when the sidecar
   * surfaces proving duration or proof-server identity for UX progress.
   */
  async proveAndSubmitMidnightTx(
    request: { signedTxHex: string; waitFor?: 'Submitted' | 'InBlock' | 'Finalized' },
  ): Promise<SubmitMidnightTxResponse> {
    try {
      const url = nexusMidnightPathFor(this.network, 'tx/prove-and-submit');
      const { data, status } = await this.axiosInstance.post<SubmitMidnightTxResponse>(url, request);
      if (status !== 200) throw parseHttpError(data);
      return data;
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * Local proving (WP-P2): submit an ALREADY-PROVEN shielded tx (produced
   * by the wallet's own local ProvingProvider — see
   * `chains/midnight/midnightLocalProver.ts`) via Nexus's relay to the
   * sidecar's /tx/submit-proven (WP-P3). Unlike proveAndSubmitMidnightTx,
   * the sidecar does NOT re-prove it — `ledger.prove()` throws if called on
   * an already-proven tx — it just deserializes and submits via the
   * Midnight RPC node.
   *
   * Endpoint: POST /api/midnight/{network}/tx/submit-proven
   *
   * Privacy: a proven tx carries no witness data (the proof is
   * zero-knowledge), so unlike proveAndSubmitMidnightTx this body is safe
   * to log server-side.
   */
  async submitProvenMidnightTx(
    request: SubmitMidnightTxRequest,
  ): Promise<SubmitMidnightTxResponse> {
    try {
      const url = nexusMidnightPathFor(this.network, 'tx/submit-proven');
      const { data, status } = await this.axiosInstance.post<SubmitMidnightTxResponse>(url, request);
      if (status !== 200) throw parseHttpError(data);
      return data;
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * Current DUST account state for a Midnight unshielded address.
   *
   * <p>Returns balance, per-second generation rate, cap, total NIGHT
   * registered, and registration/generation status. Math is deterministic
   * on the server (UTxO ledger + chain dust params), so this is cheap and
   * safe to poll on a short interval while a dust-related view is open.
   */
  async getDustAccountState(address: string): Promise<{
    dust_balance: string;
    dust_generating: string;
    dust_cap: string;
    night_registered: string;
    dust_registration_status: 'Unregistered' | 'Registered' | string;
    dust_generation_status: 'empty' | 'refilling' | 'filled' | string;
    dust_time_remaining_seconds: number | null;
  }> {
    try {
      const url = nexusMidnightPathFor(this.network, `dust/account-state/${encodeURIComponent(address)}`);
      const { data, status } = await this.axiosInstance.get(url, { timeout: 5_000 });
      if (status !== 200) throw parseHttpError(data);
      return data;
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  // ─── Path A: NIGHT-for-DUST registration (Midnight-native) ────────────────

  /**
   * Build the Midnight-native DUST registration tx. Nexus's sidecar reads
   * the user's NIGHT UTxOs from the cached UnshieldedWallet and builds the
   * unproven extrinsic via `DustWallet.createDustGenerationTransaction`.
   * Returns the unproven tx + a single signature payload the wallet must
   * sign with its NightExternal key.
   */
  async buildNightDustRegistrationTx(
    request: BuildNightDustRegistrationRequest,
  ): Promise<BuildNightDustRegistrationResponse> {
    try {
      const url = nexusMidnightPathFor(this.network, 'dust/build-night-registration');
      const wireBody = {
        from_address: request.fromAddress,
        public_key_hex: request.publicKeyHex,
        address_hex: request.addressHex,
        dust_receiver_address_bech32: request.dustReceiverAddressBech32,
        ttl_ms: request.ttlMs,
      };
      // Per-call timeout override: the sidecar runs the dust SDK
      // synchronously (createDustGenerationTransaction + one indexer
      // blockData() HTTP roundtrip), which can take 30s+ on first call
      // because the wallet cache may also be (re)hydrating. Use 90s here
      // rather than the instance-level 30s default.
      const { data, status } = await this.axiosInstance.post<{
        unproven_tx_hex: string;
        tx_hash: string;
        signature_payload_hex: string;
      }>(url, wireBody, { timeout: 90_000 });
      if (status !== 200) throw parseHttpError(data);
      return {
        unprovenTxHex: data.unproven_tx_hex,
        txHash: data.tx_hash,
        signaturePayloadHex: data.signature_payload_hex,
      };
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * Submit the wallet-signed DUST registration tx. Sidecar splices the
   * NightExternal signature into intent #1 and returns the serialized
   * extrinsic; Nexus submits via `author_submitExtrinsic`.
   */
  async submitNightDustRegistrationTx(
    request: SubmitNightDustRegistrationRequest,
  ): Promise<SubmitNightDustRegistrationResponse> {
    try {
      const url = nexusMidnightPathFor(this.network, 'dust/submit-night-registration');
      const wireBody = {
        unproven_tx_hex: request.unprovenTxHex,
        signature_hex: request.signatureHex,
      };
      // Same 90s ceiling as build — finalize is fast (just splices signature)
      // but the subsequent substrate submission can stall briefly on first
      // call. 90s is well above any expected real-world latency.
      const { data, status } = await this.axiosInstance.post<{
        tx_hash: string;
        status: 'Submitted' | 'InBlock' | 'Finalized';
      }>(url, wireBody, { timeout: 90_000 });
      if (status !== 200) throw parseHttpError(data);
      return { txHash: data.tx_hash, status: data.status };
    } catch (error) {
      throw parseHttpError(error);
    }
  }
}

/**
 * Cached per-network instances — most wallets only ever use one network at a time.
 */
const apiCache = new Map<string, MidnightApi>();

export function getMidnightApi(network: string): MidnightApi {
  let api = apiCache.get(network);
  if (!api) {
    api = new MidnightApi(network);
    apiCache.set(network, api);
  }
  return api;
}
