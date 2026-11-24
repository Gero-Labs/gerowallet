// src/api/nexus-swap.api.ts
import axios, { type AxiosInstance } from 'axios';
import { installSignedResponses } from './signedResponses';

const NEXUS_BASE: string = import.meta.env['VITE_NEXUS_URL'] || '';

export const swapAxiosInstance: AxiosInstance = axios.create({
  baseURL: NEXUS_BASE,
  timeout: 30_000,
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
});
// gero-backend relays Nexus and signs what it relays (build-time mode; off by default).
installSignedResponses(swapAxiosInstance, 'gero-backend');

/** One pool of a two-hop route (nexus two-hop client contract, 2026-11-23). */
export interface SwapRouteLeg {
  poolId: string;
  dex: string;
  type: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  expectedOut: string;
  priceImpact?: number;
  lpFeePercent?: number;
  poolTvlAda?: number | string;
}

/**
 * A route as /api/aggregator/quote returns it. /build-tx needs it back unchanged: a two-hop
 * route is refused when `legs`, `intermediateToken` or `executionModel` are dropped, so pass
 * the object through rather than rebuilding it from these fields. Quotes without `maxHops`
 * (every quote this app sends itself) never return a two-hop route.
 */
export interface SwapRoute {
  dex: string;
  /** Null on a two-hop route, which has no single pool. */
  bestPoolId?: string | null;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  expectedOutput: string;
  minimumOutput: string;
  priceImpact?: number;
  batcherFeeLovelace?: string;
  aggregatorFeeLovelace?: string;
  estimatedTxFeeLovelace?: string;
  /** 'BATCHER_MULTI_HOP' on a two-hop route. */
  executionModel?: string;
  /** The middle asset of a two-hop route ('lovelace' today). */
  intermediateToken?: string;
  /** The two pools of a two-hop route; absent or empty otherwise. */
  legs?: SwapRouteLeg[];
  verified?: boolean;
  queuedOrdersAhead?: number | null;
}

export interface QuoteRequest {
  tokenIn: string; // "lovelace" for ADA, else policyId+assetName (unit)
  tokenOut: string;
  amountIn: string; // smallest unit, decimal string
  slippageTolerance?: string;
  senderAddress?: string;
  excludeDexes?: string[];
}

export interface QuoteResponse {
  routes: SwapRoute[];
  bestRouteIndex: number;
}

export interface NexusUtxoInput {
  txHash: string;
  index: number;
  cborHex: string;
}

export interface BuildRequest {
  route: SwapRoute;
  senderAddress: string;
  changeAddress: string;
  utxos: NexusUtxoInput[];
}

export interface BuildResponse {
  unsignedTxCbor: string; // OPAQUE - never re-serialize
  txBodyHash?: string;
  feeLovelace?: string;
  aggregatorFeeLovelace?: string;
  partnerFeeLovelace?: string;
}

export interface SubmitRequest {
  unsignedTxCbor: string;
  userWitnessHex: string;
}

export interface SubmitResponse {
  txHash: string;
  status: string;
  trackingUrl?: string;
}

export interface StatusResponse {
  txHash: string;
  status: string;
  slot?: number;
  errorMessage?: string;
}

export const nexusSwapApi = {
  async quote(req: QuoteRequest): Promise<QuoteResponse> {
    const { data } = await swapAxiosInstance.post('/api/aggregator/quote', req);
    return data as QuoteResponse;
  },
  async buildTx(req: BuildRequest): Promise<BuildResponse> {
    const { data } = await swapAxiosInstance.post('/api/aggregator/build-tx', req);
    return data as BuildResponse;
  },
  async submit(req: SubmitRequest): Promise<SubmitResponse> {
    const { data } = await swapAxiosInstance.post('/api/aggregator/submit', req);
    return data as SubmitResponse;
  },
  async status(txHash: string): Promise<StatusResponse> {
    const { data } = await swapAxiosInstance.get(`/api/aggregator/status/${txHash}`);
    return data as StatusResponse;
  },
};
