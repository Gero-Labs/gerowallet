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
  createKeystoneSignRequest, generateBitcoinPSBTQR, generateBitcoinSyncQR, getKeystoneAccountsUR, keystoneFirmwareVersion,
  parseBitcoinSignature, parseBitcoinAccount, parseDataSignature, parseKeystoneAccounts, parseSignature,
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

  it('records the firmware version the device reports, and none for the fixed 1.1.0 or a lone crypto-hdkey', () => {
    const answerFrom = (version: string) => new CryptoMultiAccounts(FINGERPRINT, [accountKey(84, 0)], 'Keystone 3 Pro', undefined, version).toUR();

    expect(parseBitcoinAccount(answerFrom('3.2.0'), 'Mainnet', 'segwit', 0).firmwareVersion).toBe('3.2.0');
    expect(parseBitcoinAccount(answerFrom('1.1.0'), 'Mainnet', 'segwit', 0)).not.toHaveProperty('firmwareVersion');
    expect(parseBitcoinAccount(accountKey(84, 0).toUR(), 'Mainnet', 'segwit', 0)).not.toHaveProperty('firmwareVersion');
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
  const answerFrom = (version: string, ...keys: CryptoHDKey[]) =>
    new CryptoMultiAccounts(FINGERPRINT, keys, 'Keystone 3 Pro', undefined, version).toCBOR();

  it('records the firmware version the device reports, and none for the fixed 1.1.0 of older firmware', () => {
    expect(parseKeystoneAccounts(answerFrom('3.2.0', accountKey(0, 1)), [0]).firmwareVersion).toBe('3.2.0');
    expect(parseKeystoneAccounts(answerFrom('1.1.0', accountKey(0, 1)), [0])).not.toHaveProperty('firmwareVersion');
    expect(parseKeystoneAccounts(answer(accountKey(0, 1)), [0])).not.toHaveProperty('firmwareVersion');
  });

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

// Firmware 1.7.2 and later answer pairing with their own version; up to 1.7.0 the
// answer carries a fixed "1.1.0" (DEVICE_VERSION in keystone3-firmware).
describe('Keystone firmware version at pairing', () => {
  const versionOf = (version?: string) =>
    keystoneFirmwareVersion(new CryptoMultiAccounts(NativeBuffer.from('0a1b2c3d', 'hex'), [], 'Keystone 3 Pro', undefined, version));

  it.each(['1.7.2', '3.2.0', '3.2.0 - Cypherpunk'])('records %s', (version) => {
    expect(versionOf(version)).toBe(version);
  });

  it.each(['1.1.0', '1.7.0', undefined, '', 'v3.2.0', '3.2', '3.2.0; drop'])('records nothing for %s', (version) => {
    expect(versionOf(version)).toBeUndefined();
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
  const DREP_PATH = "m/1852'/1815'/1'/3/0";
  const drepCred = keyHash('9a');
  // Synthetic DRep IDs: a DRep ID is not an address, so no request may list it as one.
  const keys: Keys = {
    ccCold: [], ccHot: [], script: [],
    drep105: [{ address: 'drep1synthetic105', cred: drepCred.hash, path: DREP_PATH }],
    drep129: [{ address: 'drep1synthetic129', cred: drepCred.hash, path: DREP_PATH }],
    payment: [
      { address: paymentAddress, cred: paymentCred.hash, path: PAYMENT_PATH },
      { address: baseAddress(otherPaymentCred), cred: otherPaymentCred.hash, path: OTHER_PAYMENT_PATH },
    ],
    change: [{ address: baseAddress(changeCred), cred: changeCred.hash, path: CHANGE_PATH }],
    stake: [{ address: stakeAddress, cred: stakeCred.hash, path: STAKE_PATH }],
  };
  // Only the first payment key holds an input; the second holds a UTxO a dApp can take as collateral.
  const txIn = { txId: Cardano.TransactionId('11'.repeat(32)), index: 0 };
  const otherIn = { txId: Cardano.TransactionId('22'.repeat(32)), index: 1 };
  const unknownIn = { txId: Cardano.TransactionId('33'.repeat(32)), index: 0 };
  const utxos: Cardano.Utxo[] = [
    [{ ...txIn, address: paymentAddress }, { address: paymentAddress, value: { coins: 5_000_000n } }],
    [{ ...otherIn, address: baseAddress(otherPaymentCred) }, { address: baseAddress(otherPaymentCred), value: { coins: 5_000_000n } }],
  ];
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
  const request = (body: Partial<Cardano.TxBody>, outputCount?: number, keySet: Keys = keys) =>
    createKeystoneSignRequest(tx(body, outputCount), { xfp: '0a1b2c3d', stakeAddress }, utxos, keySet);
  /** The extra signers the Keystone is asked for, as it decodes the request. */
  const signersOf = (body: Partial<Cardano.TxBody>, keySet?: Keys) => {
    const response = request(body, 1, keySet);
    expect(response.useHash).toBe(false);
    return CardanoSignRequest.fromCBOR(response.ur.cbor).getAdditionalSigners()
      .map((signer) => ({ keyHash: signer.getKeyHash().toString('hex'), keyPath: `m/${signer.getKeyPath()}` }));
  };
  /** The hash-signing request (2048 bytes or more) the Keystone is sent, as it decodes it. */
  const hashRequestOf = (body: Partial<Cardano.TxBody>) => {
    const response = request(body, 40);
    expect(response.useHash).toBe(true);
    return CardanoSignTxHashRequest.fromCBOR(response.ur.cbor);
  };
  /** The key paths a hash-signing request asks the Keystone for. */
  const hashPathsOf = (body: Partial<Cardano.TxBody>) => {
    // Registry 0.5.0's decoder leaves each path as its raw data item, despite the type.
    const paths = hashRequestOf(body).getPaths() as unknown as DataItem[];
    return paths.map((path) => `m/${CryptoKeypath.fromDataItem(path).getPath()}`);
  };
  const drepRegistrationOf = (dRepCredential: Cardano.Credential): Cardano.Certificate => ({
    __typename: Cardano.CertificateType.RegisterDelegateRepresentative, dRepCredential, deposit: 500_000_000n, anchor: null,
  });
  const voteAs = (voter: Cardano.Voter): Cardano.VotingProcedures => [{
    voter,
    votes: [{ actionId: { id: Cardano.TransactionId('44'.repeat(32)), actionIndex: 0 }, votingProcedure: { vote: Cardano.Vote.yes, anchor: null } }],
  }];
  const drepVoter = (cred: Cardano.Credential): Cardano.Voter => ({
    __typename: Cardano.VoterType.dRepKeyHash, credential: { type: Cardano.CredentialType.KeyHash, hash: cred.hash },
  });
  const voteDelegationOf = (stakeCredential: Cardano.Credential): Cardano.Certificate => ({
    __typename: Cardano.CertificateType.VoteDelegation, stakeCredential, dRep: { __typename: 'AlwaysAbstain' },
  });
  const foreignStakeCred = keyHash('cc');
  const scriptStakeCred = { type: Cardano.CredentialType.ScriptHash, hash: Hash28ByteBase16('ff'.repeat(28)) };
  const poolRegistrationOwnedBy = (...owners: Cardano.RewardAccount[]): Cardano.Certificate => ({
    __typename: Cardano.CertificateType.PoolRegistration,
    poolParameters: {
      id: Cardano.PoolId.fromKeyHash(Ed25519KeyHashHex('12'.repeat(28))),
      vrf: Cardano.VrfVkHex('34'.repeat(32)),
      pledge: 0n, cost: 340_000_000n, margin: { numerator: 1, denominator: 100 },
      rewardAccount: rewardAccount(foreignStakeCred), owners, relays: [],
    },
  });

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

  it('asks for the wallet\'s required signers in a hash-signing request', () => {
    expect(hashPathsOf({ requiredExtraSignatures: [signerHash(otherPaymentCred), foreignHash, signerHash(stakeCred)] }))
      .toEqual([PAYMENT_PATH, OTHER_PAYMENT_PATH, STAKE_PATH]);
  });

  it('does not sign a certificate for another key or a script with the stake key', () => {
    expect(signersOf({ certificates: [voteDelegationOf(foreignStakeCred), voteDelegationOf(scriptStakeCred)] })).toEqual([]);
  });

  it('signs only the wallet\'s own certificate when the transaction carries others too', () => {
    expect(signersOf({ certificates: [voteDelegationOf(foreignStakeCred), voteDelegation] }))
      .toEqual([{ keyHash: stakeCred.hash, keyPath: STAKE_PATH }]);
  });

  it('asks for the stake key in a hash-signing request only for the wallet\'s own certificate or withdrawal', () => {
    expect(hashPathsOf({
      certificates: [voteDelegationOf(foreignStakeCred), voteDelegationOf(scriptStakeCred)],
      withdrawals: [{ stakeAddress: rewardAccount(scriptStakeCred), quantity: 0n }],
    })).toEqual([PAYMENT_PATH]);
    expect(hashPathsOf({ certificates: [voteDelegation] })).toEqual([PAYMENT_PATH, STAKE_PATH]);
    expect(hashPathsOf({ withdrawals: [{ stakeAddress, quantity: 1_000_000n }] })).toEqual([PAYMENT_PATH, STAKE_PATH]);
  });

  it('asks the stake key to sign a pool registration that lists the wallet as an owner', () => {
    expect(signersOf({ certificates: [poolRegistrationOwnedBy(rewardAccount(foreignStakeCred), stakeAddress)] }))
      .toEqual([{ keyHash: stakeCred.hash, keyPath: STAKE_PATH }]);
  });

  it('does not sign a pool registration the wallet does not own', () => {
    expect(signersOf({ certificates: [poolRegistrationOwnedBy(rewardAccount(foreignStakeCred))] })).toEqual([]);
  });

  it('lists the stake key once for a pool ownership and a withdrawal of the same key', () => {
    expect(signersOf({ certificates: [poolRegistrationOwnedBy(stakeAddress)], withdrawals: [{ stakeAddress, quantity: 1_000_000n }] }))
      .toEqual([{ keyHash: stakeCred.hash, keyPath: STAKE_PATH }]);
  });

  it('asks for the stake key in a hash-signing request only for a pool the wallet owns', () => {
    expect(hashPathsOf({ certificates: [poolRegistrationOwnedBy(stakeAddress)] })).toEqual([PAYMENT_PATH, STAKE_PATH]);
    expect(hashPathsOf({ certificates: [poolRegistrationOwnedBy(rewardAccount(foreignStakeCred))] })).toEqual([PAYMENT_PATH]);
  });

  describe('firmware too old to show a pool registration (before 1.5.8)', () => {
    const onFirmware = (firmwareVersion: string | undefined, body: Partial<Cardano.TxBody>) => () =>
      createKeystoneSignRequest(tx(body), { xfp: '0a1b2c3d', stakeAddress, firmwareVersion }, utxos, keys);
    const poolRegistration = { certificates: [poolRegistrationOwnedBy(stakeAddress)] };

    it('refuses a pool registration before asking the device', () => {
      expect(onFirmware('1.5.6', poolRegistration)).toThrow('This Keystone firmware cannot show pool registrations. Update it to 1.5.8 or later');
    });

    it.each(['1.5.8', '3.2.0', undefined])('lets firmware %s sign it', (firmwareVersion) => {
      expect(onFirmware(firmwareVersion, poolRegistration)).not.toThrow();
    });

    it('lets old firmware sign a transaction without a pool registration', () => {
      expect(onFirmware('1.5.6', { certificates: [voteDelegation] })).not.toThrow();
    });
  });

  describe('DRep key', () => {
    it('asks the DRep key to sign the wallet\'s own DRep registration, and nothing for another DRep', () => {
      expect(signersOf({ certificates: [drepRegistrationOf(drepCred)] })).toEqual([{ keyHash: drepCred.hash, keyPath: DREP_PATH }]);
      expect(signersOf({ certificates: [drepRegistrationOf(foreignStakeCred)] })).toEqual([]);
    });

    it('asks the DRep key to sign a vote cast as the wallet\'s DRep, and nothing for another voter', () => {
      expect(signersOf({ votingProcedures: voteAs(drepVoter(drepCred)) })).toEqual([{ keyHash: drepCred.hash, keyPath: DREP_PATH }]);
      expect(signersOf({ votingProcedures: voteAs(drepVoter(foreignStakeCred)) })).toEqual([]);
    });

    it('lists the DRep key once for a DRep registration, a vote and a required signer naming it', () => {
      expect(signersOf({
        certificates: [drepRegistrationOf(drepCred)], votingProcedures: voteAs(drepVoter(drepCred)), requiredExtraSignatures: [signerHash(drepCred)],
      })).toEqual([{ keyHash: drepCred.hash, keyPath: DREP_PATH }]);
    });

    it('asks for the DRep path in a hash-signing request, without listing the DRep ID as an address', () => {
      const body = { certificates: [drepRegistrationOf(drepCred)] };
      expect(hashPathsOf(body)).toEqual([PAYMENT_PATH, DREP_PATH]);
      expect(hashRequestOf(body).getAddressList()).toEqual([paymentAddress]);
    });
  });

  describe('collateral', () => {
    it('asks the key holding a collateral UTxO to sign when no input of that key does', () => {
      expect(signersOf({ collaterals: [otherIn] })).toEqual([{ keyHash: otherPaymentCred.hash, keyPath: OTHER_PAYMENT_PATH }]);
      expect(hashPathsOf({ collaterals: [otherIn] })).toEqual([PAYMENT_PATH, OTHER_PAYMENT_PATH]);
    });

    it('does not ask again when an input of the same key signs, nor for a collateral UTxO it does not know', () => {
      expect(signersOf({ collaterals: [txIn] })).toEqual([]);
      expect(signersOf({ collaterals: [unknownIn] })).toEqual([]);
    });
  });

  describe('key sets and wallet data', () => {
    it('builds a request from a key set with no stake list', () => {
      const withoutStake = { ...keys, stake: undefined } as unknown as Keys;
      expect(signersOf({}, withoutStake)).toEqual([]);
      expect(signersOf({ requiredExtraSignatures: [signerHash(otherPaymentCred)] }, withoutStake))
        .toEqual([{ keyHash: otherPaymentCred.hash, keyPath: OTHER_PAYMENT_PATH }]);
    });

    it('asks the stake key to sign a withdrawal by its key hash when the wallet data carries no stake address', () => {
      const response = createKeystoneSignRequest(tx({ withdrawals: [{ stakeAddress, quantity: 1_000_000n }] }), { xfp: '0a1b2c3d' }, utxos, keys);
      const signers = CardanoSignRequest.fromCBOR(response.ur.cbor).getAdditionalSigners()
        .map((signer) => `m/${signer.getKeyPath()}`);
      expect(signers).toEqual([STAKE_PATH]);
    });

    it('lists a key once when two of its signers spell its hash in different case', () => {
      const upperCase = stakeCred.hash.toUpperCase() as unknown as Ed25519KeyHashHex;
      expect(signersOf({ requiredExtraSignatures: [upperCase], certificates: [voteDelegation] }))
        .toEqual([{ keyHash: stakeCred.hash, keyPath: STAKE_PATH }]);
    });
  });

  // As the software signer's resolver does: a key set that cannot tell, signs.
  it('keeps signing certificates with the stake key when the key set has no stake cred', () => {
    const withoutStakeCred: Keys = { ...keys, stake: [{ address: stakeAddress, cred: '', path: STAKE_PATH }] };
    expect(signersOf({ certificates: [voteDelegationOf(foreignStakeCred)] }, withoutStakeCred))
      .toEqual([{ keyHash: foreignStakeCred.hash, keyPath: STAKE_PATH }]);
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
    expect(signersOf({ withdrawals: [{ stakeAddress: rewardAccount(foreignStakeCred), quantity: 1_000_000n }] })).toEqual([]);
  });
});
