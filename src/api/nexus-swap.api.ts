// src/api/nexus-swap.api.ts
import axios, { type AxiosInstance } from 'axios';

const NEXUS_BASE: string = import.meta.env['VITE_NEXUS_URL'] || '';

export const swapAxiosInstance: AxiosInstance = axios.create({
  baseURL: NEXUS_BASE,
  timeout: 30_000,
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
});

export interface SwapRoute {
  dex: string;
  bestPoolId?: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  expectedOutput: string;
  minimumOutput: string;
  priceImpact?: number;
  batcherFeeLovelace?: string;
  aggregatorFeeLovelace?: string;
  estimatedTxFeeLovelace?: string;
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
