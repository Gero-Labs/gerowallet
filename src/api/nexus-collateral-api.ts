/**
 * Nexus shared-pool collateral API client.
 *
 * <p>Companion of {@link ./nexus-tx-api.ts}. The wallet calls these endpoints to:
 *   - {@link nexusCollateralApi.lend}    — get any 5 ADA pool UTxO reference
 *   - {@link nexusCollateralApi.status}  — confirm a previously-lent ref is still on-chain
 *   - {@link nexusCollateralApi.cosign}  — request a witness when a dApp tx uses the lent UTxO as collateral
 *
 * <p>Backend pool state is read directly from chain — there is no DB lease and many
 * devices can hold the same {@code utxoRef} simultaneously. Collateral inputs are
 * referenced (not consumed) in the success path, so concurrent reuse is safe.
 *
 * Auth: device JWT from {@link ../services/nexusDevice.service}, same as nexus-tx-api.
 */

import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { getNexusAccessToken, reauthenticateNexus } from '@/services/nexusDevice.service';
import { debugLog } from '@/utils/debug';

/**
 * Raw chain fields returned by the backend. The client builds the CIP-30
 * {@code TransactionUnspentOutput} CBOR locally so we can keep the API
 * version-decoupled from the wallet's serialization library.
 */
export interface LendResponse {
  /** Tx hash (64 hex chars) of the producing transaction. */
  txHash: string;
  /** Output index within that transaction. */
  outputIndex: number;
  /** Bech32 enterprise address holding the UTxO. */
  address: string;
  /** Lovelace amount as a decimal string (always exactly 5_000_000 in v1). */
  lovelace: string;
}

export interface StatusResponse {
  /** true while the UTxO still appears in the pool on-chain. */
  valid: boolean;
  /** Free-form reason when {@code valid} is false (e.g. "not in pool"). */
  reason?: string;
}

export interface CosignResponse {
  /** TransactionWitnessSet CBOR hex containing only the hot wallet's VKeyWitness. */
  witness: string;
}

const client = axios.create({
  baseURL: import.meta.env['VITE_NEXUS_URL'],
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

client.interceptors.request.use(async (config) => {
  const token = await getNexusAccessToken();
  config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// 401 → drop cached token, reauth, retry once. Same pattern as nexus-tx-api.ts.
client.interceptors.response.use(
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
        return client.request(config);
      } catch (refreshErr) {
        debugLog('[nexus-collateral-api] Reauth failed after 401:', refreshErr);
        throw error;
      }
    }
    throw error;
  }
);

/** Compose `txHash#outputIndex` from a {@link LendResponse}. */
export function lendRef(lent: LendResponse): string {
  return `${lent.txHash}#${lent.outputIndex}`;
}

export const nexusCollateralApi = {
  /**
   * Lend any pool UTxO. Returns 503 with `Collateral pool empty` when no eligible
   * UTxO exists on-chain. The same UTxO may be returned to multiple callers — that's
   * intentional, see the module-level note on collateral semantics.
   */
  async lend(): Promise<LendResponse> {
    const { data } = await client.post<LendResponse>('/v1/collateral/lend');
    return data;
  },

  /**
   * Check that {@code utxoRef} is still in the pool on-chain. Cheap to call
   * (Nexus caches the address UTxO query) — safe to use as a periodic health
   * check on the cached collateral entry.
   */
  async status(utxoRef: string): Promise<StatusResponse> {
    const { data } = await client.get<StatusResponse>('/v1/collateral/status', {
      params: { utxoRef },
    });
    return data;
  },

  /**
   * Request a witness for a tx that uses the lent UTxO as a collateral input.
   * Backend rejects with 400 if the ref is in regular inputs (adversarial-tx
   * guard) or 404 if the ref is no longer on-chain.
   */
  async cosign(txCbor: string, utxoRef: string): Promise<CosignResponse> {
    const { data } = await client.post<CosignResponse>('/v1/collateral/cosign', {
      txCbor,
      utxoRef,
    });
    return data;
  },
};
