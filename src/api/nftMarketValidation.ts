/**
 * What the wallet accepts from Nexus about the Gero NFT market.
 *
 * Nexus answers over the network, so every field is checked before anything uses it: hex
 * lengths and case, decimal-string lovelace, non-negative integers and enums. A response that
 * does not read back whole is refused with an NftMarketResponseError; the wallet never shows,
 * prices or builds from half of an answer. Callers map that error to a failure and the
 * Nexus-side `errorCode` (nexusErrorCode()) to its own wording.
 *
 * This module imports nothing from the API clients so both of them (nft-market-api.ts for the
 * reads, nexus-tx-api.ts for the builders) can use it without a cycle.
 */

/** A Nexus market response that is not shaped as its route promises. */
export class NftMarketResponseError extends Error {
  /** The Nexus route that answered, e.g. `/api/nft-market/listings`. */
  readonly route: string;
  /** The field that failed, as a path, e.g. `items[2].priceLovelace`. Never the value. */
  readonly field: string;

  constructor(route: string, field: string) {
    super(`Malformed Nexus market response from ${route}: ${field}`);
    this.name = 'NftMarketResponseError';
    this.route = route;
    this.field = field;
  }
}

const HEX = /^(?:[0-9a-f]{2})*$/;
const DECIMAL = /^[0-9]+$/;
/** A decimal with no sign, no fraction and no leading zero ("0" is the only one that starts with 0). */
const CANONICAL_DECIMAL = /^(?:0|[1-9][0-9]*)$/;

/** `txHash#outputIndex` as a collateral reference travels. */
const COLLATERAL_REF = /^([0-9a-f]{64})#([0-9]+)$/;

/** Bytes in a transaction id. */
export const TX_HASH_BYTES = 32;
/** Bytes in a policy id, a script hash or a key hash (blake2b-224). */
export const HASH28_BYTES = 28;
/** Most bytes a Cardano asset name can hold. */
export const MAX_ASSET_NAME_BYTES = 32;

/** The checks for one route's response. Each throws an NftMarketResponseError naming `field`. */
export class ResponseReader {
  constructor(readonly route: string) {}

  fail(field: string): never {
    throw new NftMarketResponseError(this.route, field);
  }

  /** A plain JSON object (not null, not an array). */
  record(value: unknown, field: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return this.fail(field);
    return value as Record<string, unknown>;
  }

  array(value: unknown, field: string): unknown[] {
    if (!Array.isArray(value)) return this.fail(field);
    return value;
  }

  /** A non-empty string. */
  string(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.length === 0) return this.fail(field);
    return value;
  }

  /**
   * Lower-case hex of whole bytes. `bytes` fixes the length, `maxBytes` caps it; without
   * `bytes` the value may not be empty unless `allowEmpty`.
   */
  hex(
    value: unknown,
    field: string,
    size: { bytes?: number; maxBytes?: number; allowEmpty?: boolean } = {},
  ): string {
    if (typeof value !== 'string' || !HEX.test(value)) return this.fail(field);
    const length = value.length / 2;
    if (size.bytes !== undefined && length !== size.bytes) return this.fail(field);
    if (size.maxBytes !== undefined && length > size.maxBytes) return this.fail(field);
    if (size.bytes === undefined && length === 0 && !size.allowEmpty) return this.fail(field);
    return value;
  }

  /** A non-negative integer written in decimal digits, as lovelace travels. */
  decimal(value: unknown, field: string): string {
    if (typeof value !== 'string' || !DECIMAL.test(value)) return this.fail(field);
    return value;
  }

  /**
   * A non-negative integer in canonical decimal digits, as a bigint, for a field that is absent
   * or null when there is none (null then). Anything else, including a leading zero or a number,
   * is refused: the value is lovelace that gets compared and summed exactly.
   */
  optionalCanonicalDecimal(value: unknown, field: string): bigint | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string' || !CANONICAL_DECIMAL.test(value)) return this.fail(field);
    return BigInt(value);
  }

  /** A non-negative integer JSON number. */
  int(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return this.fail(field);
    return value;
  }

  /** A finite number from 0 to 1 inclusive. */
  rate(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) return this.fail(field);
    return value;
  }

  oneOf<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
    if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) return this.fail(field);
    return value as T;
  }

  /** `txHash#index`, for a field that is absent or null when there is none. */
  optionalCollateralRef(value: unknown, field: string): string | undefined {
    if (value === undefined || value === null) return undefined;
    const match = typeof value === 'string' ? COLLATERAL_REF.exec(value) : null;
    if (!match || !Number.isSafeInteger(Number(match[2]))) return this.fail(field);
    return value as string;
  }
}

// ── The build response ──

/**
 * What every market build route answers (`list`, `cancel`, `reprice`, `buy`, `migrate`).
 * Advisory only: the wallet verifies the transaction itself before signing it.
 */
export interface NftMarketBuildResponse {
  /** The unsigned transaction, hex. */
  tx_cbor: string;
  tx_hash: string;
  /** Lovelace, a decimal string. */
  estimated_fee: string;
  /** Payment key hashes Nexus says must sign. */
  requiredSigners: string[];
  /** `txHash#index` of Nexus pool collateral; the transaction then needs Nexus's cosign. */
  sponsoredCollateralRef?: string;
  /** Index of the new listing output (list, reprice, migrate). */
  listingOutputIndex?: number;
  /** Lovelace Nexus added to an output to reach its minimum UTxO, a decimal string. */
  minUtxoTopUpLovelace?: string;
}

/**
 * Reads a market build response, or throws an NftMarketResponseError. The result is rebuilt
 * from the fields the wallet uses, so nothing Nexus adds beside them travels on. A null
 * optional field reads as absent.
 */
export function parseNftMarketBuildResponse(data: unknown, route: string): NftMarketBuildResponse {
  const r = new ResponseReader(route);
  const body = r.record(data, 'body');
  // The transaction body is only ever handed to the SDK's decoder, which takes either case.
  const txCbor = body['tx_cbor'];
  r.hex(typeof txCbor === 'string' ? txCbor.toLowerCase() : txCbor, 'tx_cbor');
  const built: NftMarketBuildResponse = {
    tx_cbor: txCbor as string,
    tx_hash: r.hex(body['tx_hash'], 'tx_hash', { bytes: TX_HASH_BYTES }),
    estimated_fee: r.decimal(body['estimated_fee'], 'estimated_fee'),
    requiredSigners: r
      .array(body['requiredSigners'], 'requiredSigners')
      .map((signer, i) => r.hex(signer, `requiredSigners[${i}]`, { bytes: HASH28_BYTES })),
  };
  const collateral = r.optionalCollateralRef(body['sponsoredCollateralRef'], 'sponsoredCollateralRef');
  if (collateral !== undefined) built.sponsoredCollateralRef = collateral;
  const index = body['listingOutputIndex'];
  if (index !== undefined && index !== null) built.listingOutputIndex = r.int(index, 'listingOutputIndex');
  const topUp = body['minUtxoTopUpLovelace'];
  if (topUp !== undefined && topUp !== null) built.minUtxoTopUpLovelace = r.decimal(topUp, 'minUtxoTopUpLovelace');
  return built;
}
