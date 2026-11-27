// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verificationNumberGroups } from '../../verificationNumber';
import { digitGroups } from './digits';
import { toHex } from './bytes';

describe('digits: the verification number\'s digit routine', () => {
  it('equals the Cardano routine for eight groups', () => {
    for (let i = 0; i < 32; i++) {
      const d = Uint8Array.from(Buffer.concat([createHash('sha256').update(`a${i}`).digest(), createHash('sha256').update(`b${i}`).digest()]).subarray(0, 40));
      expect(digitGroups(d, 8)).toEqual(verificationNumberGroups(toHex(d)));
    }
    expect(digitGroups(new Uint8Array(40).fill(0xff), 8)).toEqual(verificationNumberGroups('ff'.repeat(40)));
    expect(digitGroups(new Uint8Array(40), 8)).toEqual(Array(8).fill('00000'));
  });

  it('reads five big-endian bytes per group, modulo 100000, padded', () => {
    expect(digitGroups(Uint8Array.from([0, 0, 0, 0x30, 0x39, 0, 0, 0, 0, 7]), 2)).toEqual(['12345', '00007']);
    expect(digitGroups(new Uint8Array(5).fill(0xff), 1)).toEqual([(0xffffffffffn % 100000n).toString().padStart(5, '0')]);
  });

  it('refuses a digest of the wrong length', () => {
    expect(() => digitGroups(new Uint8Array(19), 4)).toThrow(RangeError);
    expect(() => digitGroups(new Uint8Array(0), 0)).toThrow(RangeError);
  });
});
