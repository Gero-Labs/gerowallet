import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { CardanoSignature, CardanoSignDataSignature } from '@keystonehq/bc-ur-registry-cardano';
import { CryptoHDKey, CryptoKeypath, CryptoMultiAccounts, PathComponent, QRHardwareCall } from '@keystonehq/bc-ur-registry';
import { KeystoneSDK, UR, URDecoder } from '@keystonehq/keystone-sdk';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from 'bip39';
import {
  generateBitcoinPSBTQR, generateBitcoinSyncQR, getKeystoneAccountsUR, keystoneBitcoinAccountPath, parseBitcoinSignature, parseBitcoinAccount,
  parseDataSignature, parseKeystoneAccounts, parseSignature,
} from './keystone';
import { InvalidAccountIndexError } from './walletAccount';

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
      origin: new CryptoKeypath([84, 0, 0].map((index) => new PathComponent({ index, hardened: true })), NativeBuffer.from('12345678', 'hex')),
      parentFingerprint: NativeBuffer.from('87654321', 'hex'),
    });
    const parsed = parseBitcoinAccount(hdkey.toUR());
    expect(parsed).toEqual({ xpub: hdkey.getBip32Key(), xfp: '12345678', path: "84'/0'/0'", publicKey: publicKey.toString('hex'), chainCode: '04'.repeat(32) });
  });
});

// A Keystone answers the Bitcoin pairing QR, a key-derivation request, with a
// crypto-multi-accounts UR, which the parser used to refuse (issue 1326).
describe('Keystone Bitcoin pairing', () => {
  // Fixed test vector — never used to hold funds.
  const root = HDKey.fromMasterSeed(mnemonicToSeedSync('legal winner thank year wave sausage worth useful legal winner thank yellow'));
  const FINGERPRINT = NativeBuffer.from(root.fingerprint.toString(16).padStart(8, '0'), 'hex');
  const hardened = (...indices: number[]) => indices.map((index) => new PathComponent({ index, hardened: true }));

  /** The account key the Keystone exports at m/purpose'/0'/account', as it encodes it. */
  const accountKey = (purpose: number, account: number) => {
    const node = root.derive(`m/${purpose}'/0'/${account}'`);
    return new CryptoHDKey({
      isMaster: false, key: NativeBuffer.from(node.publicKey!), chainCode: NativeBuffer.from(node.chainCode!),
      origin: new CryptoKeypath(hardened(purpose, 0, account), FINGERPRINT),
    });
  };
  const answer = (...keys: CryptoHDKey[]) => new CryptoMultiAccounts(FINGERPRINT, keys).toUR();

  it('asks for the account path the parser reads', () => {
    const decoder = new URDecoder();
    decoder.receivePart(String(generateBitcoinSyncQR('segwit', 0).data));
    const [schema] = QRHardwareCall.fromCBOR(decoder.resultUR().cbor).getParams().getSchemas();

    expect(`m/${schema.getKeypath().getPath()}`).toBe(keystoneBitcoinAccountPath('segwit', 0));
    expect(keystoneBitcoinAccountPath('segwit', 0)).toBe("m/84'/0'/0'");
  });

  it('reads the account from the crypto-multi-accounts answer, with the master fingerprint', () => {
    const parsed = parseBitcoinAccount(answer(accountKey(84, 0)), 'segwit', 0);

    expect(parsed).toMatchObject({ xfp: FINGERPRINT.toString('hex'), path: "84'/0'/0'" });
    // The paired xpub derives the account's own addresses.
    const child = (xpub: string) => NativeBuffer.from(HDKey.fromExtendedKey(xpub).derive('m/0/3').publicKey!).toString('hex');
    expect(child(parsed.xpub)).toBe(NativeBuffer.from(root.derive("m/84'/0'/0'/0/3").publicKey!).toString('hex'));
  });

  it('takes the requested account from an answer that carries others', () => {
    const parsed = parseBitcoinAccount(answer(accountKey(86, 0), accountKey(84, 0)), 'segwit', 0);

    expect(parsed.path).toBe("84'/0'/0'");
  });

  it('refuses an answer without the requested account', () => {
    expect(() => parseBitcoinAccount(answer(accountKey(84, 1)), 'segwit', 0)).toThrow('did not return the requested Bitcoin account');
    expect(() => parseBitcoinAccount(accountKey(84, 1).toUR(), 'segwit', 0)).toThrow('did not return the requested Bitcoin account');
  });

  it('refuses another kind of answer', () => {
    expect(() => parseBitcoinAccount(new UR(NativeBuffer.from('a0', 'hex'), 'crypto-account'))).toThrow('Expected a crypto-multi-accounts or crypto-hdkey response');
  });
});

describe('Keystone multi-account pairing', () => {
  const FINGERPRINT = NativeBuffer.from('0a1b2c3d', 'hex');
  /** A Cardano account key as the Keystone answers it: the origin path carries the account. */
  const accountKey = (index: number, fill: number) => new CryptoHDKey({
    isMaster: false,
    key: NativeBuffer.alloc(32, fill),
    chainCode: NativeBuffer.alloc(32, fill + 1),
    origin: new CryptoKeypath([
      new PathComponent({ index: 1852, hardened: true }),
      new PathComponent({ index: 1815, hardened: true }),
      new PathComponent({ index, hardened: true }),
    ], FINGERPRINT),
  });
  const answer = (...keys: CryptoHDKey[]) => new CryptoMultiAccounts(FINGERPRINT, keys).toCBOR();

  it('asks for the accounts in one key-derivation request', () => {
    const options = getKeystoneAccountsUR([0, 1, 2]);
    expect(String(options.data)).toMatch(/^ur:qr-hardware-call\//i);
    expect(() => getKeystoneAccountsUR([])).toThrow(InvalidAccountIndexError);
  });

  it('reads each account by the path its key carries, with the master fingerprint', () => {
    const { xfp, accounts } = parseKeystoneAccounts(answer(accountKey(1, 3), accountKey(0, 1)), [0, 1]);
    expect(xfp).toBe('0a1b2c3d');
    expect(accounts.map((a) => a.accountIndex)).toEqual([0, 1]);
    expect(accounts[1].keys[0]).toEqual({ publicKey: '03'.repeat(32), chainCode: '04'.repeat(32), path: "m/1852'/1815'/1'" });
  });

  it('keeps only the accounts that were asked for', () => {
    const { accounts } = parseKeystoneAccounts(answer(accountKey(0, 1), accountKey(9, 5)), [0, 1]);
    expect(accounts.map((a) => a.accountIndex)).toEqual([0]);
  });

  it('refuses an answer with none of them', () => {
    expect(() => parseKeystoneAccounts(answer(accountKey(9, 5)), [0, 1])).toThrow(InvalidAccountIndexError);
  });
});
