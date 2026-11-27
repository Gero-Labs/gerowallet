// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { blake2b } from '@noble/hashes/blake2.js';
import { REQUEST_CODE_TAG, formatRequestCode, requestCode } from './requestCode';
import { digitGroups } from './digits';
import { concatBytes, fromHex, le32, pad32, utf8Bytes } from './bytes';
import { FIELD_MODULUS, FieldElement, MidnightNetwork } from './types';

/** The freeze's cancel-recov:v2 statement digest over the vault 0x22 x 32 on preprod. */
const DIGEST = 0x1445ac0c53c87abbbddd7b00be0808de55f6e4a36e1946e7ee6be844ee494652n as FieldElement;
const CONTRACT = '22'.repeat(32);
const BASE = { network: 'preprod' as MidnightNetwork, contract: CONTRACT, digest: DIGEST };

describe('requestCode', () => {
  it('is 20 digits in 4 groups of 5', () => {
    const code = requestCode(BASE);
    expect(code).toHaveLength(4);
    for (const g of code) expect(g).toMatch(/^[0-9]{5}$/);
    expect(formatRequestCode(code)).toMatch(/^[0-9]{5} [0-9]{5} [0-9]{5} [0-9]{5}$/);
  });

  it('is BLAKE2b-160 over the tag, the 32-byte network tag, the contract and the digest (little-endian), by the digit routine', () => {
    const preimage = concatBytes(utf8Bytes('gero-vault/v1|midnight|request-code|'), pad32('preprod'), fromHex(CONTRACT) as Uint8Array, le32(DIGEST));
    expect(REQUEST_CODE_TAG).toBe('gero-vault/v1|midnight|request-code|');
    expect(requestCode(BASE)).toEqual(digitGroups(blake2b(preimage, { dkLen: 20 }), 4));
  });

  it('is pinned for the freeze digest', () => {
    expect(formatRequestCode(requestCode(BASE))).toBe('15096 60025 08345 67044');
  });

  it('changes with the network, the contract and the digest', () => {
    const base = formatRequestCode(requestCode(BASE));
    expect(formatRequestCode(requestCode({ ...BASE, network: 'mainnet' }))).not.toBe(base);
    expect(formatRequestCode(requestCode({ ...BASE, contract: `23${CONTRACT.slice(2)}` }))).not.toBe(base);
    expect(formatRequestCode(requestCode({ ...BASE, digest: (DIGEST + 1n) as FieldElement }))).not.toBe(base);
  });

  it('refuses a bad network, contract or digest', () => {
    const err = expect.objectContaining({ code: 'INVALID_REQUEST_CODE_INPUT' });
    expect(() => requestCode({ ...BASE, network: 'devnet' as MidnightNetwork })).toThrow(err);
    expect(() => requestCode({ ...BASE, contract: CONTRACT.slice(2) })).toThrow(err);
    expect(() => requestCode({ ...BASE, contract: CONTRACT.toUpperCase().replace(/2/g, 'A') })).toThrow(err);
    expect(() => requestCode({ ...BASE, digest: FIELD_MODULUS as FieldElement })).toThrow(err);
    expect(() => requestCode(undefined as never)).toThrow(err);
  });
});
