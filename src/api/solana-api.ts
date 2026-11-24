/**
 * Nexus `/api/sol` client (Gero-Labs/nexus#1668).
 *
 * Calls Nexus directly with the device JWT, like the Midnight client: device tokens carry
 * SOLANA_READ / SOLANA_WRITE by default. Nexus reads its indexer first and falls back to
 * Solana RPC. Realtime updates come from Gero Sync; this client is for on-demand reads,
 * fees and submit (which gero-sync does not relay).
 */
import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import { geroClientHeaders } from '@/chains/midnight/midnightClientVersion';
import { getNexusAccessToken, reauthenticateNexus } from '@/services/nexusDevice.service';
import { debugLog } from '@/utils/debug';
import { isValidSolanaAddress } from '@/chains/solana/solanaKeyManager';
import { SOLANA_NFT_BATCH, parseSolanaNftRows, type SolanaNft } from '@/chains/solana/solanaNfts';
import {
  parseSolanaAccounts,
  parseSolanaSimulation,
  type SolanaRemoteAccount,
  type SolanaRemoteSimulation,
} from '@/chains/solana/solanaNexusAccounts';

export type SolanaNetwork = 'mainnet' | 'devnet';

const NEXUS_BASE = (typeof import.meta !== 'undefined'
  && import.meta.env
  && import.meta.env['VITE_NEXUS_API_URL']) || 'https://nexus.gerowallet.io';

/** Nexus `Network` query value for a wallet network name (`Mainnet`/`Devnet`, any case). */
export function nexusSolanaNetwork(network: string): string {
  const n = network.toLowerCase().replace(/^solana[-_]/, '');
  if (n === 'mainnet') return 'solana-mainnet';
  if (n === 'devnet') return 'solana-devnet';
  throw new Error(`Solana network not supported: ${network}`);
}

export interface SolanaChainTip {
  slot: number;
  blockHeight: number;
  blockhash: string;
  lastValidBlockHeight?: number;
}

export interface SolanaBalance {
  address: string;
  /** Lamports. Nexus sends a JSON number; kept as bigint so math never loses precision. */
  lamports: bigint;
  slot: number;
}

export interface SolanaTokenAccount {
  mint: string;
  owner: string;
  tokenAccount?: string | null;
  /** Raw units, decimal string. */
  amount: string;
  decimals: number;
  programId?: string | null;
}

export interface SolanaSignatureInfo {
  signature: string;
  slot: number;
  blockTime?: number | null;
  success: boolean;
  fee?: number | null;
}

export interface SolanaFees {
  baseFeeLamportsPerSignature: number;
  slotsSampled: number;
  prioritizationFeeMicroLamports: { min: number; median: number; p75: number; p90: number; max: number };
}

export class SolanaApi {
  private readonly network: string;
  private readonly http: AxiosInstance;

  constructor(network: string, baseURL: string = NEXUS_BASE) {
    this.network = nexusSolanaNetwork(network);
    this.http = axios.create({
      baseURL,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json', ...geroClientHeaders() },
    });
    this.http.interceptors.request.use(async (config) => {
      config.headers.Authorization = `Bearer ${await getNexusAccessToken()}`;
      return config;
    });
    // Same as the Midnight client: re-authenticate once on 401 (bad token) or 403 (token
    // older than a scope Nexus added), then give up.
    this.http.interceptors.response.use(
      (res) => res,
      async (error: AxiosError) => {
        const cfg = error.config as AxiosRequestConfig & { _retried?: boolean };
        const status = error.response?.status;
        if ((status === 401 || status === 403) && cfg && !cfg._retried) {
          cfg._retried = true;
          try {
            const token = await reauthenticateNexus();
            if (cfg.headers) cfg.headers.Authorization = `Bearer ${token}`;
            return this.http.request(cfg);
          } catch (refreshErr) {
            debugLog(`[solana-api] Reauth failed after ${status}:`, refreshErr);
            throw error;
          }
        }
        throw error;
      },
    );
  }

  async getChainTip(): Promise<SolanaChainTip> {
    const { data } = await this.http.get<SolanaChainTip>('/api/sol/chain/tip', { params: this.params() });
    return data;
  }

  async getFees(): Promise<SolanaFees> {
    const { data } = await this.http.get<SolanaFees>('/api/sol/fees', { params: this.params() });
    return data;
  }

  async getBalance(address: string): Promise<SolanaBalance> {
    const { data } = await this.http.get<{ address: string; lamports: number | string; slot: number }>(
      `/api/sol/addresses/${this.address(address)}/balance`,
      // Lamports can exceed 2^53: ask axios for the raw text so JSON.parse can't round it.
      { params: this.params(), transformResponse: (raw) => raw },
    );
    return parseBalance(typeof data === 'string' ? data : JSON.stringify(data));
  }

  async getTokens(address: string): Promise<SolanaTokenAccount[]> {
    const { data } = await this.http.get<SolanaTokenAccount[]>(
      `/api/sol/addresses/${this.address(address)}/tokens`, { params: this.params() });
    return data;
  }

  /** Signatures for `address`, newest first. Page older ones with `before` = the oldest signature held. */
  async getSignatures(address: string, options: { before?: string; limit?: number } = {}): Promise<SolanaSignatureInfo[]> {
    const { data } = await this.http.get<SolanaSignatureInfo[]>(
      `/api/sol/addresses/${this.address(address)}/txs`,
      { params: { ...this.params(), before: options.before, limit: options.limit } },
    );
    return data;
  }

  /** Full transaction record (Nexus passes the RPC JSON through). */
  async getTransaction(signature: string): Promise<unknown> {
    const { data } = await this.http.get(`/api/sol/txs/${encodeURIComponent(signature)}`, { params: this.params() });
    return data;
  }

  /** Submits a signed transaction (base64). Returns its signature. */
  async submit(signedTransactionBase64: string): Promise<string> {
    const { data } = await this.http.post<{ signature: string }>(
      '/api/sol/txs/submit', { signedTransaction: signedTransactionBase64 }, { params: this.params() });
    return data.signature;
  }

  /** Accounts in one read (`getMultipleAccounts`), at most 100, in the order asked. */
  async getAccounts(addresses: string[]): Promise<SolanaRemoteAccount[]> {
    addresses.forEach((a) => this.address(a));
    const { data } = await this.http.post<string>(
      '/api/sol/accounts', { addresses },
      { params: this.params(), transformResponse: (raw) => raw },
    );
    return parseSolanaAccounts(typeof data === 'string' ? data : JSON.stringify(data), addresses);
  }

  /**
   * Simulates a transaction (base64 wire format; signatures not checked, blockhash replaced)
   * and reads `accounts` (at most 32) before and after. Broadcasts nothing.
   */
  /**
   * `POST /api/sol/nfts/metadata`: one entry per mint, in order (solanaNfts.ts reads it strictly).
   * At most SOLANA_NFT_BATCH mints per call.
   */
  async getNftMetadata(mints: string[], now = Date.now()): Promise<Array<SolanaNft | false | undefined>> {
    if (mints.length > SOLANA_NFT_BATCH) throw new Error(`At most ${SOLANA_NFT_BATCH} mints per call`);
    mints.forEach((m) => this.address(m));
    const { data } = await this.http.post<unknown>('/api/sol/nfts/metadata', { mints }, { params: this.params() });
    return parseSolanaNftRows(data, mints, now);
  }

  async simulate(transactionBase64: string, accounts: string[]): Promise<SolanaRemoteSimulation> {
    accounts.forEach((a) => this.address(a));
    const { data } = await this.http.post<string>(
      '/api/sol/txs/simulate', { transaction: transactionBase64, accounts },
      { params: this.params(), transformResponse: (raw) => raw },
    );
    return parseSolanaSimulation(typeof data === 'string' ? data : JSON.stringify(data), accounts);
  }

  private params(): { network: string } {
    return { network: this.network };
  }

  private address(address: string): string {
    if (!isValidSolanaAddress(address)) throw new Error('Invalid Solana address');
    return address;
  }
}

/** Parses Nexus's balance JSON keeping `lamports` exact (it can exceed Number.MAX_SAFE_INTEGER). */
export function parseBalance(json: string): SolanaBalance {
  const match = /"lamports"\s*:\s*"?(\d+)"?/.exec(json);
  const parsed = JSON.parse(json) as { address: string; slot: number };
  if (!match) throw new Error('Nexus balance response has no lamports');
  return { address: parsed.address, lamports: BigInt(match[1]), slot: parsed.slot };
}
