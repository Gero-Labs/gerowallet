// The listing UTxO as the chain has it, read from the bytes of the transaction that created it.
//
// Why: the transaction a buy spends names the listing input, not what it holds. Everything the
// wallet knows about the listing's datum, deposit and NFT comes from the Nexus row, and a datum
// Nexus invents can be a SUPERSET of the real one (same seller, a higher price, one extra royalty
// to an attacker): the contract ignores trailing outputs and accepts overpayment, so a buy built
// from it succeeds on chain and Nexus keeps the difference. `verifyBuy` therefore refuses unless
// this independently read UTxO says the same thing.
//
// Why PROVEN: a first version asked a server what the UTxO holds, which made that
// server a trusted party for its content. A transaction id is the blake2b-256 hash of the
// transaction body, so the CBOR of the transaction that created `txHash#index` proves that
// output's address, value and inline datum, whoever served the CBOR. This reads it through the
// wallet's hash-proven path (`provenInputs.ts`: gero-backend's transaction CBOR, kept only if the body hashes to
// the id asked for) and takes output `index` from it. The server can still refuse to answer or lie
// about what exists (both fail the buy), but it can no longer make the wallet believe a
// different listing than the one on chain.
//
// Spent-ness is NOT proven and not asked: a spent listing is still readable from its creating
// transaction, and a buy that spends it fails phase 1 on submission at no cost to the buyer (the
// collateral is only taken when a script runs). The earlier `utxo_info` `is_spent` check was
// dropped with the call, since it could be kept only as a second request whose content we
// would not trust for anything else.
//
// Fails closed and strictly: an HTTP error, a timeout (while connecting or while reading the
// body), an unreadable answer, CBOR that does not hash to the transaction asked for, an index the
// transaction did not create and any field of the wrong shape are typed errors, never a partial
// answer.

import { Cardano, Serialization } from '@cardano-sdk/core';
import type { ListingRef } from '@/api/nft-market-api';
import { backendSource, provenTxOutput } from '@/shared/utils/provenInputs';
import { NFT_MARKET_ALLOWED_NETWORKS } from '@/utils/nftMarketDeployments';

/** What the chain holds at the listing's out-ref. */
export interface ListingChainUtxo {
  /** The out-ref this was read for, `txHash#outputIndex` with the hash in lower case. `verifyBuy` requires it to be the listing's. */
  ref: string;
  /** Bech32 address of the UTxO. */
  address: string;
  lovelace: bigint;
  /** Every non-ADA asset it holds, policy id + asset name hex as `unit`. */
  assets: { unit: string; quantity: bigint }[];
  /**
   * The inline datum's CBOR (lower-case hex) exactly as the creating transaction has it, or null
   * when it has none (a datum hash or no datum).
   */
  inlineDatumCbor: string | null;
}

export type ListingUtxoErrorCode =
  /** The network is not one the market runs on. */
  | 'UNSUPPORTED_NETWORK'
  /** gero-backend could not be reached, timed out (also while the body was being read), or answered with an HTTP error. */
  | 'UNREACHABLE'
  /** The transaction is unknown to gero-backend, or it created no output at that index. */
  | 'NOT_FOUND'
  /**
   * gero-backend answered, but not with something that proves the UTxO: a body that is not JSON, bytes
   * that are not a transaction or do not hash to the id asked for, or an output of the wrong shape.
   */
  | 'MALFORMED';

export class ListingUtxoError extends Error {
  constructor(readonly code: ListingUtxoErrorCode, detail: string) {
    super(`Listing UTxO not confirmed on chain (${code}): ${detail}`);
    this.name = 'ListingUtxoError';
  }
}

const TX_HASH = /^[0-9a-f]{64}$/;

function malformed(detail: string): never {
  throw new ListingUtxoError('MALFORMED', detail);
}

/**
 * Read the UTxO `ref` from the creating transaction's CBOR on `network`, proven against the
 * transaction id. Throws ListingUtxoError, never returns a guess. Only the networks the market
 * runs on are asked about.
 */
export async function fetchListingUtxoProven(ref: ListingRef, network: string): Promise<ListingChainUtxo> {
  if (!NFT_MARKET_ALLOWED_NETWORKS.includes(network)) {
    throw new ListingUtxoError('UNSUPPORTED_NETWORK', `the market is not served on ${String(network)}`);
  }
  const txHash = typeof ref?.txHash === 'string' ? ref.txHash.toLowerCase() : '';
  if (!TX_HASH.test(txHash) || !Number.isSafeInteger(ref.outputIndex) || ref.outputIndex < 0) {
    malformed('the listing reference is not a transaction hash and an output index');
  }

  let cbor: string | undefined;
  try {
    cbor = (await backendSource(network)([txHash])).get(txHash);
  } catch (e) {
    // `Response.json()` rejects with a SyntaxError for a body that is not JSON; everything else
    // (no connection, an HTTP error, the timeout firing while the body is still being read) is
    // gero-backend not answering.
    if ((e as Error | undefined)?.name === 'SyntaxError') malformed('the gero-backend answer is not JSON');
    throw new ListingUtxoError('UNREACHABLE', 'gero-backend could not be reached or did not answer in time');
  }
  // gero-backend leaves out a transaction it does not know, as does a build with no backend URL.
  if (!cbor) throw new ListingUtxoError('NOT_FOUND', 'gero-backend does not know the transaction that created this UTxO');

  const proven = provenTxOutput(cbor, txHash, ref.outputIndex);
  if (!proven.output) {
    switch (proven.failure) {
      case 'undecodable':
        return malformed('the bytes gero-backend served are not a transaction');
      case 'wrong-transaction':
        return malformed('the bytes gero-backend served do not hash to the transaction id of the listing');
      default:
        throw new ListingUtxoError('NOT_FOUND', 'the transaction that created this listing has no such output');
    }
  }
  return readOutput(proven.output, `${txHash}#${ref.outputIndex}`);
}

/** The fields `verifyBuy` holds the row to, read from the serialized output so the datum keeps its bytes. */
function readOutput(output: Serialization.TransactionOutput, ref: string): ListingChainUtxo {
  let address: string;
  try {
    // Throws for a Byron address, which is never a script address.
    address = output.address().toBech32();
  } catch {
    return malformed('the output has an address that is not a Shelley address');
  }

  const value = output.amount();
  const assets = [...(value.multiasset() ?? new Map<Cardano.AssetId, bigint>())].map(([unit, quantity]) => {
    if (quantity <= 0n) return malformed('the output holds a token with a quantity that is not positive');
    return { unit: String(unit).toLowerCase(), quantity };
  });

  // The datum as it sits in the transaction. `PlutusData.toCbor()` of a parsed datum is the
  // original bytes; going through Core (`toCore()`) would re-encode a list or lose a bare integer.
  const inline = output.datum()?.asInlineData();
  let inlineDatumCbor: string | null = null;
  if (inline) {
    try {
      inlineDatumCbor = String(inline.toCbor()).toLowerCase();
    } catch {
      return malformed('the output has an inline datum that cannot be read');
    }
  }

  return { ref, address, lovelace: BigInt(value.coin()), assets, inlineDatumCbor };
}
