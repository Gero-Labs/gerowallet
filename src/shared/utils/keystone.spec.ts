import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { CardanoSignature, CardanoSignDataSignature } from '@keystonehq/bc-ur-registry-cardano';
import { CryptoHDKey, CryptoKeypath, PathComponent } from '@keystonehq/bc-ur-registry';
import { KeystoneSDK, UR, URDecoder } from '@keystonehq/keystone-sdk';
import { generateBitcoinPSBTQR, parseBitcoinSignature, parseBitcoinAccount, parseDataSignature, parseSignature } from './keystone';

const mocks = vi.hoisted(() => ({ build: vi.fn(() => 'cose-signature'), key: vi.fn(() => 'cose-key') }));
vi.mock('@/shared/utils/converter', () => ({
  createBuilderWithSigStructure: vi.fn(), createCoseKeyHex: mocks.key,
  toHexArray: (hex: string) => new Uint8Array(Buffer.from(hex, 'hex')), buildAndSignData: mocks.build,
}));

// Public synthetic UUIDs and bytes, never real wallet material.
const requestId = 'b85e4201-89d3-4894-b762-83a6430e45b1';
const otherId = '50dc1988-4b54-4f51-8f11-b506b725f967';
// Vitest externalizes the CJS registry, which uses Node Buffer. Construct wire
// fixtures with the same implementation instead of Vite's browser polyfill.
const NativeBuffer = (createRequire(import.meta.url)('node:buffer') as typeof import('node:buffer')).Buffer;
const uuidBytes = (id: string) => NativeBuffer.from(id.replaceAll('-', ''), 'hex');
beforeEach(() => vi.clearAllMocks());

describe('Keystone real SDK wire contracts', () => {
  it('decodes the request UUID and inner witness rather than treating the outer CBOR as a witness', () => {
    const response = new CardanoSignature(NativeBuffer.from('a10080', 'hex'), uuidBytes(requestId));
    const parsed = parseSignature(response.toUR());
    expect(parsed).toEqual({ requestId, witnessSet: 'a10080' });
    expect(parsed.witnessSet).not.toBe(response.toCBOR().toString('hex'));
  });

  it.each([otherId, '', undefined])('rejects a stale or absent CIP8 request ID (%s) before consuming the COSE builder', id => {
    const response = new CardanoSignDataSignature(NativeBuffer.alloc(64, 1), NativeBuffer.alloc(32, 2), id ? uuidBytes(id) : undefined);
    const builder = { publicTestBuilder: true };
    const ur = new UR(response.toCBOR(), 'cardano-sign-data-signature');
    expect(() => parseDataSignature(ur, builder, new Uint8Array([1]), requestId)).toThrow('does not match');
    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.key).not.toHaveBeenCalled();
  });

  it('accepts matching CIP8 request correlation and passes only the raw signature to the builder', () => {
    const signature = NativeBuffer.alloc(64, 3);
    const response = new CardanoSignDataSignature(signature, NativeBuffer.alloc(32, 2), uuidBytes(requestId));
    const builder = { publicTestBuilder: true };
    // Registry 0.5.0's toUR has an incorrect type for this class; scanners provide
    // the cardano-sign-data-signature type specified by the SDK parser.
    const ur = new UR(response.toCBOR(), 'cardano-sign-data-signature');
    expect(parseDataSignature(ur, builder, new Uint8Array([1]), requestId)).toEqual({ signature: 'cose-signature', key: 'cose-key' });
    expect(mocks.build).toHaveBeenCalledWith(builder, new Uint8Array(signature), undefined);
  });

  it('uses the SDK BTC API and returns PSBT hex directly', () => {
    const psbt = '70736274ff00';
    const qr = generateBitcoinPSBTQR(psbt);
    const decoder = new URDecoder();
    decoder.receivePart(qr.data!);
    expect(decoder.isComplete()).toBe(true);
    expect(parseBitcoinSignature(decoder.resultUR())).toBe(psbt);
    const sdk = new KeystoneSDK();
    expect(parseBitcoinSignature(sdk.btc.generatePSBT(Buffer.from(psbt, 'hex')))).toBe(psbt);
  });

  it('decodes crypto-hdkey public account bytes using the registry API', () => {
    // secp256k1 generator public key; test chain code/fingerprint only.
    const publicKey = NativeBuffer.from('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex');
    const hdkey = new CryptoHDKey({ isMaster: false, isPrivateKey: false, key: publicKey,
      chainCode: NativeBuffer.alloc(32, 4),
      origin: new CryptoKeypath([new PathComponent({ index: 84, hardened: true }), new PathComponent({ index: 0, hardened: true })], NativeBuffer.from('12345678', 'hex')),
      parentFingerprint: NativeBuffer.from('87654321', 'hex'),
    });
    const parsed = parseBitcoinAccount(hdkey.toUR());
    expect(parsed).toEqual({ xpub: hdkey.getBip32Key(), xfp: '12345678', path: "84'/0'", publicKey: publicKey.toString('hex'), chainCode: '04'.repeat(32) });
  });
});
