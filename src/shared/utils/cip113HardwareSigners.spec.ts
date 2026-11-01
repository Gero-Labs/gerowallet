// The hardware signers on a CIP-113 transfer (T3: the test wallet sends 1 MickyUSD; its stake key
// owns the tokens and is the one required signer; three zero withdrawals of scripts). Each asks
// the worker before the device sees anything, and asks the device for the owner's key only: no
// stake witness for the script withdrawals, no key for a required signer that is not the wallet's.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { bech32 } from 'bech32';
import { Cardano, Serialization } from '@cardano-sdk/core';
import * as Crypto from '@cardano-sdk/crypto';
import { LedgerKeyAgent } from '@cardano-sdk/hardware-ledger';
import { CommunicationType, KeyPurpose } from '@cardano-sdk/key-management';
import {
  CredentialParamsType,
  TransactionSigningMode,
  TxRequiredSignerType,
  type SignTransactionRequest,
} from '@cardano-foundation/ledgerjs-hw-app-cardano';
import { CardanoSignRequest, CardanoSignTxHashRequest, CryptoKeypath } from '@keystonehq/bc-ur-registry-cardano';
import type Transport from '@ledgerhq/hw-transport';
import type * as Trezor from '@trezor/connect';
import { Blockchain, Keys, Network } from '@/models/types';
import { MessageTypes } from '@/models/MessageTypes';
import { CIP113_SIGN_REFUSAL_MESSAGE, MARKED_TO_FAIL_SIGN_REFUSAL_MESSAGE } from '@/chrome/config';
import networks from '@/utils/networks';
import {
  FEE_INPUT,
  T3_TX_ID,
  T3_UNSIGNED_TX,
  TEST_WALLET_BASE_ADDRESS,
  TEST_WALLET_PAYMENT_KEY_HASH,
  TEST_WALLET_STAKE_KEY_HASH,
  TEST_WALLET_XPUB,
} from '@/chrome/__fixtures__/cip113Preprod';

// Both Trezor modules read chrome.runtime.id as they load (TREZOR_MANIFEST).
vi.hoisted(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = { runtime: { id: 'test-extension-id' } };
});
const { connectWebextension, connectWeb, send } = vi.hoisted(() => {
  const connect = () => ({ init: vi.fn(async () => undefined), cardanoSignTransaction: vi.fn(), cardanoGetPublicKey: vi.fn() });
  return { connectWebextension: connect(), connectWeb: connect(), send: vi.fn() };
});
vi.mock('@trezor/connect-webextension', () => ({ default: connectWebextension }));
vi.mock('@trezor/connect-web', () => ({ default: connectWeb }));
// See trezor.datum.spec.ts: the package entry cannot load under the Node CI pins.
vi.mock('@trezor/connect', async () => ({ PROTO: (await import('@trezor/connect/lib/constants')).PROTO }));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: send } }));

import { assertCip113SignAllowed } from './cip113SignPreflight';
import { createKeystoneSignRequest } from './keystone';
import ledgerUtils from './ledger';
import trezor from './trezor';
import trezorWeb from './trezorWeb';

const PAYMENT_PATH = "m/1852'/1815'/0'/0/0";
const STAKE_PATH = "m/1852'/1815'/0'/2/0";
const STAKE_ADDRESS = Cardano.RewardAddress.fromCredentials(Cardano.NetworkId.Testnet, {
  type: Cardano.CredentialType.KeyHash,
  hash: Crypto.Hash28ByteBase16(TEST_WALLET_STAKE_KEY_HASH),
}).toAddress().toBech32();
const KEYS: Keys = {
  payment: [{ address: TEST_WALLET_BASE_ADDRESS, cred: TEST_WALLET_PAYMENT_KEY_HASH, path: PAYMENT_PATH }],
  change: [],
  stake: [{ address: STAKE_ADDRESS, cred: TEST_WALLET_STAKE_KEY_HASH, path: STAKE_PATH }],
  script: [],
  ccCold: [],
  ccHot: [],
  drep105: [],
  drep129: [],
};
/** What the wallet can spend: the fee input. The programmable input is never in this list. */
const UTXOS: Cardano.Utxo[] = [[
  { txId: Cardano.TransactionId(FEE_INPUT.txId), index: FEE_INPUT.index, address: Cardano.PaymentAddress(TEST_WALLET_BASE_ADDRESS) },
  { address: Cardano.PaymentAddress(TEST_WALLET_BASE_ADDRESS), value: { coins: FEE_INPUT.coins } },
]];
const PREPROD = networks.resolveNetwork(Blockchain.CARDANO, Network.PREPROD);
const XPUB_HEX = Buffer.from(bech32.fromWords(bech32.decode(TEST_WALLET_XPUB, 1023).words)).toString('hex');
const XFP = '12345678';

/** T3 with its one required signer (key 14, a tagged set) swapped for `keyHash`: a transfer another key owns. */
function t3OwnedBy(keyHash: string): string {
  const signers = (hash: string) => `0ed9010281581c${hash}`;
  expect(T3_UNSIGNED_TX.split(signers(TEST_WALLET_STAKE_KEY_HASH))).toHaveLength(2);
  return T3_UNSIGNED_TX.replace(signers(TEST_WALLET_STAKE_KEY_HASH), signers(keyHash));
}
const fromCbor = (cbor: string) => Serialization.Transaction.fromCbor(Serialization.TxCBOR(cbor));

const answers = (data: unknown) => send.mockResolvedValue({ data });
const askedAbout = () => send.mock.calls.map(([message]) => message);

beforeAll(() => {
  // The input resolvers log each input the wallet does not own.
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
});
beforeEach(() => {
  send.mockReset();
  answers({ success: true, refused: false });
});

describe('the worker preflight', () => {
  it('asks about these exact bytes and lets an unrefused transaction through', async () => {
    await assertCip113SignAllowed('84a0', 'no answer');
    expect(askedAbout()).toEqual([{ method: MessageTypes.CIP113_SIGN_PREFLIGHT, data: { txCbor: '84a0' } }]);
  });

  it('refuses what the worker refuses', async () => {
    answers({ success: true, refused: true });
    await expect(assertCip113SignAllowed('84a0', 'no answer')).rejects.toThrow(CIP113_SIGN_REFUSAL_MESSAGE);
  });

  it('refuses with the reason the worker names: a transaction marked to fail', async () => {
    answers({ success: true, refused: true, message: MARKED_TO_FAIL_SIGN_REFUSAL_MESSAGE });
    await expect(assertCip113SignAllowed('84a0', 'no answer')).rejects.toThrow(MARKED_TO_FAIL_SIGN_REFUSAL_MESSAGE);
  });

  it('shows no text from the worker that it does not know', async () => {
    answers({ success: true, refused: true, message: 'anything else' });
    await expect(assertCip113SignAllowed('84a0', 'no answer')).rejects.toThrow(CIP113_SIGN_REFUSAL_MESSAGE);
  });

  it.each([undefined, null, {}, { success: false }, { refused: false }])('signs nothing without an answer: %j', async (data) => {
    send.mockResolvedValue(data === undefined ? undefined : { data });
    await expect(assertCip113SignAllowed('84a0', 'no answer')).rejects.toThrow('no answer');
  });

  it('signs nothing when the worker cannot be reached', async () => {
    send.mockRejectedValue(new Error('Could not establish connection'));
    await expect(assertCip113SignAllowed('84a0', 'no answer')).rejects.toThrow('Could not establish connection');
  });
});

describe('Ledger', () => {
  let bip32Ed25519: Crypto.Bip32Ed25519;
  beforeAll(async () => { bip32Ed25519 = await Crypto.SodiumBip32Ed25519.create(); });
  afterEach(() => { vi.restoreAllMocks(); });

  /** A connected Ledger holding the test wallet's account; it answers with T3's id. */
  function connectedLedger() {
    const connectViaUSB = vi.spyOn(ledgerUtils, 'connectViaUSB').mockResolvedValue({ decorateAppAPIMethods: vi.fn() } as unknown as Transport);
    vi.spyOn(ledgerUtils, 'ensureLedgerVersion').mockResolvedValue(undefined);
    vi.spyOn(LedgerKeyAgent, 'createDeviceConnection').mockResolvedValue({} as never);
    vi.spyOn(LedgerKeyAgent, 'createWithDevice').mockImplementation(async ({ chainId, accountIndex }) => new LedgerKeyAgent(
      { accountIndex, chainId, communicationType: CommunicationType.Web, extendedAccountPublicKey: Crypto.Bip32PublicKeyHex(XPUB_HEX), purpose: KeyPurpose.STANDARD },
      { bip32Ed25519, logger: console },
    ));
    const signTransaction = vi.fn(async (_request: SignTransactionRequest) => ({ txHashHex: T3_TX_ID, witnesses: [], auxiliaryDataSupplement: null }));
    vi.spyOn(LedgerKeyAgent, 'checkDeviceConnection').mockResolvedValue({ signTransaction } as never);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    return { connectViaUSB, signTransaction };
  }

  it('asks the worker about T3, then signs it as a Plutus transaction with the owner’s stake key', async () => {
    const { signTransaction } = connectedLedger();

    await ledgerUtils.txToLedger(fromCbor(T3_UNSIGNED_TX).toCore(), KEYS, UTXOS, true, PREPROD, T3_UNSIGNED_TX);

    expect(askedAbout()).toEqual([{ method: MessageTypes.CIP113_SIGN_PREFLIGHT, data: { txCbor: T3_UNSIGNED_TX } }]);
    const request = signTransaction.mock.lastCall![0];
    expect(request.signingMode).toBe(TransactionSigningMode.PLUTUS_TRANSACTION);
    expect(request.tx.requiredSigners).toEqual([{ type: TxRequiredSignerType.PATH, path: hdPath(STAKE_PATH) }]);
    expect(request.tx.withdrawals?.map((withdrawal) => withdrawal.stakeCredential.type))
      .toEqual(Array(3).fill(CredentialParamsType.SCRIPT_HASH));
  });

  it('opens no device for a transfer the worker refuses', async () => {
    const { connectViaUSB, signTransaction } = connectedLedger();
    answers({ success: true, refused: true });

    await expect(ledgerUtils.txToLedger(fromCbor(T3_UNSIGNED_TX).toCore(), KEYS, UTXOS, true, PREPROD, T3_UNSIGNED_TX))
      .rejects.toThrow(CIP113_SIGN_REFUSAL_MESSAGE);
    expect(connectViaUSB).not.toHaveBeenCalled();
    expect(signTransaction).not.toHaveBeenCalled();
  });
});

const TREZOR_SIGNERS: [string, { cardanoSignTransaction: Mock }, typeof trezor.signTransaction][] = [
  ['trezor (service worker)', connectWebextension, (...args) => trezor.signTransaction(...args)],
  ['trezorWeb (document)', connectWeb, (...args) => trezorWeb.cardanoSignTransaction(...args)],
];

describe.each(TREZOR_SIGNERS)('%s', (_, connect, signTransaction) => {
  afterEach(() => { connect.cardanoSignTransaction.mockReset(); });

  async function deviceRequest(txCbor: string): Promise<Trezor.CardanoSignTransaction & { additionalWitnessRequests?: string[] }> {
    connect.cardanoSignTransaction.mockResolvedValueOnce({ success: true, payload: { hash: fromCbor(txCbor).getId(), witnesses: [] } });
    await signTransaction(fromCbor(txCbor).toCore(), KEYS, UTXOS, false, PREPROD, TEST_WALLET_XPUB, txCbor);
    return connect.cardanoSignTransaction.mock.lastCall![0];
  }

  it('asks for the owner’s stake key as T3’s required signer, and no stake witness for its script withdrawals', async () => {
    const request = await deviceRequest(T3_UNSIGNED_TX);

    expect(request.signingMode).toBe(3); // PLUTUS_TRANSACTION
    expect(request.requiredSigners).toEqual([{ keyHash: undefined, keyPath: STAKE_PATH }]);
    expect(request.withdrawals?.every((withdrawal) => withdrawal.scriptHash && !withdrawal.path)).toBe(true);
    expect(request.additionalWitnessRequests).toBeUndefined();
  });

  it('asks for the payment key, and never the stake key, for a transfer that key owns', async () => {
    const request = await deviceRequest(t3OwnedBy(TEST_WALLET_PAYMENT_KEY_HASH));

    expect(request.requiredSigners).toEqual([{ keyHash: undefined, keyPath: PAYMENT_PATH }]);
    expect(request.withdrawals?.some((withdrawal) => withdrawal.path)).toBe(false);
    expect(request.additionalWitnessRequests).toBeUndefined();
  });
});

describe('Keystone', () => {
  const wallet = { xfp: XFP, stakeAddress: STAKE_ADDRESS };

  /** Paths and addresses of a hash-mode request (a transaction of 2,048 bytes or more, as T3 is). */
  async function hashRequest(txCbor: string) {
    const response = await createKeystoneSignRequest(fromCbor(txCbor), wallet, UTXOS, KEYS);
    expect(response.useHash).toBe(true);
    // fromCBOR leaves the paths as raw data items.
    const request = CardanoSignTxHashRequest.fromCBOR(response.ur.cbor);
    return { txHash: request.getTxHash(), paths: request.getPaths().map((path) => `m/${CryptoKeypath.fromDataItem(path as never).getPath()}`), addresses: request.getAddressList() };
  }

  /** `[keyHash, path]` for each extra signer of a full-CBOR request. */
  async function extraSigners(txCbor: string): Promise<[string, string][]> {
    const response = await createKeystoneSignRequest(fromCbor(txCbor), wallet, UTXOS, KEYS);
    expect(response.useHash).toBe(false);
    return CardanoSignRequest.fromCBOR(response.ur.cbor).getAdditionalSigners()
      .map((signer) => [signer.getKeyHash().toString('hex'), `m/${signer.getKeyPath()}`]);
  }

  it('asks the worker about T3, then signs its hash with the fee input’s key and the owner’s stake key', async () => {
    const request = await hashRequest(T3_UNSIGNED_TX);

    expect(askedAbout()).toEqual([{ method: MessageTypes.CIP113_SIGN_PREFLIGHT, data: { txCbor: T3_UNSIGNED_TX } }]);
    expect(request).toEqual({ txHash: T3_TX_ID, paths: [PAYMENT_PATH, STAKE_PATH], addresses: [TEST_WALLET_BASE_ADDRESS, STAKE_ADDRESS] });
  });

  it('signs a payment-key owner’s transfer with that key only: the script withdrawals need no stake key', async () => {
    const request = await hashRequest(t3OwnedBy(TEST_WALLET_PAYMENT_KEY_HASH));

    expect(request.paths).toEqual([PAYMENT_PATH]);
  });

  it('builds no request for a transfer the worker refuses', async () => {
    answers({ success: true, refused: true });
    await expect(createKeystoneSignRequest(fromCbor(T3_UNSIGNED_TX), wallet, UTXOS, KEYS)).rejects.toThrow(CIP113_SIGN_REFUSAL_MESSAGE);
  });

  /**
   * A small transaction (full-CBOR mode) spending the fee input, with `extra` body entries.
   * Required signers are key 14, withdrawals 5, certificates 4.
   */
  const smallTx = (extra: Record<string, string>) => {
    const entries = {
      '00': `81825820${FEE_INPUT.txId}00`,
      '01': `81825839${Cardano.Address.fromBech32(TEST_WALLET_BASE_ADDRESS).toBytes()}1a004c4b40`,
      '02': '1a00030d40',
      ...extra,
    };
    return `84a${Object.keys(entries).length}${Object.entries(entries).map(([key, value]) => key + value).join('')}a0f5f6`;
  };
  const FOREIGN_KEY = '33'.repeat(28);
  const SCRIPT = 'cc'.repeat(28);

  it('maps each required signer to the wallet key with that hash, and skips another party’s', async () => {
    const signers = await extraSigners(smallTx({
      '0e': `83581c${TEST_WALLET_STAKE_KEY_HASH}581c${FOREIGN_KEY}581c${TEST_WALLET_PAYMENT_KEY_HASH}`,
    }));

    expect(signers).toEqual([[TEST_WALLET_STAKE_KEY_HASH, STAKE_PATH], [TEST_WALLET_PAYMENT_KEY_HASH, PAYMENT_PATH]]);
  });

  it('asks for the stake key once for the wallet’s own reward withdrawal, and not for a script’s', async () => {
    const signers = await extraSigners(smallTx({
      '05': `a2581df0${SCRIPT}00581de0${TEST_WALLET_STAKE_KEY_HASH}00`,
      '0e': `81581c${TEST_WALLET_STAKE_KEY_HASH}`,
    }));

    expect(signers).toEqual([[TEST_WALLET_STAKE_KEY_HASH, STAKE_PATH]]);
  });

  it('asks for no key for a script withdrawal alone', async () => {
    expect(await extraSigners(smallTx({ '05': `a1581df0${SCRIPT}00` }))).toEqual([]);
  });

  it('asks for the stake key for the wallet’s own certificate, and not for another stake credential’s', async () => {
    const delegateVote = (stakeKeyHash: string) => `8309 8200581c${stakeKeyHash} 8102`.replace(/ /g, '');

    expect(await extraSigners(smallTx({ '04': `81${delegateVote(TEST_WALLET_STAKE_KEY_HASH)}` })))
      .toEqual([[TEST_WALLET_STAKE_KEY_HASH, STAKE_PATH]]);
    expect(await extraSigners(smallTx({ '04': `81${delegateVote(FOREIGN_KEY)}` }))).toEqual([]);
  });
});

const HARDENED = 0x80000000;
/** `m/1852'/…` as the numeric path Ledger is sent. */
function hdPath(path: string): number[] {
  return path.slice(2).split('/').map((part) => (part.endsWith("'") ? Number(part.slice(0, -1)) + HARDENED : Number(part)));
}
