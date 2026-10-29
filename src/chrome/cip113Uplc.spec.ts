// The wallet's own check of a CIP-113 transfer-logic script: the same flat-program parameter
// code as Nexus's UplcDataParams, and the same cases as its UplcDataParamsTest. MickyUSD's
// on-chain logic is the freeze-and-seize template with (Script PLB, blacklist policy) applied.
import { describe, expect, it } from 'vitest';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import {
  applyDataParams,
  extractDataParams,
  plutusV3Hash,
  unwrapByteString,
  wrapByteString,
} from './cip113Uplc';
import { CIP113_TRANSFER_LOGIC_TEMPLATES } from '@/utils/cip113TransferLogic';
import { CIP113_BASE_PREPROD } from '@/utils/cip113Deployments';
import { MICKY_BLACKLIST_POLICY, MICKY_LOGIC_HASH, MICKY_LOGIC_SCRIPT } from './__fixtures__/cip113Preprod';

const template = (id: string) => hexToBytes(CIP113_TRANSFER_LOGIC_TEMPLATES.find((t) => t.moduleId === id)!.compiledCode);
const FES = template('freeze-and-seize');
const DUMMY = template('dummy');
const ON_CHAIN = hexToBytes(MICKY_LOGIC_SCRIPT);

/** `Constr 1 [B plb]`: the Script credential, as the platform encodes it (indefinite list). */
const C1 = hexToBytes(`d87a9f581c${CIP113_BASE_PREPROD[0]}ff`);
const C2 = hexToBytes(`581c${MICKY_BLACKLIST_POLICY}`);

describe('cip113Uplc', () => {
  it('each reviewed template hashes to its recorded hash', () => {
    for (const t of CIP113_TRANSFER_LOGIC_TEMPLATES) {
      expect(plutusV3Hash(hexToBytes(t.compiledCode))).toBe(t.hash);
    }
  });

  it("applying (Script PLB, blacklist policy) reproduces MickyUSD's on-chain logic byte for byte", () => {
    const applied = applyDataParams(FES, [C1, C2]);
    expect(applied.length).toBe(1229);
    expect(bytesToHex(applied)).toBe(MICKY_LOGIC_SCRIPT);
    expect(plutusV3Hash(applied)).toBe(MICKY_LOGIC_HASH);
  });

  it('reading the on-chain logic against the template returns exactly the two applied constants', () => {
    const params = extractDataParams(ON_CHAIN, FES, 2);
    expect(params.map(bytesToHex)).toEqual([bytesToHex(C1), bytesToHex(C2)]);
  });

  it('applying no parameters returns the template unchanged', () => {
    expect(bytesToHex(applyDataParams(FES, []))).toBe(bytesToHex(FES));
    expect(bytesToHex(applyDataParams(DUMMY, []))).toBe(bytesToHex(DUMMY));
  });

  it('a different template does not match', () => {
    expect(() => extractDataParams(ON_CHAIN, DUMMY, 2)).toThrow();
  });

  it('the wrong parameter count does not match', () => {
    expect(() => extractDataParams(ON_CHAIN, FES, 1)).toThrow();
    expect(() => extractDataParams(ON_CHAIN, FES, 3)).toThrow();
    const three = applyDataParams(FES, [C1, C2, C2]);
    expect(() => extractDataParams(three, FES, 2)).toThrow();
  });

  it('one changed bit in the template body does not match', () => {
    const tampered = unwrapByteString(ON_CHAIN).slice();
    tampered[200] ^= 0x01;
    expect(() => extractDataParams(wrapByteString(tampered), FES, 2)).toThrow();
  });

  it("bytes after the program's padding do not match", () => {
    const flat = unwrapByteString(ON_CHAIN);
    const longer = new Uint8Array(flat.length + 1);
    longer.set(flat);
    expect(() => extractDataParams(wrapByteString(longer), FES, 2)).toThrow();
  });

  it('a truncated program does not match', () => {
    const flat = unwrapByteString(ON_CHAIN);
    expect(() => extractDataParams(wrapByteString(flat.slice(0, flat.length - 5)), FES, 2)).toThrow();
  });

  it('bytes that are not a CBOR bytestring are refused', () => {
    expect(() => extractDataParams(new Uint8Array([0x80]), FES, 2)).toThrow();
    expect(() => unwrapByteString(new Uint8Array([0x58]))).toThrow();
  });

  it('wraps and unwraps every CBOR bytestring header width', () => {
    for (const length of [0, 23, 24, 255, 256, 65_535, 65_536]) {
      const content = new Uint8Array(length).fill(7);
      expect(unwrapByteString(wrapByteString(content)).length).toBe(length);
    }
  });
});
