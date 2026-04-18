/**
 * Nexus transaction builder API client.
 *
 * Replaces client-side buildCardanoTransaction calls with server-side builds via
 * nexus's /v1/tx/build* endpoints. Server-side building is preferable because:
 *   - protocol params are always fresh (server fetches from chain)
 *   - fee calculation matches the canonical Cardano JVM/Aiken impl
 *   - upgrades happen on the server, no extension release required
 *
 * Auth: every request gets an Authorization: Bearer <jwt> header from
 * nexusDevice.service. On 401 the token is invalidated and the request retried
 * once with a fresh token.
 */

import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { Cardano } from '@cardano-sdk/core';
import { getNexusAccessToken, reauthenticateNexus } from '@/services/nexusDevice.service';
import { Network } from '@/models/types';
import { debugLog } from '@/utils/debug';

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
}

export interface BuildTxResponse {
  tx_cbor: string;
  tx_hash: string;
  estimated_fee?: string;
  estimated_signatures?: number;
}

// ── Axios client ──

const nexusTxClient = axios.create({
  baseURL: import.meta.env['VITE_NEXUS_URL'],
  timeout: 60_000,
  headers: { 'Content-Type': 'application/json' },
});

nexusTxClient.interceptors.request.use(async (config) => {
  const token = await getNexusAccessToken();
  config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// 401 → drop cached token, reauth, retry once
nexusTxClient.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const config = error.config as AxiosRequestConfig & { _retried?: boolean };
    if (error.response?.status === 401 && config && !config._retried) {
      config._retried = true;
      try {
        const token = await reauthenticateNexus();
        if (config.headers) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return nexusTxClient.request(config);
      } catch (refreshErr) {
        debugLog('[nexus-tx-api] Reauth failed after 401:', refreshErr);
        throw error;
      }
    }
    throw error;
  }
);

// ── Helpers ──

/**
 * Map the wallet's typed Network value (e.g. 'Mainnet', 'Preprod') to nexus's
 * uppercase enum name. Returns undefined if the network isn't supported by nexus,
 * which lets the server fall back to its default.
 */
function toNexusNetwork(network: string | undefined): 'MAINNET' | 'PREPROD' | undefined {
  if (network === Network.MAINNET) return 'MAINNET';
  if (network === Network.PREPROD) return 'PREPROD';
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

// ── Public API ──

export interface MaxAdaRequest {
  /** All outputs — the one with lovelace="0" is the one Nexus will maximize */
  outputs: NexusTxOutput[];
  changeAddress: string;
  utxos?: NexusTxInput[];
  senderAddress?: string;
  network?: 'MAINNET' | 'PREPROD';
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
    const url = nexusNetwork ? `/v1/tx/build?network=${nexusNetwork}` : '/v1/tx/build';
    const { data } = await nexusTxClient.post<BuildTxResponse>(url, request);
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
    const url = nexusNetwork ? `/v1/tx/max-ada?network=${nexusNetwork}` : '/v1/tx/max-ada';
    const { data } = await nexusTxClient.post<MaxAdaResponse>(url, request);
    return data;
  },
};
