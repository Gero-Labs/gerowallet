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
 * - `/api/v1/midnight/{network}/...` for Midnight-specific resources
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
  /** Status string: `Unregistered` | `Pending` | `Registered` | `Invalid`. */
  registrationStatus?: string;
  /** Strings for BigInt portability across JSON. */
  nightBalance?: string;
  generationRate?: string;
  maxCapacity?: string;
  currentCapacity?: string;
  registrationUtxoTxHash?: string | null;
  registrationUtxoOutputIndex?: number | null;
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
 * address + payment-key hash + target Midnight dust address; Nexus replies
 * with the unsigned Cardano CBOR for the wallet to sign via CIP-30.
 */
export interface BuildDustRegistrationTxRequest {
  cardanoAddress: string;
  /** 28-byte hex payment-key hash. */
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
  mintAsset: {
    policyId: string;
    assetNameHex: string;
    quantity: number;
  };
  note?: string;
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
  mint_asset: {
    policy_id: string;
    asset_name_hex: string;
    quantity: number;
  };
  note?: string;
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
        if (error.response?.status === 401 && cfg && !cfg._retried) {
          cfg._retried = true;
          try {
            const token = await reauthenticateNexus();
            if (cfg.headers) {
              cfg.headers.Authorization = `Bearer ${token}`;
            }
            return this.axiosInstance.request(cfg);
          } catch (refreshErr) {
            debugLog('[midnight-api] Reauth failed after 401:', refreshErr);
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
        `/v1/transactions/${encodeURIComponent(txHash)}?network=${this.nexusNetworkSlug}`,
      );
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * Batch-fetch transaction CBORs by hash.
   * Backed by Nexus's `POST /v1/transactions/cbor`.
   */
  async batchTransactionCbors(txHashes: string[]): Promise<Record<string, string>> {
    if (txHashes.length === 0) return {};
    try {
      const { data, status } = await this.axiosInstance.post<Record<string, string>>(
        `/v1/transactions/cbor?network=${this.nexusNetworkSlug}`,
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
   * Backed by Nexus's `GET /api/v1/midnight/{network}/transactions/{txHash}/utxos`.
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

  /**
   * Submit a signed Midnight (Substrate) transaction.
   * Backed by Nexus's substrate-RPC proxy → `author_submitExtrinsic`.
   */
  async submitTransaction(signedTxHex: string): Promise<{ txHash: string }> {
    try {
      const url = nexusMidnightPathFor(this.network, 'transactions/submit');
      const { data, status } = await this.axiosInstance.post<{ txHash: string }>(url, {
        signedTx: signedTxHex,
      });
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  // ---------------------------------------------------------------- DUST

  /**
   * Single-address DUST registration status.
   */
  async getDustStatus(cardanoRewardAddress: string): Promise<MidnightDustRegistrationStatusDto> {
    try {
      const url = nexusMidnightPathFor(this.network, 'dust/status') +
        `?cardanoRewardAddress=${encodeURIComponent(cardanoRewardAddress)}`;
      const { data, status } = await this.axiosInstance.get<MidnightDustRegistrationStatusDto>(url);
      if (status === 200) return data;
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
      const { data, status } = await this.axiosInstance.post<MidnightDustRegistrationStatusDto[]>(url, {
        cardanoRewardAddresses,
      });
      if (status === 200) return data ?? [];
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * Build the unsigned Cardano transaction that registers the wallet's DUST
   * address under the Midnight DUST mapping validator. The wallet signs the
   * returned `txCbor` with the user's Cardano payment key (the same key used
   * for every other Cardano tx) and submits via the existing Cardano
   * `submit-tx` endpoint.
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
      return {
        status: data.status,
        txCbor: data.tx_cbor,
        txHash: data.tx_hash,
        validatorAddress: data.validator_address,
        validatorScriptHash: data.validator_script_hash,
        datumCbor: data.datum_cbor,
        redeemerCbor: data.redeemer_cbor,
        mintAsset: {
          policyId: data.mint_asset.policy_id,
          assetNameHex: data.mint_asset.asset_name_hex,
          quantity: data.mint_asset.quantity,
        },
        note: data.note,
      };
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
   * Backed by Nexus's `POST /api/v1/midnight/{network}/indexer/graphql`.
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
   * `POST /api/v1/midnight/{network}/tx/build-unshielded`
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
   * Phase 1 + 3: submit a fully signed (and proven, for shielded) tx via
   * Nexus's relay. Nexus calls `PolkadotNodeClient.sendMidnightTransaction`
   * against the Midnight RPC node and bubbles the resulting submission event
   * back to the caller. The wallet treats `Submitted` as enough to mark the
   * tx pending; `InBlock`/`Finalized` are surfaced if Nexus waits.
   *
   * **Endpoint contract (Nexus-side TBD)**:
   * `POST /api/v1/midnight/{network}/tx/submit`
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
