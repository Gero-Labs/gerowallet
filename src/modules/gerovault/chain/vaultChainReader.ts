/**
 * `VaultChainReader` (contracts.ts) over the clients the wallet already has for Cardano. No new
 * provider:
 *
 * - UTxOs and history: Nexus's address reads, with the device token, as `MidnightApi` already
 *   reads Cardano addresses (`getCardanoAssetUtxos`). Rows are converted by `convertNexusUtxos`.
 * - Creating transactions: `backendSource`, the source the decoders take.
 * - Submit: the background's `SUBMIT_TX`, so the submit router (and a wallet's own Submit API
 *   setting) decides where the transaction goes.
 *
 * Everything a provider says is a display, never proof: an input is trusted only once the decoder
 * proved it from its creating transaction. What this file does refuse is an answer it cannot read
 * whole: a malformed page, an output at another address, more UTxOs than it pages through.
 */
import axios, { type AxiosAdapter, type AxiosError, type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { TX_SUBMIT_UNCONFIRMED_MESSAGE } from '@/chrome/config';
import { Messaging } from '@/chrome/messaging';
import { toNexusNetwork } from '@/api/nexus-tx-api';
import { MessageTypes } from '@/models/MessageTypes';
import { Network } from '@/models/types';
import { getNexusAccessToken, reauthenticateNexus } from '@/services/nexusDevice.service';
import { convertNexusUtxos } from '@/services/nexusUtxo';
import { backendSource, type TxCborSource } from '@/shared/utils/provenInputs';
import type { VaultNetwork } from '@/shared/gerovault';
import type { VaultChainReader, VaultHistoryEntry, VaultHistoryOptions, VaultReadOptions } from '../contracts';

/** The direct Nexus origin, as `midnightConfig.ts` and `nexusDevice.service.ts` read it. */
const NEXUS_API_BASE: string = import.meta.env['VITE_NEXUS_API_URL'] || 'https://nexus.gerowallet.io';

/** Nexus's largest page. */
export const UTXO_PAGE_SIZE = 100;
/** A vault with more UTxOs than this is refused rather than shown in part. */
export const MAX_UTXO_PAGES = 20;
const MAX_HISTORY_PAGE = 1000;
const READ_TIMEOUT_MS = 30_000;

const WALLET_NETWORK: Readonly<Record<VaultNetwork, string>> = {
  mainnet: Network.MAINNET,
  preprod: Network.PREPROD,
  preview: Network.PREVIEW,
};

const TX_HASH = /^[0-9a-f]{64}$/;
const HEX_CBOR = /^(?:[0-9a-fA-F]{2})+$/;

/** What the reader needs from an HTTP client: `axios.get`. */
export type VaultReadHttp = Pick<AxiosInstance, 'get'>;
/** What the reader needs from the page's messaging: `Messaging.sendToBackgroundFromOptions`. */
export type SendToBackground = (request: { method: string; data: unknown }) => Promise<unknown>;

export interface VaultChainReaderOptions {
  /** The Nexus client; defaults to `createNexusReadClient()`. */
  readonly http?: VaultReadHttp;
  /** The creating-transaction source; defaults to `backendSource` on this network. */
  readonly txCbor?: TxCborSource;
  /** The page-to-background messenger; defaults to `Messaging.sendToBackgroundFromOptions`. */
  readonly sendToBackground?: SendToBackground;
}

/**
 * An axios client for Nexus's Cardano reads: the device token on every request, and on a 401 or a
 * 403 one fresh login and one retry (a cached token can predate a scope), as `MidnightApi` does.
 */
export function createNexusReadClient(options: { adapter?: AxiosAdapter } = {}): AxiosInstance {
  const client = axios.create({
    baseURL: NEXUS_API_BASE,
    timeout: READ_TIMEOUT_MS,
    headers: { Accept: 'application/json' },
    ...(options.adapter ? { adapter: options.adapter } : {}),
  });
  client.interceptors.request.use(async config => {
    config.headers.Authorization = `Bearer ${await getNexusAccessToken()}`;
    return config;
  });
  client.interceptors.response.use(undefined, async (error: AxiosError) => {
    const config = error.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined;
    const status = error.response?.status;
    if ((status === 401 || status === 403) && config && !config._retried) {
      config._retried = true;
      // The request interceptor sets the header again, from the fresh token.
      try {
        await reauthenticateNexus();
      } catch {
        throw error;
      }
      return client.request(config);
    }
    throw error;
  });
  return client;
}

const isNotFound = (error: unknown): boolean => axios.isAxiosError(error) && error.response?.status === 404;

function assertAddress(address: unknown, network: VaultNetwork): asserts address is string {
  let parsed: Cardano.Address | null = null;
  try {
    parsed = typeof address === 'string' ? Cardano.Address.fromBech32(address) : null;
  } catch {
    parsed = null;
  }
  const expected = network === 'mainnet' ? Cardano.NetworkId.Mainnet : Cardano.NetworkId.Testnet;
  if (!parsed || parsed.getNetworkId() !== expected || parsed.toBech32() !== address) {
    throw new TypeError(`Not a ${network} address in bech32`);
  }
}

function historyEntry(row: unknown): VaultHistoryEntry | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const { txHash, blockHeight, blockTime } = row as Record<string, unknown>;
  if (typeof txHash !== 'string' || !TX_HASH.test(txHash.toLowerCase())) return undefined;
  const count = (value: unknown): number | null => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null);
  return { txHash: txHash.toLowerCase(), blockHeight: count(blockHeight), blockTime: count(blockTime) };
}

function localTxId(txCbor: string): string {
  try {
    return Serialization.Transaction.fromCbor(Serialization.TxCBOR(txCbor)).getId().toLowerCase();
  } catch {
    throw new TypeError('Not a transaction in hex CBOR');
  }
}

/** The chain reader of one vault network. */
export function createVaultChainReader(network: VaultNetwork, options: VaultChainReaderOptions = {}): VaultChainReader {
  const walletNetwork = WALLET_NETWORK[network];
  const nexusNetwork = toNexusNetwork(walletNetwork);
  if (!walletNetwork || !nexusNetwork) throw new TypeError('A vault network is mainnet, preprod or preview');
  let http = options.http;
  const client = (): VaultReadHttp => (http ??= createNexusReadClient());
  const sendToBackground: SendToBackground = options.sendToBackground ?? (request => Messaging.sendToBackgroundFromOptions(request));

  async function utxos(address: string, read: VaultReadOptions = {}): Promise<Cardano.Utxo[]> {
    assertAddress(address, network);
    const found = new Map<string, Cardano.Utxo>();
    for (let page = 1; page <= MAX_UTXO_PAGES; page++) {
      let rows: unknown;
      try {
        ({ data: rows } = await client().get(`/api/addresses/${encodeURIComponent(address)}/utxos`, {
          params: { network: nexusNetwork, page, pageSize: UTXO_PAGE_SIZE },
          signal: read.signal,
        }));
      } catch (error) {
        // Nexus answers 404 for an address that holds nothing.
        if (isNotFound(error)) return [...found.values()];
        throw error;
      }
      if (!Array.isArray(rows)) throw new Error('Nexus answered the UTxO read with something other than a list');
      for (const utxo of convertNexusUtxos(rows)) {
        if (String(utxo[1].address) !== address) throw new Error('Nexus answered with an output at another address');
        found.set(`${utxo[0].txId}#${utxo[0].index}`, utxo);
      }
      if (rows.length < UTXO_PAGE_SIZE) return [...found.values()];
    }
    throw new Error(`The address holds more than ${MAX_UTXO_PAGES * UTXO_PAGE_SIZE} UTxOs`);
  }

  async function history(address: string, read: VaultHistoryOptions = {}): Promise<readonly VaultHistoryEntry[]> {
    assertAddress(address, network);
    const page = read.page ?? 1;
    const pageSize = read.pageSize ?? UTXO_PAGE_SIZE;
    if (!Number.isSafeInteger(page) || page < 1 || page > MAX_HISTORY_PAGE) throw new RangeError('A history page is 1 to 1000');
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > UTXO_PAGE_SIZE) throw new RangeError('A history page holds 1 to 100 transactions');
    let rows: unknown;
    try {
      ({ data: rows } = await client().get(`/api/addresses/transactions/${encodeURIComponent(address)}`, {
        params: { network: nexusNetwork, page, pageSize, order: 'desc' },
        signal: read.signal,
      }));
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    if (!Array.isArray(rows)) throw new Error('Nexus answered the history read with something other than a list');
    // One row per input or output the address has in a transaction: keep each transaction once.
    const seen = new Set<string>();
    const entries: VaultHistoryEntry[] = [];
    for (const row of rows) {
      const entry = historyEntry(row);
      if (!entry) throw new Error('Nexus answered the history read with a row it cannot read');
      if (seen.has(entry.txHash)) continue;
      seen.add(entry.txHash);
      entries.push(entry);
    }
    return entries;
  }

  async function submit(txCbor: string): Promise<string> {
    if (typeof txCbor !== 'string' || !HEX_CBOR.test(txCbor)) throw new TypeError('Not a transaction in hex CBOR');
    const expected = localTxId(txCbor);
    const reply = await sendToBackground({ method: MessageTypes.SUBMIT_TX, data: { txCbor } }).catch(() => undefined) as
      { data?: { txId?: unknown; error?: unknown } } | null | undefined;
    if (typeof reply?.data?.error === 'string') throw new Error(reply.data.error);
    const txId = reply?.data?.txId;
    // A lost reply can follow a broadcast that worked: only the worker could have acknowledged it.
    if (typeof txId !== 'string' || !txId.trim()) throw new Error(TX_SUBMIT_UNCONFIRMED_MESSAGE);
    if (txId.toLowerCase() !== expected) throw new Error('The submit answer names another transaction');
    return expected;
  }

  return Object.freeze({
    network,
    utxos,
    history,
    txCbor: options.txCbor ?? backendSource(walletNetwork),
    submit,
  });
}
