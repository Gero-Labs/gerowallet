// A hardware wallet record holds one account of the device. Ledger and Trezor are sent
// full BIP-32 paths, so every path in what the device is asked to sign must be under that
// account: its inputs, its change output, its certificate and extra-witness keys. These
// sign the wallet's own transaction (its input, change back to it, a vote delegation of its
// stake key) for a wallet on account #1, and check that nothing in the device request says 0'.
import { afterEach, beforeAll, describe, expect, it, vi, type Mock } from 'vitest';
import { bech32 } from 'bech32';
import { HexBlob } from '@cardano-sdk/util';
import { Cardano, Serialization } from '@cardano-sdk/core';
import * as Crypto from '@cardano-sdk/crypto';
import { LedgerKeyAgent } from '@cardano-sdk/hardware-ledger';
import { CommunicationType, KeyPurpose } from '@cardano-sdk/key-management';
import type { MessageData, SignTransactionRequest } from '@cardano-foundation/ledgerjs-hw-app-cardano';
import type Transport from '@ledgerhq/hw-transport';
import type * as Trezor from '@trezor/connect';
import { Blockchain, Keys, Network } from '@/models/types';
import networks from '@/utils/networks';
import {
  NO_COLLATERAL_TX,
  NO_COLLATERAL_TX_ID,
  WALLET_ACCOUNT_XPUB,
  WALLET_ADDRESS,
} from '@/shared/utils/__fixtures__/handAssembledTxs';
import { InvalidAccountIndexError } from '@/shared/utils/walletAccount';
import { Ada } from '@cardano-foundation/ledgerjs-hw-app-cardano';

// Both Trezor modules read chrome.runtime.id as they load (TREZOR_MANIFEST).
vi.hoisted(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = { runtime: { id: 'test-extension-id' } };
});
const { connectWebextension, connectWeb } = vi.hoisted(() => {
  const connect = () => ({ init: vi.fn(async () => undefined), cardanoSignTransaction: vi.fn(), cardanoGetPublicKey: vi.fn() });
  return { connectWebextension: connect(), connectWeb: connect() };
});
vi.mock('@trezor/connect-webextension', () => ({ default: connectWebextension }));
vi.mock('@trezor/connect-web', () => ({ default: connectWeb }));
// See trezor.datum.spec.ts: the package entry cannot load under the Node CI pins.
vi.mock('@trezor/connect', async () => ({ PROTO: (await import('@trezor/connect/lib/constants')).PROTO }));

import ledgerUtils from './ledger';
import trezor from './trezor';
import trezorWeb from './trezorWeb';

const STAKE_ADDRESS = 'stake1uy3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygsflrjnr';

const keysOnAccount = (account: number): Keys => ({
  payment: [{ address: WALLET_ADDRESS, cred: '11'.repeat(28), path: `m/1852'/1815'/${account}'/0/0` }],
  change: [],
  stake: [{ address: STAKE_ADDRESS, cred: '22'.repeat(28), path: `m/1852'/1815'/${account}'/2/0` }],
  script: [],
  ccCold: [],
  ccHot: [],
  drep105: [],
  drep129: [],
});
const UTXOS: Cardano.Utxo[] = [
  [
    { txId: Cardano.TransactionId('aa'.repeat(32)), index: 0, address: Cardano.PaymentAddress(WALLET_ADDRESS) },
    { address: Cardano.PaymentAddress(WALLET_ADDRESS), value: { coins: 10_000_000n } },
  ],
];
const MAINNET = networks.resolveNetwork(Blockchain.CARDANO, Network.MAINNET);

/**
 * `[body, {}, true, null]`: spends the wallet's input (aa…#0), returns change to it, and
 * delegates its stake key's vote to Abstain, so the device needs the stake key too.
 */
const OWN_TX = [
  '84a4',
  `00 81825820${'aa'.repeat(32)}00`, // inputs
  `01 81825839${Cardano.Address.fromBech32(WALLET_ADDRESS).toBytes()}1a004c4b40`, // outputs: change
  '02 1a00030d40', // fee
  `04 81 8309 8200581c${'22'.repeat(28)} 8102`, // certificates: vote delegation to Abstain
  'a0 f5 f6',
].join('').replace(/ /g, '');
/** The device answers with witnesses its xpub (the wallet's) verifies. */
const XPUB = bech32.encode('xpub', bech32.toWords(Buffer.from(WALLET_ACCOUNT_XPUB, 'hex')), 1023);
const OWN_TX_ID = Serialization.Transaction.fromCbor(Serialization.TxCBOR(OWN_TX)).getId();
const ownTx = () => Serialization.Transaction.fromCbor(Serialization.TxCBOR(OWN_TX)).toCore();

/** Every BIP-32 path string in a device request. */
function pathStrings(request: unknown): string[] {
  return (JSON.stringify(request).match(/m\/1852'\/1815'\/\d+'[^"]*/g) ?? []);
}

const HARDENED = 0x80000000;
/** Every numeric BIP-32 path (Ledger's form) in a device request, as m/… strings. */
function numericPaths(request: unknown): string[] {
  const found: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      if (value.length >= 3 && value.every((n) => typeof n === 'number') && value[0] === HARDENED + 1852) {
        found.push(`m/${(value as number[]).map((n) => (n >= HARDENED ? `${n - HARDENED}'` : `${n}`)).join('/')}`);
        return;
      }
      value.forEach(walk);
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(walk);
    }
  };
  walk(request);
  return found;
}

beforeAll(() => {
  // The input resolvers log each input the wallet does not own.
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
});

type SignTransaction = typeof trezor.signTransaction;
const TREZOR_SIGNERS: [string, { cardanoSignTransaction: Mock; cardanoGetPublicKey: Mock }, SignTransaction][] = [
  ['trezor (service worker)', connectWebextension, (...args) => trezor.signTransaction(...args)],
  ['trezorWeb (document)', connectWeb, (...args) => trezorWeb.cardanoSignTransaction(...args)],
];

describe.each(TREZOR_SIGNERS)('%s on account #1', (_, connect, signTransaction) => {
  let crypto: Crypto.Bip32Ed25519;
  beforeAll(async () => { crypto = await Crypto.SodiumBip32Ed25519.create(); });
  afterEach(() => { connect.cardanoGetPublicKey.mockReset(); connect.cardanoSignTransaction.mockReset(); });

  const script = Cardano.PaymentAddress(Cardano.Address.fromBytes(HexBlob(`71${'cc'.repeat(28)}`)).toBech32());
  const scriptUtxos: Cardano.Utxo[] = [[{ ...UTXOS[0][0], address: script }, { address: script, value: { coins: 10_000_000n } }]];

  it.each([0, 1])('returns a valid 1854 multisig witness for account %i and filters unrelated keys', async (account) => {
    const root = crypto.fromBip39Entropy(Buffer.alloc(32), '');
    const accountKey = crypto.derivePrivateKey(root, [HARDENED + 1854, HARDENED + 1815, HARDENED + account]);
    const witnessKey = crypto.derivePrivateKey(accountKey, [0, 0]);
    const publicKey = crypto.getRawPublicKey(crypto.getBip32PublicKey(witnessKey));
    const signature = crypto.sign(crypto.getRawPrivateKey(witnessKey), HexBlob(NO_COLLATERAL_TX_ID));
    const unrelatedKey = crypto.getRawPublicKey(crypto.getBip32PublicKey(crypto.derivePrivateKey(root, [HARDENED + 1852, HARDENED + 1815, HARDENED + account, 0, 0])));
    connect.cardanoGetPublicKey.mockResolvedValueOnce({ success: true, payload: { publicKey: crypto.getBip32PublicKey(accountKey) } });
    connect.cardanoSignTransaction.mockResolvedValueOnce({ success: true, payload: {
      hash: NO_COLLATERAL_TX_ID,
      witnesses: [{ pubKey: publicKey, signature }, { pubKey: unrelatedKey, signature }],
    } });
    const tx = Serialization.Transaction.fromCbor(Serialization.TxCBOR(NO_COLLATERAL_TX));
    const signatures = await signTransaction(tx.toCore(), keysOnAccount(account), scriptUtxos, false, MAINNET, XPUB, NO_COLLATERAL_TX);
    expect([...signatures]).toEqual([[publicKey, signature]]);
    expect(crypto.verify(signature, HexBlob(NO_COLLATERAL_TX_ID), publicKey)).toBe(true);
    expect(connect.cardanoGetPublicKey.mock.lastCall![0]).toMatchObject({ path: `m/1854'/1815'/${account}'`, showOnTrezor: false });
  });

  it.each([
    { success: false, payload: { error: 'Export declined' } },
    { success: true, payload: { publicKey: 'invalid' } },
  ])('refuses a failed or malformed multisig key export: %j', async (response) => {
    connect.cardanoGetPublicKey.mockResolvedValueOnce(response);
    connect.cardanoSignTransaction.mockResolvedValueOnce({ success: true, payload: {
      hash: NO_COLLATERAL_TX_ID, witnesses: [{ pubKey: '11'.repeat(32), signature: '22'.repeat(64) }],
    } });
    const tx = Serialization.Transaction.fromCbor(Serialization.TxCBOR(NO_COLLATERAL_TX));
    await expect(signTransaction(tx.toCore(), keysOnAccount(1), scriptUtxos, false, MAINNET, XPUB, NO_COLLATERAL_TX)).rejects.toThrow(/multisig account public key/);
  });

  async function deviceRequest(keys: Keys): Promise<Trezor.CardanoSignTransaction & { additionalWitnessRequests?: string[] }> {
    connect.cardanoSignTransaction.mockResolvedValueOnce({ success: true, payload: { hash: OWN_TX_ID, witnesses: [] } });
    await signTransaction(ownTx(), keys, UTXOS, false, MAINNET, XPUB, OWN_TX);
    return connect.cardanoSignTransaction.mock.lastCall![0];
  }

  it('asks for the input, the change output and the stake witness under account 1', async () => {
    const request = await deviceRequest(keysOnAccount(1));

    expect(request.inputs[0].path).toBe("m/1852'/1815'/1'/0/0");
    expect(request.outputs[0]).toMatchObject({
      addressParameters: { path: "m/1852'/1815'/1'/0/0", stakingPath: "m/1852'/1815'/1'/2/0" },
    });
    expect(request.certificates?.[0].path).toBe("m/1852'/1815'/1'/2/0");
    expect(request.additionalWitnessRequests).toEqual(["m/1852'/1815'/1'/2/0"]);
    expect(pathStrings(request).filter((path) => !path.startsWith("m/1852'/1815'/1'/"))).toEqual([]);
    expect(connect.cardanoGetPublicKey).not.toHaveBeenCalled();
  });

  it('keeps an account 0 wallet’s paths under account 0', async () => {
    const request = await deviceRequest(keysOnAccount(0));

    expect(request.inputs[0].path).toBe("m/1852'/1815'/0'/0/0");
    expect(pathStrings(request).filter((path) => !path.startsWith("m/1852'/1815'/0'/"))).toEqual([]);
  });

  it('refuses a key set that spans two accounts', async () => {
    const mixed = { ...keysOnAccount(1), stake: keysOnAccount(0).stake };
    await expect(signTransaction(ownTx(), mixed, UTXOS, false, MAINNET, XPUB, OWN_TX))
      .rejects.toThrow(InvalidAccountIndexError);
  });

  it.each([1, 0])('asks for the multisig witness of account %i in a multisig transaction', async (account) => {
    const tx = Serialization.Transaction.fromCbor(Serialization.TxCBOR(NO_COLLATERAL_TX));
    // The input (aa…#0) sits at the script address its output pays: the wallet owns none of it.
    const script = Cardano.PaymentAddress(Cardano.Address.fromBytes(HexBlob(`71${'cc'.repeat(28)}`)).toBech32());
    const thirdParty: Cardano.Utxo[] = [[{ ...UTXOS[0][0], address: script }, { address: script, value: { coins: 10_000_000n } }]];
    connect.cardanoSignTransaction.mockResolvedValueOnce({ success: true, payload: { hash: NO_COLLATERAL_TX_ID, witnesses: [] } });

    await signTransaction(tx.toCore(), keysOnAccount(account), thirdParty, false, MAINNET, XPUB, NO_COLLATERAL_TX);

    expect(connect.cardanoSignTransaction.mock.lastCall![0]).toMatchObject({
      additionalWitnessRequests: [`m/1854'/1815'/${account}'/0/0`],
    });
  });
});

describe('Ledger on account #1', () => {
  let bip32Ed25519: Crypto.Bip32Ed25519;
  beforeAll(async () => {
    bip32Ed25519 = await Crypto.SodiumBip32Ed25519.create();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A connected Ledger holding whatever account the agent is created for. */
  function connectedLedger() {
    vi.spyOn(ledgerUtils, 'connectViaUSB').mockResolvedValue({ decorateAppAPIMethods: vi.fn() } as unknown as Transport);
    vi.spyOn(ledgerUtils, 'ensureLedgerVersion').mockResolvedValue(undefined);
    vi.spyOn(LedgerKeyAgent, 'createDeviceConnection').mockResolvedValue({} as never);
    const createWithDevice = vi.spyOn(LedgerKeyAgent, 'createWithDevice').mockImplementation(
      async ({ chainId, accountIndex }) =>
        new LedgerKeyAgent(
          {
            accountIndex,
            chainId,
            communicationType: CommunicationType.Web,
            extendedAccountPublicKey: Crypto.Bip32PublicKeyHex(WALLET_ACCOUNT_XPUB),
            purpose: KeyPurpose.STANDARD,
          },
          { bip32Ed25519, logger: console },
        ),
    );
    const signTransaction = vi.fn(async (_request: SignTransactionRequest) => ({
      txHashHex: OWN_TX_ID,
      witnesses: [],
      auxiliaryDataSupplement: null,
    }));
    const signMessage = vi.fn(async (_request: MessageData) => ({
      signatureHex: 'ab'.repeat(64),
      signingPublicKeyHex: 'cd'.repeat(32),
      addressFieldHex: Cardano.Address.fromBech32(WALLET_ADDRESS).toBytes(),
    }));
    vi.spyOn(LedgerKeyAgent, 'checkDeviceConnection').mockResolvedValue({ signTransaction, signMessage } as never);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    return { createWithDevice, signTransaction };
  }

  it('opens the device at account 1 and asks for every key under it', async () => {
    const { createWithDevice, signTransaction } = connectedLedger();

    await ledgerUtils.txToLedger(ownTx(), keysOnAccount(1), UTXOS, true, MAINNET, OWN_TX);

    expect(createWithDevice.mock.lastCall![0]).toMatchObject({ accountIndex: 1 });
    const paths = numericPaths(signTransaction.mock.lastCall![0]);
    expect(paths).toEqual(expect.arrayContaining(["m/1852'/1815'/1'/0/0", "m/1852'/1815'/1'/2/0"]));
    expect(paths.filter((path) => !path.startsWith("m/1852'/1815'/1'/"))).toEqual([]);
  });

  it('builds known addresses on the wallet’s account', () => {
    const known = ledgerUtils.createKnownAddressesFromKeys(keysOnAccount(1), MAINNET);
    expect(known.length).toBeGreaterThan(0);
    expect(known.every((address) => address.accountIndex === 1)).toBe(true);
  });

  it('witnesses a pool owner on account 1', async () => {
    const { createWithDevice } = connectedLedger();

    await ledgerUtils.poolOwnerWitness(ownTx(), keysOnAccount(1), UTXOS, true, MAINNET).catch(() => undefined);

    expect(createWithDevice.mock.lastCall![0]).toMatchObject({ accountIndex: 1 });
  });
});

/** What a device answers for account `index`: a key and chain code, distinct per account. */
const deviceKey = (index: number) => ({ publicKeyHex: (index + 10).toString(16).padStart(2, '0').repeat(32), chainCodeHex: 'cc'.repeat(32) });

describe.each([
  ['trezor (service worker)', connectWebextension, () => trezor, 'getDeviceInfo'],
  ['trezorWeb (document)', connectWeb, () => trezorWeb, 'getFeatures'],
] as const)('%s exports several accounts', (_, connect, signer, featuresMethod) => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asks for every account in one bundled request and keys each by its path', async () => {
    vi.spyOn(signer() as unknown as Record<string, () => Promise<unknown>>, featuresMethod).mockResolvedValue({ label: 'My Trezor', model: 'T3T1' });
    connect.cardanoGetPublicKey.mockResolvedValueOnce({
      success: true,
      payload: [0, 1, 4].map((index) => ({ node: { public_key: deviceKey(index).publicKeyHex, chain_code: deviceKey(index).chainCodeHex } })),
    });

    const { productName, accounts } = await (signer() as typeof trezorWeb).getAccountXpubs([0, 1, 4]);

    expect(connect.cardanoGetPublicKey.mock.lastCall![0]).toEqual({ bundle: [
      { path: "m/1852'/1815'/0'", showOnTrezor: false },
      { path: "m/1852'/1815'/1'", showOnTrezor: false },
      { path: "m/1852'/1815'/4'", showOnTrezor: false },
    ] });
    expect(productName).toBe('My Trezor');
    expect(accounts.map((account) => [account.accountIndex, account.keys[0].publicKey]))
      .toEqual([[0, deviceKey(0).publicKeyHex], [1, deviceKey(1).publicKeyHex], [4, deviceKey(4).publicKeyHex]]);
  });

  it('refuses an answer missing an account', async () => {
    vi.spyOn(signer() as unknown as Record<string, () => Promise<unknown>>, featuresMethod).mockResolvedValue({ label: 'T', model: 'T3T1' });
    connect.cardanoGetPublicKey.mockResolvedValue({ success: true, payload: [{ node: { public_key: deviceKey(0).publicKeyHex, chain_code: deviceKey(0).chainCodeHex } }] });

    await expect((signer() as typeof trezorWeb).getAccountXpubs([0, 1])).rejects.toThrow();
  });

  it('refuses invalid indices before asking the device', async () => {
    const asked = connect.cardanoGetPublicKey.mock.calls.length;
    await expect((signer() as typeof trezorWeb).getAccountXpubs([1, 1])).rejects.toThrow(InvalidAccountIndexError);
    expect(connect.cardanoGetPublicKey.mock.calls.length).toBe(asked);
  });
});

describe('Ledger exports several accounts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asks for every account path in one request and keys each by its path', async () => {
    const transport = { decorateAppAPIMethods: vi.fn(), deviceModel: { productName: 'Nano X', bluetoothSpec: [{}] } };
    vi.spyOn(ledgerUtils, 'connectViaUSB').mockResolvedValue(transport as unknown as Transport);
    vi.spyOn(ledgerUtils, 'retrieveCardanoAppVersion').mockResolvedValue({} as never);
    const getKeys = vi.spyOn(Ada.prototype, 'getExtendedPublicKeys').mockResolvedValue([0, 2].map(deviceKey) as never);

    const { productName, btSupported, accounts } = await ledgerUtils.initLedgerAccounts(false, [0, 2]);

    const HARDENED = 0x80000000;
    expect(getKeys.mock.lastCall![0]).toEqual({ paths: [[HARDENED + 1852, HARDENED + 1815, HARDENED], [HARDENED + 1852, HARDENED + 1815, HARDENED + 2]] });
    expect({ productName, btSupported }).toEqual({ productName: 'Nano X', btSupported: true });
    expect(accounts.map((account) => [account.accountIndex, account.keys[0].path])).toEqual([[0, "m/1852'/1815'/0'"], [2, "m/1852'/1815'/2'"]]);
  });

  it('refuses invalid indices before connecting', async () => {
    const connectViaUSB = vi.spyOn(ledgerUtils, 'connectViaUSB');
    await expect(ledgerUtils.initLedgerAccounts(false, [])).rejects.toThrow(InvalidAccountIndexError);
    expect(connectViaUSB).not.toHaveBeenCalled();
  });
});
