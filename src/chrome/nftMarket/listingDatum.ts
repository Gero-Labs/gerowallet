// The Gero listing datum, its output tag and its fee arithmetic, as the wallet worker reads them.
//
// The worker uses these to recognise its own listings (the owner and seller address a datum
// names) and to hold every market transaction Nexus builds to what the contract will accept: the
// seller and fee amounts, the tag on each payee output. A wrong byte here makes the worker trust
// a bad transaction or refuse a good one. Port of Nexus's `GeroListingCodec` (decode, tag, fee,
// sellerShare), kept byte-compatible with it and with gero-market-contracts
// (`lib/gero_market/types.ak`, `docs/rules.md` P1, P4, G1, `test-vectors/tags.json`).
//
// Decoding is STRICT. The contract reads a datum lazily, so a UTxO at the script can hold a
// datum of any shape: one of the wrong shape can never be bought, and can be cancelled only if
// its field 0 is a signing key. A datum that is not exactly a `Listing` is not a Gero listing,
// and the wallet must not call it the user's, subtract it from a balance or offer it for
// cancel. So every level checks its constructor index and field count, every hash is 28 bytes,
// price and lovelace are integers, a pointer stake address is refused (the contract treats it as
// a different address that the wallet cannot render or pay), and nothing may follow the datum.
// Definite and indefinite CBOR arrays are both accepted: they are the same Plutus data.
//
// Plutus data (types.ak, rules.md):
//   Listing  = Constr 0 [ B owner(28), Address, I price, List<Payee>, Option<B buyer(28)> ]
//   Payee    = Constr 0 [ Address, I lovelace ]
//   Address  = Constr 0 [ Credential, Option<Referenced<Credential>> ]
//   Credential = VerificationKey: Constr 0 [B(28)] | Script: Constr 1 [B(28)]
//   Referenced = Inline: Constr 0 [Credential] | Pointer: Constr 1 [...]   (refused)
//   Option   = Some: Constr 0 [x] | None: Constr 1 []

import { Cardano, Serialization } from '@cardano-sdk/core';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { blake2b } from '@noble/hashes/blake2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import type { NftMarketDeployment } from '@/utils/nftMarketDeployments';

/** One payee of a listing (a royalty): where it is paid and the least it must receive. */
export interface Payee {
  /** Bech32 address, rendered for the network the datum was decoded for. */
  address: string;
  lovelace: bigint;
}

/** A decoded listing datum. Every address is rendered as a bech32 string. */
export interface ListingDatum {
  /** The seller's payment key hash (56 hex). Must sign a cancel. */
  owner: string;
  /** Where the seller's proceeds and the deposit go. */
  sellerAddress: string;
  /** What the buyer pays to the payees, in lovelace (fee + royalties + seller share). */
  price: bigint;
  /** Creator royalties, in datum order. May be empty. */
  royalties: Payee[];
  /** The key hash (56 hex) that alone may buy, or null for a public listing. */
  buyer: string | null;
}

/**
 * The input is not a Gero listing datum, or a tag argument is invalid. Thrown by every function
 * of this module that reads bytes or builds them; the arithmetic helpers never throw it.
 */
export class ListingDatumError extends Error {
  constructor(detail: string) {
    super(`Not a Gero listing datum: ${detail}`);
    this.name = 'ListingDatumError';
  }
}

type PlutusData = Cardano.PlutusData;

const HASH_BYTES = 28;
const HEX_BYTES = /^(?:[0-9a-fA-F]{2})+$/;
const TX_ID = /^[0-9a-fA-F]{64}$/;
const BPS_DENOMINATOR = 10_000n;

// ---------------------------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------------------------

/**
 * Decode the CBOR (hex) of an inline datum as a `Listing`, rendering every address for
 * `networkId` (0 for preprod and preview, 1 for mainnet). Throws ListingDatumError on anything
 * that is not exactly a Gero listing: another constructor, a missing or extra field, a hash that
 * is not 28 bytes, a pointer stake address, bytes after the datum, unreadable CBOR.
 */
export function decodeListingDatum(inlineDatumCbor: string, networkId: number): ListingDatum {
  if (networkId !== Cardano.NetworkId.Mainnet && networkId !== Cardano.NetworkId.Testnet) {
    throw new ListingDatumError(`unsupported network id ${String(networkId)}`);
  }
  try {
    // OX Agent: Authorization prevented by failing closed: only exactly a Listing is read, anything else is refused
    return readListing(parseDatum(inlineDatumCbor), networkId);
  } catch (e) {
    if (e instanceof ListingDatumError) throw e;
    // The SDK throws plain Errors for unreadable CBOR and a RangeError for a datum nested past
    // the stack: neither is a reason to let a hostile UTxO break the caller.
    throw new ListingDatumError(`unreadable datum: ${(e as Error)?.message ?? String(e)}`);
  }
}

function parseDatum(hex: unknown): PlutusData {
  if (typeof hex !== 'string' || !HEX_BYTES.test(hex)) throw new ListingDatumError('the datum is not hex bytes');
  // The SDK is not a gatekeeper: PlutusData.fromCbor ignores whatever follows the first item,
  // skips some foreign tags, and does not finish on a datum nested tens of thousands deep. So
  // the bytes are checked here first, and only a datum that is well-formed Plutus data in one
  // piece reaches it.
  assertPlutusDataCbor(hexToBytes(hex));
  return Serialization.PlutusData.fromCbor(HexBlob(hex)).toCore();
}

// ---------------------------------------------------------------------------------------------
// A strict walk of the CBOR, before the SDK sees it. Reads only what Plutus data may hold:
// integers (major 0 and 1, and the bignum tag 2 over a byte string), byte strings (definite, or
// chunked), arrays, maps, and the constructor tags 102, 121-127 and 1280-1400 over an array.
// Text, floats, simple values and every other tag are refused, including the negative bignum
// tag 3: the SDK reads it one off (-n for -1-n), and no price or lovelace of a listing can be
// below -2^64, so a datum carrying one is not a listing.
//
// A declared length is checked against the bytes left before anything is read or allocated
// (every element takes at least one byte), so a head claiming 2 GB costs nothing. Nesting is
// capped, so a datum of 20,000 nested arrays never reaches the SDK or the stack. Nothing may
// follow the item.
// ---------------------------------------------------------------------------------------------

/** Deepest array or map nesting accepted. A Listing needs 7 levels; the rest is slack. */
const MAX_NESTING = 16;

const CBOR_BREAK = 0xff;
const MAJOR_UNSIGNED = 0;
const MAJOR_NEGATIVE = 1;
const MAJOR_BYTES = 2;
const MAJOR_ARRAY = 4;
const MAJOR_MAP = 5;
const MAJOR_TAG = 6;
const INDEFINITE = 31;

function assertPlutusDataCbor(bytes: Uint8Array): void {
  if (walkItem(bytes, 0, 0) !== bytes.length) throw new ListingDatumError('trailing bytes after the datum');
}

/** Constructor tags (121-127, 1280-1400, 102 for the general form) and the bignum tag 2. */
function isPlutusTag(tag: bigint): boolean {
  return tag === 2n || tag === 102n || (tag >= 121n && tag <= 127n) || (tag >= 1280n && tag <= 1400n);
}

/** Validate the item starting at `start` and return the position just after it. */
function walkItem(b: Uint8Array, start: number, depth: number): number {
  if (start >= b.length) throw new ListingDatumError('the datum is truncated');
  const major = b[start] >> 5;
  const info = b[start] & 0x1f;
  let pos = start + 1;

  // The head's argument: a length, a value or a tag number. null is an indefinite length.
  let arg: bigint | null;
  if (info < 24) {
    arg = BigInt(info);
  } else if (info < 28) {
    const width = 1 << (info - 24);
    if (pos + width > b.length) throw new ListingDatumError('the datum is truncated');
    arg = 0n;
    for (let i = 0; i < width; i++) arg = (arg << 8n) | BigInt(b[pos + i]);
    pos += width;
  } else if (info === INDEFINITE) {
    arg = null;
  } else {
    throw new ListingDatumError('the datum has a malformed CBOR head');
  }

  if (major === MAJOR_UNSIGNED || major === MAJOR_NEGATIVE) {
    if (arg === null) throw new ListingDatumError('the datum has a malformed CBOR head');
    return pos;
  }
  if (major === MAJOR_BYTES) return arg === null ? walkChunks(b, pos) : skipBytes(b, pos, arg);
  if (major === MAJOR_ARRAY || major === MAJOR_MAP) {
    return walkItems(b, pos, arg, major === MAJOR_MAP ? 2 : 1, depth + 1);
  }
  if (major === MAJOR_TAG) {
    if (arg === null) throw new ListingDatumError('the datum has a malformed CBOR head');
    if (arg === 3n) throw new ListingDatumError('a negative bignum (CBOR tag 3) is not a value a listing holds');
    if (!isPlutusTag(arg)) throw new ListingDatumError(`CBOR tag ${arg} is not a Plutus data tag`);
    if (pos >= b.length) throw new ListingDatumError('the datum is truncated');
    // A bignum wraps a byte string, a constructor wraps an array; a tag never wraps a tag.
    const content = b[pos] >> 5;
    if (content !== (arg === 2n ? MAJOR_BYTES : MAJOR_ARRAY)) {
      throw new ListingDatumError(`CBOR tag ${arg} wraps the wrong kind of item`);
    }
    return walkItem(b, pos, depth);
  }
  throw new ListingDatumError('the datum holds text, a float or a simple value, which Plutus data cannot');
}

function skipBytes(b: Uint8Array, pos: number, length: bigint): number {
  if (length > BigInt(b.length - pos)) throw new ListingDatumError('a declared length runs past the end of the datum');
  return pos + Number(length);
}

/** A chunked byte string: definite chunks up to the break. */
function walkChunks(b: Uint8Array, start: number): number {
  let pos = start;
  for (;;) {
    if (pos >= b.length) throw new ListingDatumError('the datum is truncated');
    if (b[pos] === CBOR_BREAK) return pos + 1;
    if (b[pos] >> 5 !== MAJOR_BYTES || (b[pos] & 0x1f) === INDEFINITE) {
      throw new ListingDatumError('a chunked byte string holds something other than definite chunks');
    }
    pos = walkItem(b, pos, 0);
  }
}

/** The `perEntry` items of each element of an array (1) or map (2), definite or indefinite. */
function walkItems(b: Uint8Array, start: number, count: bigint | null, perEntry: number, depth: number): number {
  if (depth > MAX_NESTING) throw new ListingDatumError('the datum is nested too deeply');
  let pos = start;
  if (count !== null) {
    // Every item takes at least one byte: a longer claim is a lie, however large.
    if (count > BigInt(b.length - pos)) throw new ListingDatumError('a declared length runs past the end of the datum');
    for (let remaining = Number(count) * perEntry; remaining > 0; remaining--) pos = walkItem(b, pos, depth);
    return pos;
  }
  for (;;) {
    if (pos >= b.length) throw new ListingDatumError('the datum is truncated');
    if (b[pos] === CBOR_BREAK) return pos + 1;
    pos = walkItem(b, pos, depth);
  }
}

function isConstr(data: unknown): data is Cardano.ConstrPlutusData {
  // `constructor` is an own bigint on the SDK's constr object; on every other value it is
  // undefined or the inherited class.
  if (typeof data !== 'object' || data === null) return false;
  const { constructor: index, fields } = data as { constructor: unknown; fields?: { items?: unknown } };
  return typeof index === 'bigint' && Array.isArray(fields?.items);
}

function isList(data: unknown): data is Cardano.PlutusList {
  return (
    typeof data === 'object' &&
    data !== null &&
    !(data instanceof Uint8Array) &&
    !isConstr(data) &&
    Array.isArray((data as { items?: unknown }).items)
  );
}

/** The fields of `data`, which must be `Constr index` with exactly `count` fields. */
function fieldsOf(data: PlutusData, index: bigint, count: number, what: string): PlutusData[] {
  if (!isConstr(data)) throw new ListingDatumError(`${what} is not a constructor`);
  if (data.constructor !== index) {
    throw new ListingDatumError(`${what} has constructor ${data.constructor}, expected ${index}`);
  }
  const fields = data.fields.items;
  if (fields.length !== count) {
    throw new ListingDatumError(`${what} has ${fields.length} fields, expected ${count}`);
  }
  return fields;
}

/** `Option`: `Some(x)` is `Constr 0 [x]`, `None` is `Constr 1 []`. Returns x, or null for None. */
function readOption(data: PlutusData, what: string): PlutusData | null {
  if (!isConstr(data)) throw new ListingDatumError(`${what} is not an Option`);
  if (data.constructor === 1n) {
    if (data.fields.items.length !== 0) throw new ListingDatumError(`${what} is None with a field`);
    return null;
  }
  if (data.constructor === 0n) return fieldsOf(data, 0n, 1, `${what} (Some)`)[0];
  throw new ListingDatumError(`${what} has constructor ${data.constructor}, expected Some (0) or None (1)`);
}

function readHash(data: PlutusData, what: string): string {
  if (!(data instanceof Uint8Array) || data.length !== HASH_BYTES) {
    throw new ListingDatumError(`${what} is not a ${HASH_BYTES}-byte hash`);
  }
  return bytesToHex(data);
}

function readInteger(data: PlutusData, what: string): bigint {
  if (typeof data !== 'bigint') throw new ListingDatumError(`${what} is not an integer`);
  return data;
}

/** `VerificationKey(hash)` is `Constr 0 [B]`, `Script(hash)` is `Constr 1 [B]`. */
function readCredential(data: PlutusData, what: string): Cardano.Credential {
  if (!isConstr(data) || (data.constructor !== 0n && data.constructor !== 1n)) {
    throw new ListingDatumError(`${what} is not a VerificationKey or Script credential`);
  }
  const [hash] = fieldsOf(data, data.constructor, 1, `${what} credential`);
  return {
    type: data.constructor === 0n ? Cardano.CredentialType.KeyHash : Cardano.CredentialType.ScriptHash,
    hash: Hash28ByteBase16(readHash(hash, `${what} credential hash`)),
  };
}

/** The stake part: None, or `Some(Inline(credential))`. A pointer is refused. */
function readStake(data: PlutusData, what: string): Cardano.Credential | null {
  const referenced = readOption(data, `${what} stake credential`);
  if (referenced === null) return null;
  if (isConstr(referenced) && referenced.constructor === 1n) {
    throw new ListingDatumError(`${what} has a pointer stake address`);
  }
  const [credential] = fieldsOf(referenced, 0n, 1, `${what} stake credential (Inline)`);
  return readCredential(credential, `${what} stake`);
}

/** `Address = Constr 0 [payment credential, Option<Inline credential>]`, as bech32. */
function readAddress(data: PlutusData, networkId: Cardano.NetworkId, what: string): string {
  const [paymentData, stakeData] = fieldsOf(data, 0n, 2, `${what} address`);
  const payment = readCredential(paymentData, `${what} payment`);
  const stake = readStake(stakeData, what);
  const address =
    stake === null
      ? Cardano.EnterpriseAddress.fromCredentials(networkId, payment)
      : Cardano.BaseAddress.fromCredentials(networkId, payment, stake);
  return address.toAddress().toBech32();
}

function readPayee(data: PlutusData, networkId: Cardano.NetworkId, index: number): Payee {
  const what = `royalty ${index + 1}`;
  const [addressData, lovelaceData] = fieldsOf(data, 0n, 2, `${what} (Payee)`);
  return {
    address: readAddress(addressData, networkId, what),
    lovelace: readInteger(lovelaceData, `${what} lovelace`),
  };
}

function readListing(data: PlutusData, networkId: Cardano.NetworkId): ListingDatum {
  const [ownerData, sellerData, priceData, royaltiesData, buyerData] = fieldsOf(data, 0n, 5, 'the datum (Listing)');
  if (!isList(royaltiesData)) throw new ListingDatumError('royalties is not a list');
  const buyer = readOption(buyerData, 'buyer');
  return {
    owner: readHash(ownerData, 'owner'),
    sellerAddress: readAddress(sellerData, networkId, 'seller'),
    price: readInteger(priceData, 'price'),
    royalties: royaltiesData.items.map((payee, i) => readPayee(payee, networkId, i)),
    buyer: buyer === null ? null : readHash(buyer, 'buyer'),
  };
}

// ---------------------------------------------------------------------------------------------
// The output tag
// ---------------------------------------------------------------------------------------------

/** The shortest CBOR unsigned integer: one byte below 24, then 18 nn, 19 nnnn, 1a nnnnnnnn, 1b. */
function cborUint(n: number): string {
  const v = BigInt(n);
  if (v < 24n) return v.toString(16).padStart(2, '0');
  if (v < 0x100n) return `18${v.toString(16).padStart(2, '0')}`;
  if (v < 0x10000n) return `19${v.toString(16).padStart(4, '0')}`;
  if (v < 0x100000000n) return `1a${v.toString(16).padStart(8, '0')}`;
  return `1b${v.toString(16).padStart(16, '0')}`;
}

/**
 * The bytes the contract hashes for a listing's output tag (rules.md G1), as hex:
 * `d8799f 5820 <32-byte tx id> <CBOR uint index> ff`. Built by hand: the contract hashes an
 * INDEFINITE-length constructor, and a generic PlutusData encoder writes a definite-length one,
 * which gives another hash and a purchase that can never validate.
 */
export function listingTagPreimage(txId: string, index: number): string {
  if (typeof txId !== 'string' || !TX_ID.test(txId)) {
    throw new ListingDatumError('a listing tag needs a 64-hex transaction id');
  }
  if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) {
    throw new ListingDatumError('a listing tag needs a non-negative integer output index');
  }
  return `d8799f5820${txId.toLowerCase()}${cborUint(index)}ff`;
}

/**
 * The tag the contract expects as the inline datum of the seller output and of each royalty
 * output of a buy: blake2b-256 of the listing's output reference, as 64 lower-case hex.
 */
export function listingTag(txId: string, index: number): string {
  return bytesToHex(blake2b(hexToBytes(listingTagPreimage(txId, index)), { dkLen: 32 }));
}

// ---------------------------------------------------------------------------------------------
// Fee and the seller's share (bigint only)
// ---------------------------------------------------------------------------------------------

/**
 * The fee the contract takes from a listing of `price` (rules.md P1):
 * `clamp(min, max, floor(price * bps / 10000))`, the minimum applied first and the cap last, so
 * a cap below the minimum would win. No cap when `maxFeeLovelace` is null.
 */
export function listingFee(price: bigint, d: NftMarketDeployment): bigint {
  let fee = (price * BigInt(d.feeBps)) / BPS_DENOMINATOR;
  if (fee < d.minFeeLovelace) fee = d.minFeeLovelace;
  if (d.maxFeeLovelace !== null && fee > d.maxFeeLovelace) fee = d.maxFeeLovelace;
  return fee;
}

/**
 * What the seller keeps of the price: `price - fee - sum(royalties)`. Zero or negative means
 * the listing can never be bought (rules.md P2); callers decide what to do with that.
 */
export function sellerShare(l: ListingDatum, d: NftMarketDeployment): bigint {
  return l.price - listingFee(l.price, d) - l.royalties.reduce((sum, royalty) => sum + royalty.lovelace, 0n);
}

/**
 * What the contract requires the seller output to hold: the share plus the deposit, which is
 * the listing input's own lovelace coming back to the seller.
 */
export function sellerDue(l: ListingDatum, d: NftMarketDeployment, deposit: bigint): bigint {
  return sellerShare(l, d) + deposit;
}
