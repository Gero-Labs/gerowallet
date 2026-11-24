// MIP-0005 offer strings: bech32m with the `swapoffer` prefix, no 90-character limit.
import { describe, expect, it } from 'vitest';
import { bech32, bech32m } from 'bech32';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  bytesFromUrCbor, decodeSwapOffer, encodeSwapOffer, fitsOneQr, looksLikeSwapOffer, singleQrText, swapOfferFileName,
  swapOfferId, SwapOfferFormatError, urBytesCbor,
} from './midnightSwapOffer';
import { MIDNIGHT_SWAP_MAX_OFFER_CHARS, MIDNIGHT_SWAP_SINGLE_QR_MAX_CHARS } from './midnightSwapConfig';

const bytes = (n: number, seed = 7) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff);

describe('MIP-0005 offer codec', () => {
  it('round-trips the exact bytes, far past bech32\'s 90-character limit', () => {
    const payload = bytes(4_000);
    const offer = encodeSwapOffer(payload);
    expect(offer.startsWith('swapoffer1')).toBe(true);
    expect(offer.length).toBeGreaterThan(6_000);
    expect(decodeSwapOffer(offer)).toEqual(payload);
  });

  it('matches the reference encoding (bech32m over 8-to-5 bit words)', () => {
    const payload = bytes(64);
    expect(encodeSwapOffer(payload)).toBe(bech32m.encode('swapoffer', bech32m.toWords(payload), 10_000));
  });

  it('reads an upper-case string (a QR code) and ignores whitespace and line breaks', () => {
    const payload = bytes(300);
    const offer = encodeSwapOffer(payload);
    expect(decodeSwapOffer(offer.toUpperCase())).toEqual(payload);
    expect(decodeSwapOffer(`  ${offer.slice(0, 50)}\n${offer.slice(50)}\r\n`)).toEqual(payload);
  });

  it('refuses another prefix', () => {
    const other = bech32m.encode('mn_addr_preprod', bech32m.toWords(bytes(32)), 1_000);
    expect(() => decodeSwapOffer(other)).toThrow(SwapOfferFormatError);
  });

  it('refuses a corrupted checksum, a truncated string and mixed case', () => {
    const offer = encodeSwapOffer(bytes(200));
    const last = offer.at(-1) === 'q' ? 'p' : 'q';
    expect(() => decodeSwapOffer(offer.slice(0, -1) + last)).toThrow(SwapOfferFormatError);
    expect(() => decodeSwapOffer(offer.slice(0, -10))).toThrow(SwapOfferFormatError);
    expect(() => decodeSwapOffer(offer.slice(0, 20) + offer.slice(20).toUpperCase())).toThrow(SwapOfferFormatError);
  });

  it('refuses bech32 (not bech32m), an empty string and an oversized one', () => {
    const legacy = bech32.encode('swapoffer', bech32.toWords(bytes(40)), 1_000);
    expect(() => decodeSwapOffer(legacy)).toThrow(SwapOfferFormatError);
    expect(() => decodeSwapOffer('   ')).toThrow(SwapOfferFormatError);
    expect(() => decodeSwapOffer(`swapoffer1${'q'.repeat(MIDNIGHT_SWAP_MAX_OFFER_CHARS)}`)).toThrow(SwapOfferFormatError);
  });

  it('ids an offer by SHA-256 of the bytes, never of the string', () => {
    const payload = bytes(100);
    const offer = encodeSwapOffer(payload);
    expect(swapOfferId(payload)).toBe(Buffer.from(sha256(payload)).toString('hex'));
    expect(swapOfferId(payload)).not.toBe(Buffer.from(sha256(new TextEncoder().encode(offer))).toString('hex'));
    expect(swapOfferId(decodeSwapOffer(offer))).toBe(swapOfferId(payload));
    expect(swapOfferFileName(swapOfferId(payload))).toMatch(/^gero-swap-offer-[0-9a-f]{12}\.txt$/);
  });

  it('spots an offer by its prefix', () => {
    expect(looksLikeSwapOffer(' SWAPOFFER1abc')).toBe(true);
    expect(looksLikeSwapOffer('mn_addr_preprod1xyz')).toBe(false);
  });
});

describe('offer QR transport', () => {
  it('draws a short offer as one upper-case QR code and a long one as an animated UR', () => {
    const short = encodeSwapOffer(bytes(400));
    const long = encodeSwapOffer(bytes(4_000));
    expect(fitsOneQr(short)).toBe(true);
    expect(singleQrText(short)).toBe(short.toUpperCase());
    expect(long.length).toBeGreaterThan(MIDNIGHT_SWAP_SINGLE_QR_MAX_CHARS);
    expect(fitsOneQr(long)).toBe(false);
  });

  it.each([0, 10, 23, 24, 200, 255, 256, 4_000, 70_000])('wraps %i bytes as a CBOR byte string and back', (n) => {
    const payload = bytes(n);
    const cbor = Uint8Array.from(Buffer.from(urBytesCbor(payload), 'hex'));
    expect(cbor[0] >> 5).toBe(2);
    expect(bytesFromUrCbor(cbor)).toEqual(payload);
  });

  it('refuses a payload that is not a byte string or whose length does not match', () => {
    expect(() => bytesFromUrCbor(Uint8Array.from([0x60]))).toThrow(SwapOfferFormatError);
    expect(() => bytesFromUrCbor(Uint8Array.from([0x43, 1, 2]))).toThrow(SwapOfferFormatError);
    expect(() => bytesFromUrCbor(new Uint8Array())).toThrow(SwapOfferFormatError);
  });
});
