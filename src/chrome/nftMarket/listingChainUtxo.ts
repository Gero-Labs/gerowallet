// The listing UTxO as the chain has it, read from Koios, a source independent of Nexus.
//
// Why: the transaction a buy spends names the listing input, not what it holds. Everything the
// wallet knows about the listing's datum, deposit and NFT comes from the Nexus row, and a datum
// Nexus invents can be a SUPERSET of the real one (same seller, a higher price, one extra royalty
// to an attacker): the contract ignores trailing outputs and accepts overpayment, so a buy built
// from it succeeds on chain and Nexus keeps the difference. `verifyBuy` therefore refuses unless
// this independently read UTxO says the same thing. Koios is a second party the user already
// trusts for pool data (`spo-api.ts`, same hosts, already in the extension CSP); an attacker
// would have to control both Nexus and Koios.
//
// Fails closed and strictly: an HTTP error, an unreadable body, a different UTxO than asked for,
// a spent UTxO and any field of the wrong type are typed errors, never a partial answer.
//
// Request (Koios v1): POST /utxo_info {"_utxo_refs":["<txHash>#<index>"],"_extended":true}.
// Row used: tx_hash, tx_index, address, value (lovelace, string), asset_list[] {policy_id,
// asset_name (hex), quantity (string)}, inline_datum {bytes} | null, is_spent.

import { Cardano } from '@cardano-sdk/core';
import { KOIOS_URLS } from '@/api/spo-api';
import type { ListingRef } from '@/api/nft-market-api';
import { NFT_MARKET_ALLOWED_NETWORKS } from '@/utils/nftMarketDeployments';

/** What the chain holds at the listing's out-ref. */
export interface ListingChainUtxo {
  /** Bech32 address of the UTxO. */
  address: string;
  lovelace: bigint;
  /** Every non-ADA asset it holds, policy id + asset name hex as `unit`. */
  assets: { unit: string; quantity: bigint }[];
  /** The inline datum's CBOR (lower-case hex), or null when it has none (a datum hash or no datum). */
  inlineDatumCbor: string | null;
}

export type ListingUtxoErrorCode =
  /** The network is not one the market runs on, or has no Koios host. */
  | 'UNSUPPORTED_NETWORK'
  /** Koios could not be reached, timed out, or answered with an HTTP error. */
  | 'UNREACHABLE'
  /** Koios does not know the UTxO. */
  | 'NOT_FOUND'
  /** The UTxO exists and is already spent. */
  | 'SPENT'
  /** Koios answered, but not with the row that was asked for in the shape this reads. */
  | 'MALFORMED';

export class ListingUtxoError extends Error {
  constructor(readonly code: ListingUtxoErrorCode, detail: string) {
    super(`Listing UTxO not confirmed on chain (${code}): ${detail}`);
    this.name = 'ListingUtxoError';
  }
}

/** Longest the wallet waits for Koios. */
const KOIOS_TIMEOUT_MS = 15_000;

const TX_HASH = /^[0-9a-f]{64}$/;
const POLICY_ID = /^[0-9a-f]{56}$/;
const HEX = /^(?:[0-9a-fA-F]{2})+$/;
const HEX_OR_EMPTY = /^(?:[0-9a-fA-F]{2})*$/;
const DECIMAL = /^[0-9]+$/;
/** Longest asset name, in hex characters (32 bytes). */
const MAX_ASSET_NAME_HEX = 64;

function malformed(field: string): never {
  throw new ListingUtxoError('MALFORMED', `the Koios answer has a bad ${field}`);
}

/**
 * Read the UTxO `ref` from Koios on `network`. Throws ListingUtxoError, never returns a guess.
 * Only the networks the market runs on are asked about, each on its own Koios host.
 */
export async function fetchListingUtxoFromKoios(ref: ListingRef, network: string): Promise<ListingChainUtxo> {
  const base = NFT_MARKET_ALLOWED_NETWORKS.includes(network) ? KOIOS_URLS[network] : undefined;
  if (!base) throw new ListingUtxoError('UNSUPPORTED_NETWORK', `the market is not served on ${String(network)}`);
  const txHash = typeof ref?.txHash === 'string' ? ref.txHash.toLowerCase() : '';
  if (!TX_HASH.test(txHash) || !Number.isSafeInteger(ref.outputIndex) || ref.outputIndex < 0) {
    throw new ListingUtxoError('MALFORMED', 'the listing reference is not a transaction hash and an output index');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), KOIOS_TIMEOUT_MS);
  let body: unknown;
  try {
    let response: Response;
    try {
      response = await fetch(`${base}/utxo_info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ _utxo_refs: [`${txHash}#${ref.outputIndex}`], _extended: true }),
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch {
      throw new ListingUtxoError('UNREACHABLE', 'Koios could not be reached');
    }
    if (!response.ok) throw new ListingUtxoError('UNREACHABLE', `Koios answered HTTP ${response.status}`);
    try {
      body = await response.json();
    } catch {
      throw new ListingUtxoError('MALFORMED', 'the Koios answer is not JSON');
    }
  } finally {
    clearTimeout(timer);
  }

  return parseRow(body, txHash, ref.outputIndex);
}

function parseRow(body: unknown, txHash: string, outputIndex: number): ListingChainUtxo {
  if (!Array.isArray(body)) return malformed('body');
  // Koios answers an unknown reference with an empty list.
  if (body.length === 0) throw new ListingUtxoError('NOT_FOUND', 'Koios does not know this UTxO');
  if (body.length !== 1) return malformed('row count');
  const row: unknown = body[0];
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return malformed('row');
  const r = row as Record<string, unknown>;

  // The row must be the UTxO asked about, not a neighbour.
  if (typeof r['tx_hash'] !== 'string' || r['tx_hash'].toLowerCase() !== txHash) return malformed('tx_hash');
  if (r['tx_index'] !== outputIndex) return malformed('tx_index');
  if (typeof r['is_spent'] !== 'boolean') return malformed('is_spent');
  if (r['is_spent']) throw new ListingUtxoError('SPENT', 'the listing UTxO is already spent');

  const address = r['address'];
  if (typeof address !== 'string') return malformed('address');
  try {
    Cardano.Address.fromBech32(address);
  } catch {
    return malformed('address');
  }

  const value = r['value'];
  if (typeof value !== 'string' || !DECIMAL.test(value)) return malformed('value');

  const list = r['asset_list'];
  if (!Array.isArray(list)) return malformed('asset_list');
  const seen = new Set<string>();
  const assets = list.map((raw, i) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return malformed(`asset_list[${i}]`);
    const a = raw as Record<string, unknown>;
    const policy = typeof a['policy_id'] === 'string' ? a['policy_id'].toLowerCase() : '';
    if (!POLICY_ID.test(policy)) return malformed(`asset_list[${i}].policy_id`);
    // Koios writes an empty asset name as null or "".
    const rawName = a['asset_name'] ?? '';
    if (typeof rawName !== 'string' || !HEX_OR_EMPTY.test(rawName) || rawName.length > MAX_ASSET_NAME_HEX) {
      return malformed(`asset_list[${i}].asset_name`);
    }
    const quantity = a['quantity'];
    if (typeof quantity !== 'string' || !DECIMAL.test(quantity) || BigInt(quantity) <= 0n) {
      return malformed(`asset_list[${i}].quantity`);
    }
    const unit = `${policy}${rawName.toLowerCase()}`;
    if (seen.has(unit)) return malformed(`asset_list[${i}]`);
    seen.add(unit);
    return { unit, quantity: BigInt(quantity) };
  });

  // `inline_datum` is null when there is none; absent means the extended answer was not given.
  const datum = r['inline_datum'];
  let inlineDatumCbor: string | null;
  if (datum === null) {
    inlineDatumCbor = null;
  } else if (typeof datum === 'object' && !Array.isArray(datum) && typeof (datum as Record<string, unknown>)['bytes'] === 'string') {
    const bytes = (datum as Record<string, string>)['bytes'];
    if (!HEX.test(bytes)) return malformed('inline_datum.bytes');
    inlineDatumCbor = bytes.toLowerCase();
  } else {
    return malformed('inline_datum');
  }

  return { address, lovelace: BigInt(value), assets, inlineDatumCbor };
}
