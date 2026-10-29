import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import {
  CardanoSignature, CardanoSignDataSignature, CardanoSignRequest, CardanoSignTxHashRequest,
} from '@keystonehq/bc-ur-registry-cardano';
import { CryptoHDKey, CryptoKeypath, CryptoMultiAccounts, DataItem, PathComponent, QRHardwareCall } from '@keystonehq/bc-ur-registry';
import { KeystoneSDK, UR, URDecoder } from '@keystonehq/keystone-sdk';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from 'bip39';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Ed25519KeyHashHex, Hash28ByteBase16 } from '@cardano-sdk/crypto';
import type { Keys } from '@/models/types';
import {
  createKeystoneSignRequest, generateBitcoinPSBTQR, generateBitcoinSyncQR, getKeystoneAccountsUR, parseBitcoinSignature,
  parseBitcoinAccount, parseDataSignature, parseKeystoneAccounts, parseSignature,
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
    const parsed = parseBitcoinAccount(hdkey.toUR(), 'Mainnet');
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

  /** The account key the Keystone exports at m/purpose'/coin'/account', as it encodes it. */
  const accountKey = (purpose: number, account: number, coin = 0) => {
    const node = root.derive(`m/${purpose}'/${coin}'/${account}'`);
    return new CryptoHDKey({
      isMaster: false, key: NativeBuffer.from(node.publicKey!), chainCode: NativeBuffer.from(node.chainCode!),
      origin: new CryptoKeypath(hardened(purpose, coin, account), FINGERPRINT),
    });
  };
  const answer = (...keys: CryptoHDKey[]) => new CryptoMultiAccounts(FINGERPRINT, keys).toUR();
  /** The account path the pairing QR asks the Keystone for. */
  const requestedPath = (network: string) => {
    const decoder = new URDecoder();
    decoder.receivePart(String(generateBitcoinSyncQR(network, 'segwit', 0).data));
    const [schema] = QRHardwareCall.fromCBOR(decoder.resultUR().cbor).getParams().getSchemas();
    return `m/${schema.getKeypath().getPath()}`;
  };

  // A testnet account sits at coin type 1', where the software wallet derives it (issue 1327).
  it.each([['Mainnet', "m/84'/0'/0'"], ['Testnet', "m/84'/1'/0'"]])('asks for the %s account at its own coin type', (network, path) => {
    expect(requestedPath(network)).toBe(path);
  });

  it('reads the account from the crypto-multi-accounts answer, with the master fingerprint', () => {
    const parsed = parseBitcoinAccount(answer(accountKey(84, 0)), 'Mainnet', 'segwit', 0);

    expect(parsed).toMatchObject({ xfp: FINGERPRINT.toString('hex'), path: "84'/0'/0'" });
    // The paired xpub derives the account's own addresses.
    const child = (xpub: string) => NativeBuffer.from(HDKey.fromExtendedKey(xpub).derive('m/0/3').publicKey!).toString('hex');
    expect(child(parsed.xpub)).toBe(NativeBuffer.from(root.derive("m/84'/0'/0'/0/3").publicKey!).toString('hex'));
  });

  it('reads a testnet account at coin type 1\', and refuses the coin type 0\' one there', () => {
    expect(parseBitcoinAccount(answer(accountKey(84, 0, 1)), 'Testnet', 'segwit', 0).path).toBe("84'/1'/0'");
    expect(() => parseBitcoinAccount(answer(accountKey(84, 0, 0)), 'Testnet', 'segwit', 0)).toThrow('did not return the requested Bitcoin account');
  });

  it('takes the requested account from an answer that carries others', () => {
    const parsed = parseBitcoinAccount(answer(accountKey(86, 0), accountKey(84, 0)), 'Mainnet', 'segwit', 0);

    expect(parsed.path).toBe("84'/0'/0'");
  });

  it('refuses an answer without the requested account', () => {
    expect(() => parseBitcoinAccount(answer(accountKey(84, 1)), 'Mainnet', 'segwit', 0)).toThrow('did not return the requested Bitcoin account');
    expect(() => parseBitcoinAccount(accountKey(84, 1).toUR(), 'Mainnet', 'segwit', 0)).toThrow('did not return the requested Bitcoin account');
  });

  it('refuses another kind of answer', () => {
    expect(() => parseBitcoinAccount(new UR(NativeBuffer.from('a0', 'hex'), 'crypto-account'), 'Mainnet')).toThrow('Expected a crypto-multi-accounts or crypto-hdkey response');
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

// A withdrawal names a reward address, which is not a base address: reading its
// credential as one threw and failed every Keystone reward withdrawal. Required
// signers were all sent at the stake key path, whoever's key they named.
describe('Keystone Cardano sign request: extra signers', () => {
  // Synthetic hashes, never a real wallet's keys.
  const keyHash = (fill: string) => ({ type: Cardano.CredentialType.KeyHash, hash: Hash28ByteBase16(fill.repeat(28)) });
  const stakeCred = keyHash('aa');
  const paymentCred = keyHash('bb');
  const otherPaymentCred = keyHash('dd');
  const changeCred = keyHash('ee');
  const foreignHash = Ed25519KeyHashHex('cc'.repeat(28));
  const signerHash = (cred: Cardano.Credential) => Ed25519KeyHashHex(cred.hash);
  const rewardAccount = (cred: Cardano.Credential) => Cardano.RewardAccount(
    Cardano.RewardAddress.fromCredentials(Cardano.NetworkId.Mainnet, cred).toAddress().toBech32(),
  );
  const baseAddress = (payment: Cardano.Credential) => Cardano.PaymentAddress(
    Cardano.BaseAddress.fromCredentials(Cardano.NetworkId.Mainnet, payment, stakeCred).toAddress().toBech32(),
  );
  const stakeAddress = rewardAccount(stakeCred);
  const paymentAddress = baseAddress(paymentCred);
  // An added account (#1), so a path hardcoded to account 0' would show.
  const PAYMENT_PATH = "m/1852'/1815'/1'/0/0";
  const OTHER_PAYMENT_PATH = "m/1852'/1815'/1'/0/1";
  const CHANGE_PATH = "m/1852'/1815'/1'/1/0";
  const STAKE_PATH = "m/1852'/1815'/1'/2/0";
  const keys: Keys = {
    ccCold: [], ccHot: [], drep105: [], drep129: [], script: [],
    payment: [
      { address: paymentAddress, cred: paymentCred.hash, path: PAYMENT_PATH },
      { address: baseAddress(otherPaymentCred), cred: otherPaymentCred.hash, path: OTHER_PAYMENT_PATH },
    ],
    change: [{ address: baseAddress(changeCred), cred: changeCred.hash, path: CHANGE_PATH }],
    stake: [{ address: stakeAddress, cred: stakeCred.hash, path: STAKE_PATH }],
  };
  // Only the first payment key holds an input.
  const txIn = { txId: Cardano.TransactionId('11'.repeat(32)), index: 0 };
  const utxos: Cardano.Utxo[] = [[{ ...txIn, address: paymentAddress }, { address: paymentAddress, value: { coins: 5_000_000n } }]];
  const voteDelegation: Cardano.Certificate = {
    __typename: Cardano.CertificateType.VoteDelegation, stakeCredential: stakeCred, dRep: { __typename: 'AlwaysAbstain' },
  };

  const tx = (body: Partial<Cardano.TxBody>, outputCount = 1) => Serialization.Transaction.fromCore({
    id: Cardano.TransactionId('00'.repeat(32)),
    body: {
      inputs: [txIn], fee: 200_000n, ...body,
      outputs: Array.from({ length: outputCount }, () => ({ address: paymentAddress, value: { coins: 1_000_000n } })),
    },
    witness: { signatures: new Map() },
  });
  const request = (body: Partial<Cardano.TxBody>, outputCount?: number) =>
    createKeystoneSignRequest(tx(body, outputCount), { xfp: '0a1b2c3d', stakeAddress }, utxos, keys);
  /** The extra signers the Keystone is asked for, as it decodes the request. */
  const signersOf = (body: Partial<Cardano.TxBody>) => {
    const response = request(body);
    expect(response.useHash).toBe(false);
    return CardanoSignRequest.fromCBOR(response.ur.cbor).getAdditionalSigners()
      .map((signer) => ({ keyHash: signer.getKeyHash().toString('hex'), keyPath: `m/${signer.getKeyPath()}` }));
  };

  it('asks for each required signer that is one of the wallet\'s keys, at that key\'s path', () => {
    expect(signersOf({ requiredExtraSignatures: [signerHash(otherPaymentCred), foreignHash, signerHash(changeCred), signerHash(stakeCred)] }))
      .toEqual([
        { keyHash: otherPaymentCred.hash, keyPath: OTHER_PAYMENT_PATH },
        { keyHash: changeCred.hash, keyPath: CHANGE_PATH },
        { keyHash: stakeCred.hash, keyPath: STAKE_PATH },
      ]);
  });

  it('does not ask again for a required signer whose key already signs an input', () => {
    expect(signersOf({ requiredExtraSignatures: [signerHash(paymentCred)] })).toEqual([]);
  });

  it('lists the stake key once when a required signer and a withdrawal both name it', () => {
    expect(signersOf({ requiredExtraSignatures: [signerHash(stakeCred)], withdrawals: [{ stakeAddress, quantity: 1_000_000n }] }))
      .toEqual([{ keyHash: stakeCred.hash, keyPath: STAKE_PATH }]);
  });

  // A transaction of 2048 bytes or more is signed by hash, with the key paths listed.
  it('asks for the wallet\'s required signers in a hash-signing request', () => {
    const response = request({ requiredExtraSignatures: [signerHash(otherPaymentCred), foreignHash, signerHash(stakeCred)] }, 40);
    expect(response.useHash).toBe(true);
    // Registry 0.5.0's decoder leaves each path as its raw data item, despite the type.
    const paths = CardanoSignTxHashRequest.fromCBOR(response.ur.cbor).getPaths() as unknown as DataItem[];
    expect(paths.map((path) => `m/${CryptoKeypath.fromDataItem(path).getPath()}`))
      .toEqual([PAYMENT_PATH, OTHER_PAYMENT_PATH, STAKE_PATH]);
  });

  it('asks the stake key to sign a withdrawal from the wallet\'s own reward address', () => {
    expect(signersOf({ withdrawals: [{ stakeAddress, quantity: 1_000_000n }] }))
      .toEqual([{ keyHash: stakeCred.hash, keyPath: STAKE_PATH }]);
  });

  it('lists the stake key once for a certificate and a withdrawal of the same key', () => {
    expect(signersOf({ certificates: [voteDelegation], withdrawals: [{ stakeAddress, quantity: 1_000_000n }] }))
      .toEqual([{ keyHash: stakeCred.hash, keyPath: STAKE_PATH }]);
  });

  it('does not sign a withdrawal from another reward address', () => {
    expect(signersOf({ withdrawals: [{ stakeAddress: rewardAccount(keyHash('cc')), quantity: 1_000_000n }] })).toEqual([]);
  });
});
