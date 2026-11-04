import { describe, expect, it } from 'vitest';
import * as ed25519 from '@noble/ed25519';
import * as MS from '@emurgo/cardano-message-signing-browser';
import vectors from '@/shared/utils/signedResponse.vectors.json';
import { verifyDelegation } from '@/shared/utils/signedResponseRoots';
import { addDays, checkCeremonySignature, coseKeyPublicKey, splitList, textToHex, utcDay } from './ceremony';

const hexToBytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** The CIP-8 COSE_Key a Ledger or Trezor returns beside the signature. */
function coseKey(publicKey: Uint8Array): string {
  const key = MS.COSEKey.new(MS.Label.from_key_type(MS.KeyType.OKP));
  key.set_algorithm_id(MS.Label.from_algorithm_id(MS.AlgorithmId.EdDSA));
  key.set_header(MS.Label.new_int(MS.Int.new_negative(MS.BigNum.from_str('1'))), MS.CBORValue.new_int(MS.Int.new_i32(6)));
  key.set_header(MS.Label.new_int(MS.Int.new_negative(MS.BigNum.from_str('2'))), MS.CBORValue.new_bytes(publicKey));
  return toHex(key.to_bytes());
}

const ROOT = hexToBytes(vectors.root.publicKeyHex);
const { statement, coseSign1 } = vectors.root.delegation;

describe('signing ceremony helpers', () => {
  it('works in UTC days', () => {
    expect(utcDay(Date.parse('2026-11-03T23:59:59Z'))).toBe('2026-11-03');
    expect(addDays('2026-11-01', 90)).toBe('2027-01-30');
    expect(addDays('2026-02-30', 1)).toBeUndefined();
    expect(addDays('2026-11-01', 1.5)).toBeUndefined();
  });

  it('splits lists on commas and spaces', () => {
    expect(splitList(' a, b  c,,')).toEqual(['a', 'b', 'c']);
    expect(splitList('')).toEqual([]);
  });

  it('reads the public key from a COSE_Key', async () => {
    expect(await coseKeyPublicKey(coseKey(ROOT))).toEqual(ROOT);
    expect(await coseKeyPublicKey('a0')).toBeUndefined();
    expect(await coseKeyPublicKey('zz')).toBeUndefined();
    expect(await coseKeyPublicKey('')).toBeUndefined();
  });

  it('accepts a signature that verifies, says whether its key is pinned, and prints the entry', async () => {
    const result = await checkCeremonySignature(statement, coseSign1.toUpperCase(), coseKey(ROOT), []);
    expect(result).toEqual({ ok: true, rootPublicKeyHex: vectors.root.publicKeyHex, pinned: false, entry: { statement, coseSign1 } });
    expect(await checkCeremonySignature(statement, coseSign1, coseKey(ROOT), [vectors.root.publicKeyHex.toUpperCase()])).toMatchObject({ pinned: true });
    // What the page prints verifies exactly as the wallet verifies it.
    expect(await verifyDelegation(statement, coseSign1, [ROOT])).toBeDefined();
  });

  it('refuses a signature by another key than the device reported, or over another text', async () => {
    const other = await ed25519.getPublicKeyAsync(new Uint8Array(32).fill(3));
    expect(await checkCeremonySignature(statement, coseSign1, coseKey(other), [])).toEqual({ ok: false, reason: 'not-verified' });
    expect(await checkCeremonySignature(`${statement} `, coseSign1, coseKey(ROOT), [])).toEqual({ ok: false, reason: 'not-verified' });
    expect(await checkCeremonySignature(statement, coseSign1, 'a0', [])).toEqual({ ok: false, reason: 'no-public-key' });
  });

  it('writes the hex signData takes', () => {
    expect(textToHex('gero')).toBe('6765726f');
  });
});
