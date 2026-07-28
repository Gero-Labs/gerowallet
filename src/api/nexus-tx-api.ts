/**
 * Nexus transaction builder API client.
 *
 * Replaces client-side buildCardanoTransaction calls with server-side builds via
 * nexus's /api/tx/build* endpoints. Server-side building is preferable because:
 *   - protocol params are always fresh (server fetches from chain)
 *   - fee calculation matches the canonical Cardano JVM/Aiken impl
 *   - upgrades happen on the server, no extension release required
 *
 * Auth: none on the client. Requests go to gero-backend's Nexus proxy
 * (VITE_NEXUS_URL → <backend>/api/nexus), which injects the Nexus API key
 * server-side. The backend gates the extension by Origin/IP.
 */

import axios, { AxiosError } from 'axios';
import { Cardano } from '@cardano-sdk/core';
import { Network } from '@/models/types';
import { filterOutCollateralFromUTxOs } from '@/chrome/serialization';

// ── Request / response types matching nexus's BuildTxRequest / BuildTxResponse ──

/**
 * Nexus expects assets split into policyId (first 56 hex chars) and assetName
 * (remaining hex chars), unlike CIP-30 which uses a single concatenated `unit`.
 */
export interface NexusTxAsset {
  policyId: string;
  assetName: string;
  quantity: string;
}

/**
 * Split a Cardano `unit` (policyId + assetName concatenated as hex) into the
 * separate fields nexus's TxAssetRequest expects.
 *
 * Examples:
 *   "10a49b...4745524f"  → { policyId: "10a49b...", assetName: "4745524f" }  // GERO
 *   "10a49b...0014df10..." → { policyId: "10a49b...", assetName: "0014df10..." }  // ref token
 *   "abc...56hex"        → { policyId: "abc...", assetName: "" }  // empty-name token
 */
function splitAssetUnit(unit: string): { policyId: string; assetName: string } {
  return {
    policyId: unit.slice(0, 56),
    assetName: unit.slice(56),
  };
}

export interface NexusTxOutput {
  address: string;
  lovelace: string;
  assets?: NexusTxAsset[];
}

export interface NexusTxInput {
  txHash: string;
  outputIndex: number;
  address: string;
  lovelace: string;
  assets?: NexusTxAsset[];
  dataHash?: string;
  inlineDatum?: string;
  referenceScriptHash?: string;
}

/**
 * Reward withdrawal attached to a transfer tx. Matches Nexus's TxWithdrawalRequest.
 * Maps to the tx body's `withdrawals` field (separate from `certificates`).
 */
export interface NexusTxWithdrawal {
  stakeAddress: string;
  amount: string;
}

export interface BuildTxRequest {
  outputs: NexusTxOutput[];
  changeAddress: string;
  utxos?: NexusTxInput[];
  senderAddress?: string;
  network?: 'MAINNET' | 'PREPROD';
  ttl?: number;
  metadata?: Record<string, unknown>;
  /** When true, forces selection of ALL UTxOs (used for send-max). */
  selectAll?: boolean;
  /** Optional reward withdrawals to pull into the tx. */
  withdrawals?: NexusTxWithdrawal[];
}

export interface BuildTxResponse {
  tx_cbor: string;
  tx_hash: string;
  estimated_fee?: string;
  estimated_signatures?: number;
}

/**
 * Plain reward-withdrawal build request. Matches nexus `BuildWithdrawalTxRequest`.
 * Note: this endpoint takes a single stakeAddress + amount and does NOT accept extra
 * outputs/metadata — so the CIP-149 donation path stays on the client builder for now.
 */
export interface BuildWithdrawalTxRequest {
  stakeAddress: string;
  amount: string;
  changeAddress: string;
  utxos?: NexusTxInput[];
  senderAddress?: string;
  network?: 'MAINNET' | 'PREPROD';
  ttl?: number;
}

/**
 * Stake-key registration / deregistration build request. Matches nexus
 * `BuildStakeRegistrationTxRequest`. Note: this endpoint does NOT accept a
 * `withdrawals` field, so a deregistration that also claims pending rewards
 * must stay on the client builder until the endpoint gains withdrawal support.
 */
export interface BuildStakeRegistrationTxRequest {
  stakeAddress: string;
  changeAddress: string;
  utxos?: NexusTxInput[];
  senderAddress?: string;
  network?: 'MAINNET' | 'PREPROD';
  deregister: boolean;
  ttl?: number;
}

/**
 * Stake-pool delegation build request. Matches nexus `BuildDelegationTxRequest`.
 * Pool-only (emits a single StakeDelegation cert); set `includeStakeRegistration`
 * to prepend a stake-key registration (deposit folded server-side). No vote cert —
 * for the combined pool+vote first-delegation flow use BuildVoteDelegationTxRequest.
 */
export interface BuildDelegationTxRequest {
  stakeAddress: string;
  poolId: string;
  changeAddress: string;
  utxos?: NexusTxInput[];
  senderAddress?: string;
  network?: 'MAINNET' | 'PREPROD';
  includeStakeRegistration?: boolean;
  ttl?: number;
}

/**
 * Vote-delegation build request. Matches nexus `BuildVoteDelegationTxRequest`.
 * `drepId`: `drep_always_abstain` | `drep_always_no_confidence` | bech32 | hex.
 * `poolId` present → combined pool+vote (StakeVoteDelegCert / StakeVoteRegDelegCert);
 * `includeStakeRegistration` → prepend registration, deposit folded server-side.
 * `compensationBasisPoints` adds the CIP-149 donation metadata.
 * `certificateEncoding: 'separate'` emits Trezor-signable individual certs — leave
 * unset (combined) for software/Ledger; Trezor stays on the client builder for now.
 */
export interface BuildVoteDelegationTxRequest {
  stakeAddress: string;
  drepId: string;
  changeAddress: string;
  poolId?: string;
  utxos?: NexusTxInput[];
  senderAddress?: string;
  network?: 'MAINNET' | 'PREPROD';
  includeStakeRegistration?: boolean;
  compensationBasisPoints?: number;
  certificateEncoding?: 'combined' | 'separate';
  ttl?: number;
}

// ── Axios client ──

const nexusTxClient = axios.create({
  baseURL: import.meta.env['VITE_NEXUS_URL'],
  timeout: 60_000,
  headers: { 'Content-Type': 'application/json' },
});

// Surface the Nexus error body's message so callers can parse it
// (e.g. "Insufficient ADA to cover minimum UTXO for change output...").
// The backend proxy forwards the upstream status + JSON body verbatim.
nexusTxClient.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const body = error.response?.data as { message?: string } | undefined;
    if (body?.message) {
      // Pass the raw message through so callers that parse it (SendDialog's
      // inline ADA-shortage display) still work; friendly mapping happens at the
      // display layer (useTransactionSigning / DAppOverlay) via friendlyTxError.
      const enriched = new Error(body.message);
      (enriched as Error & { response?: unknown }).response = error.response;
      throw enriched;
    }
    throw error;
  }
);

// ── Helpers ──

/**
 * Map the wallet's typed Network value (e.g. 'Mainnet', 'Preprod') to nexus's
 * `network` query-param format. Nexus expects the chain-prefixed slug
 * (`cardano-mainnet` / `cardano-preprod`) — the same format its other endpoints
 * (/api/addresses/{addr}/utxos, /api/aggregator/*) use. It rejects the bare
 * `MAINNET`/`PREPROD` with "Invalid value '…' for parameter 'network'".
 * Returns undefined if unsupported, letting the server fall back to its default.
 */
export function toNexusNetwork(
  network: string | undefined,
): 'cardano-mainnet' | 'cardano-preprod' | 'cardano-preview' | undefined {
  if (network === Network.MAINNET) return 'cardano-mainnet';
  if (network === Network.PREPROD) return 'cardano-preprod';
  if (network === Network.PREVIEW) return 'cardano-preview';
  return undefined;
}

/**
 * Convert a single Cardano.Utxo (handles both Map and plain-object asset shapes,
 * since chrome.storage round-trips can flatten Map → Object) into the nexus
 * TxInputRequest shape.
 */
export function cardanoUtxoToNexusInput(utxo: Cardano.Utxo): NexusTxInput {
  const txIn = utxo[0];
  const txOut = utxo[1];

  const assets: NexusTxAsset[] = [];
  const rawAssets = txOut.value.assets as unknown;
  if (rawAssets) {
    const pushAsset = (unit: string, quantity: unknown) => {
      const { policyId, assetName } = splitAssetUnit(unit);
      assets.push({ policyId, assetName, quantity: String(quantity) });
    };

    if (rawAssets instanceof Map) {
      rawAssets.forEach((quantity, unit) => pushAsset(String(unit), quantity));
    } else if (Array.isArray(rawAssets)) {
      // Already serialized form from sync: [{ unit, quantity }]
      for (const a of rawAssets as { unit: string; quantity: unknown }[]) {
        pushAsset(String(a.unit), a.quantity);
      }
    } else if (typeof rawAssets === 'object') {
      // Object form from chrome.storage round-trip: { [unit]: quantity }
      for (const [unit, quantity] of Object.entries(rawAssets as Record<string, unknown>)) {
        pushAsset(unit, quantity);
      }
    }
  }

  return {
    txHash: String(txIn.txId),
    outputIndex: txIn.index,
    address: String(txOut.address),
    lovelace: String(txOut.value.coins),
    assets: assets.length > 0 ? assets : undefined,
    dataHash: txOut.datumHash ? String(txOut.datumHash) : undefined,
    inlineDatum: txOut.datum ? String(txOut.datum) : undefined,
  };
}

/**
 * Convert a Cardano.TxOut into the nexus TxOutputRequest shape, splitting each
 * asset `unit` (policyId+assetName concat) into nexus's separate fields. Handles
 * Map / array / plain-object asset shapes (chrome.storage round-trips flatten
 * Map → Object). Shared by the send-like flows migrating off the client builder.
 */
export function txOutToNexusOutput(out: Cardano.TxOut): NexusTxOutput {
  const assets: NexusTxAsset[] = [];
  const rawAssets = out.value.assets as unknown;
  if (rawAssets) {
    const pushAsset = (unit: string, quantity: unknown) => {
      const { policyId, assetName } = splitAssetUnit(unit);
      assets.push({ policyId, assetName, quantity: String(quantity) });
    };

    if (rawAssets instanceof Map) {
      rawAssets.forEach((quantity, unit) => pushAsset(String(unit), quantity));
    } else if (Array.isArray(rawAssets)) {
      for (const a of rawAssets as { unit: string; quantity: unknown }[]) {
        pushAsset(String(a.unit), a.quantity);
      }
    } else if (typeof rawAssets === 'object') {
      for (const [unit, quantity] of Object.entries(rawAssets as Record<string, unknown>)) {
        pushAsset(unit, quantity);
      }
    }
  }

  return {
    address: String(out.address),
    lovelace: String(out.value.coins),
    assets: assets.length > 0 ? assets : undefined,
  };
}

/**
 * Map wallet UTxOs to nexus inputs, excluding the reserved dApp-collateral UTxO so a
 * server-built tx doesn't spend it — mirrors buildCardanoTransaction's `excludeCollateral`
 * default (src/shared/utils/builder.ts). Nexus has no notion of a reserved collateral
 * UTxO, so the filtering must happen here. Falls back to the unfiltered set when
 * filtering would leave no inputs (e.g. the collateral UTxO is the only one).
 *
 * Pass `excludeCollateral: false` for a flow that must be free to spend the collateral
 * UTxO (mirrors the builder's `excludeCollateral` param, e.g. CollateralTab's Set-Collateral).
 */
export function walletUtxosToNexusInputs(
  utxos: Cardano.Utxo[],
  collateral?: Cardano.Utxo | null,
  excludeCollateral = true
): NexusTxInput[] {
  let list = utxos;
  if (excludeCollateral && collateral) {
    const filtered = filterOutCollateralFromUTxOs(utxos, collateral);
    if (filtered.length > 0) list = filtered;
  }
  return list.map(cardanoUtxoToNexusInput);
}

// ── Public API ──

export interface MaxAdaRequest {
  /** All outputs — the one with lovelace="0" is the one Nexus will maximize */
  outputs: NexusTxOutput[];
  changeAddress: string;
  utxos?: NexusTxInput[];
  senderAddress?: string;
  network?: 'MAINNET' | 'PREPROD';
  /** Same reward-withdrawals semantics as buildTransferTx — bumps the max. */
  withdrawals?: NexusTxWithdrawal[];
}

export interface MaxAdaResponse {
  max_lovelace: string;
  estimated_fee: string;
  change_min_utxo: string;
  total_balance: string;
}

export const nexusTxApi = {
  /**
   * Build an unsigned transfer transaction (ADA + optional native tokens) via nexus.
   * Returns the tx CBOR ready for client-side signing and submission.
   */
  async buildTransferTx(
    request: BuildTxRequest,
    network?: string
  ): Promise<BuildTxResponse> {
    const nexusNetwork = toNexusNetwork(network);
    const url = nexusNetwork ? `/api/tx/build?network=${nexusNetwork}` : '/api/tx/build';
    // The body's `network` must be Nexus's enum keyName ('cardano-mainnet'), NOT the
    // wallet's 'MAINNET'/'PREPROD' — the Network @JsonCreator rejects the latter and
    // Spring returns "Malformed request body". Override with the resolved slug.
    const { data } = await nexusTxClient.post<BuildTxResponse>(url, { ...request, network: nexusNetwork });
    return data;
  },

  /**
   * Calculate the maximum sendable ADA given a set of UTxOs.
   * Nexus selects ALL UTxOs, computes fee + change min UTxO for native tokens,
   * and returns the precise maximum.
   */
  async calculateMaxAda(
    request: MaxAdaRequest,
    network?: string
  ): Promise<MaxAdaResponse> {
    const nexusNetwork = toNexusNetwork(network);
    const url = nexusNetwork ? `/api/tx/max-ada?network=${nexusNetwork}` : '/api/tx/max-ada';
    // Body `network` must be the slug ('cardano-mainnet'), not 'MAINNET' — see buildTransferTx.
    const { data } = await nexusTxClient.post<MaxAdaResponse>(url, { ...request, network: nexusNetwork });
    return data;
  },

  /**
   * Build an unsigned plain reward-withdrawal transaction via nexus
   * (`/api/tx/build/withdrawal`). Returns CBOR ready for client-side signing.
   * For withdrawals that also carry a CIP-149 donation output, use the client
   * builder instead — this endpoint does not accept extra outputs.
   */
  async buildWithdrawalTx(
    request: BuildWithdrawalTxRequest,
    network?: string
  ): Promise<BuildTxResponse> {
    const nexusNetwork = toNexusNetwork(network);
    const url = nexusNetwork ? `/api/tx/build/withdrawal?network=${nexusNetwork}` : '/api/tx/build/withdrawal';
    const { data } = await nexusTxClient.post<BuildTxResponse>(url, request);
    return data;
  },

  /**
   * Build an unsigned stake-key registration/deregistration transaction via nexus
   * (`/api/tx/build/stake-registration`). Returns CBOR ready for client-side signing.
   * Does not support reward withdrawals — a deregistration that also claims rewards
   * must use the client builder for now.
   */
  async buildStakeRegistrationTx(
    request: BuildStakeRegistrationTxRequest,
    network?: string
  ): Promise<BuildTxResponse> {
    const nexusNetwork = toNexusNetwork(network);
    const url = nexusNetwork
      ? `/api/tx/build/stake-registration?network=${nexusNetwork}`
      : '/api/tx/build/stake-registration';
    const { data } = await nexusTxClient.post<BuildTxResponse>(url, request);
    return data;
  },

  /**
   * Build an unsigned stake-pool delegation transaction via nexus
   * (`/api/tx/build/delegation`). Pool-only (StakeDelegation) — use
   * buildVoteDelegationTx when a vote (DRep) certificate must accompany it
   * (e.g. first-time delegation that also abstains). Returns CBOR for signing.
   */
  async buildDelegationTx(
    request: BuildDelegationTxRequest,
    network?: string
  ): Promise<BuildTxResponse> {
    const nexusNetwork = toNexusNetwork(network);
    const url = nexusNetwork
      ? `/api/tx/build/delegation?network=${nexusNetwork}`
      : '/api/tx/build/delegation';
    const { data } = await nexusTxClient.post<BuildTxResponse>(url, request);
    return data;
  },

  /**
   * Build an unsigned vote-delegation transaction via nexus
   * (`/api/tx/build/vote-delegation`). Server drives the exact Conway cert
   * (VoteDelegCert / StakeVoteDelegCert / StakeVoteRegDelegCert / VoteRegDelegCert)
   * from `poolId` + `includeStakeRegistration`; the deposit is folded server-side.
   * Emits COMBINED certs by default — Trezor cannot sign those, so keep Trezor on
   * the client builder. Returns CBOR for client signing.
   */
  async buildVoteDelegationTx(
    request: BuildVoteDelegationTxRequest,
    network?: string
  ): Promise<BuildTxResponse> {
    const nexusNetwork = toNexusNetwork(network);
    const url = nexusNetwork
      ? `/api/tx/build/vote-delegation?network=${nexusNetwork}`
      : '/api/tx/build/vote-delegation';
    const { data } = await nexusTxClient.post<BuildTxResponse>(url, request);
    return data;
  },
};
