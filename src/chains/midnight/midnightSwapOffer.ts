// MIP-0005 offer files: a proven, sealed, purposefully imbalanced Midnight
// `Transaction`, shared as bech32m with the `swapoffer` human-readable part.
//
//   bytes  = Transaction.serialize()          (canonical; what is hashed)
//   string = bech32m("swapoffer", bytes)      (interchange: copy, file, QR)
//   id     = lowercase hex(SHA-256(bytes))    (never the hash of the string)
//
// The spec forbids enforcing bech32's 90-character limit (offers are KBs), so
// the limit passed to the codec is the wallet's own size cap instead.
// Decoding only proves the string is well formed: what the offer gives and
// asks for is read from the transaction itself (midnightSwap9.ts).
//
// Also the QR transport: a string that fits one QR code is drawn as text
// (upper case, so QR alphanumeric mode applies); a longer one goes as the
// animated UR the wallet already uses for Keystone, with the raw transaction
// bytes as a UR `bytes` payload (a CBOR byte string).
//
// Pure, no ledger: the pages and the worker both load it.

import { bech32m } from 'bech32';
import { sha256 } from '@noble/hashes/sha2.js';
import { MIDNIGHT_SWAP_MAX_OFFER_CHARS, MIDNIGHT_SWAP_SINGLE_QR_MAX_CHARS } from './midnightSwapConfig';

export const SWAP_OFFER_HRP = 'swapoffer';

/** The UR type of an offer drawn as an animated QR: a CBOR byte string of the raw transaction. */
export const SWAP_OFFER_UR_TYPE = 'bytes';

/** Why a string is not an offer; the worker answers `SWAP_OFFER_UNREADABLE` for all of them. */
export class SwapOfferFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SwapOfferFormatError';
  }
}

/** Encode serialized transaction bytes as a `swapoffer1…` string (lower case). */
export function encodeSwapOffer(bytes: Uint8Array): string {
  if (!bytes.length) throw new SwapOfferFormatError('An offer needs transaction bytes');
  return bech32m.encode(SWAP_OFFER_HRP, bech32m.toWords(bytes), MIDNIGHT_SWAP_MAX_OFFER_CHARS);
}

/**
 * The serialized transaction bytes of a `swapoffer1…` string. Surrounding
 * whitespace (and line breaks from a paste or a file) is ignored; a wrong
 * prefix, a bad checksum, mixed case or an oversized string is refused.
 */
export function decodeSwapOffer(text: string): Uint8Array {
  if (typeof text !== 'string') throw new SwapOfferFormatError('An offer is a string');
  const compact = text.replace(/\s+/g, '');
  if (!compact) throw new SwapOfferFormatError('The offer is empty');
  if (compact.length > MIDNIGHT_SWAP_MAX_OFFER_CHARS) throw new SwapOfferFormatError('The offer is too long');
  let decoded: { prefix: string; words: number[] };
  try {
    decoded = bech32m.decode(compact, MIDNIGHT_SWAP_MAX_OFFER_CHARS);
  } catch {
    throw new SwapOfferFormatError('Not a valid bech32m offer');
  }
  if (decoded.prefix !== SWAP_OFFER_HRP) throw new SwapOfferFormatError('Not a swap offer');
  let bytes: number[];
  try {
    bytes = bech32m.fromWords(decoded.words);
  } catch {
    throw new SwapOfferFormatError('The offer has padding errors');
  }
  if (!bytes.length) throw new SwapOfferFormatError('The offer is empty');
  return Uint8Array.from(bytes);
}

/** Whether `text` looks like an offer string (cheap: prefix only). */
export function looksLikeSwapOffer(text: string): boolean {
  return typeof text === 'string' && text.trim().toLowerCase().startsWith(`${SWAP_OFFER_HRP}1`);
}

/** MIP-0005 content address: lowercase hex SHA-256 of the raw transaction bytes. */
export function swapOfferId(bytes: Uint8Array): string {
  return Buffer.from(sha256(bytes)).toString('hex');
}

/** Whether the offer string is drawn as one QR code (otherwise as an animated UR). */
export function fitsOneQr(offer: string): boolean {
  return offer.length <= MIDNIGHT_SWAP_SINGLE_QR_MAX_CHARS;
}

/** The text of the single QR code: upper case, so the QR alphanumeric mode applies. */
export function singleQrText(offer: string): string {
  return offer.toUpperCase();
}

/** CBOR byte string (major type 2) of `bytes`, as hex: the UR `bytes` payload. */
export function urBytesCbor(bytes: Uint8Array): string {
  const n = bytes.length;
  let head: number[];
  if (n < 24) head = [0x40 | n];
  else if (n < 0x100) head = [0x58, n];
  else if (n < 0x10000) head = [0x59, n >> 8, n & 0xff];
  else head = [0x5a, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  return Buffer.concat([Buffer.from(head), Buffer.from(bytes)]).toString('hex');
}

/** The bytes of a UR `bytes` payload (a CBOR byte string); throws on anything else. */
export function bytesFromUrCbor(cbor: Uint8Array): Uint8Array {
  if (!cbor.length) throw new SwapOfferFormatError('Empty QR payload');
  const first = cbor[0];
  if (first >> 5 !== 2) throw new SwapOfferFormatError('The QR payload is not a byte string');
  const info = first & 0x1f;
  let length: number;
  let offset: number;
  if (info < 24) { length = info; offset = 1; }
  else if (info === 24) { length = cbor[1]; offset = 2; }
  else if (info === 25) { length = (cbor[1] << 8) | cbor[2]; offset = 3; }
  else if (info === 26) { length = ((cbor[1] << 24) >>> 0) + (cbor[2] << 16) + (cbor[3] << 8) + cbor[4]; offset = 5; }
  else throw new SwapOfferFormatError('Unsupported QR payload length');
  if (cbor.length !== offset + length) throw new SwapOfferFormatError('The QR payload length does not match');
  return cbor.slice(offset);
}

/** A file name for "Save as file": the offer id's first 12 hex digits. */
export function swapOfferFileName(offerId: string): string {
  return `gero-swap-offer-${offerId.slice(0, 12)}.txt`;
}
