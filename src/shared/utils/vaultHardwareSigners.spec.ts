// The hardware signers never give a vault owner's signature (vaultSignGuard.ts). Ledger, Trezor
// and Keystone each refuse, before the device is asked, a plan that needs a CIP-1854 key other
// than 0/0 (payment key 1, stake key 0), and with a known vault, a transaction that spends from
// it or withdraws or certifies under it. The 0/0 multisig key is still asked for as before, and
// a payment to the vault is still signed. The software signer is in src/chrome/vaultSign.walletBg.spec.ts.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bech32 } from 'bech32';
import { Cardano, Serialization } from '@cardano-sdk/core';
import * as Crypto from '@cardano-sdk/crypto';
import { LedgerKeyAgent } from '@cardano-sdk/hardware-ledger';
import { CommunicationType, KeyPurpose } from '@cardano-sdk/key-management';
import type { SignTransactionRequest } from '@cardano-foundation/ledgerjs-hw-app-cardano';
import { CardanoSignRequest } from '@keystonehq/bc-ur-registry-cardano';
import type Transport from '@ledgerhq/hw-transport';
import type * as Trezor from '@trezor/connect-webextension';
import { Blockchain, Keys, Network } from '@/models/types';
import { VAULT_SIGN_REFUSAL_MESSAGE } from '@/chrome/config';
import networks from '@/utils/networks';
import { NO_COLLATERAL_TX, NO_COLLATERAL_TX_ID, WALLET_ACCOUNT_XPUB, WALLET_ADDRESS } from '@/shared/utils/__fixtures__/handAssembledTxs';
import type { KnownVaultScriptHashes } from '@/shared/utils/knownVaults';

// Both Trezor modules read chrome.runtime.id as they load (TREZOR_MANIFEST).
vi.hoisted(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = { runtime: { id: 'test-extension-id' } };
});
const { connect, send, knownVaults } = vi.hoisted(() => ({
  connect: { init: vi.fn(async () => undefined), cardanoSignTransaction: vi.fn(), cardanoGetPublicKey: vi.fn() },
  // The CIP-113 preflight Ledger and Keystone ask the worker first; it allows everything here.
  send: vi.fn(async () => ({ data: { success: true, refused: false } })),
  knownVaults: vi.fn(),
}));
vi.mock('@trezor/connect-webextension', () => ({ default: connect }));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: send } }));
vi.mock('@/shared/utils/knownVaults', () => ({ knownVaultScriptHashes: knownVaults }));

import { createKeystoneSignRequest } from './keystone';
import ledgerUtils from './ledger';
import { signLedgerTransaction } from './ledgerSignTransaction';
import trezor from './trezor';
import { requestSigningPaths } from './trezorWitnesses';

const H = 0x80000000;
const MAINNET = networks.resolveNetwork(Blockchain.CARDANO, Network.MAINNET);
const TREZOR_XPUB = bech32.encode('xpub', bech32.toWords(Buffer.from(WALLET_ACCOUNT_XPUB, 'hex')), 1023);

// WALLET_ADDRESS is a base address with payment key hash 11… and stake key hash 22…. All synthetic.
const WALLET_PAYMENT = '11'.repeat(28);
const WALLET_STAKE = '22'.repeat(28);
const VAULT_PAYMENT = 'a1'.repeat(28);
const VAULT_STAKE = 'a2'.repeat(28);
const key = (hash: string) => ({ type: Cardano.CredentialType.KeyHash, hash: Crypto.Hash28ByteBase16(hash) });
const script = (hash: string) => ({ type: Cardano.CredentialType.ScriptHash, hash: Crypto.Hash28ByteBase16(hash) });
const base = (payment: Cardano.Credential, stake: Cardano.Credential) =>
  Cardano.BaseAddress.fromCredentials(Cardano.NetworkId.Mainnet, payment, stake).toAddress().toBech32() as Cardano.PaymentAddress;
const reward = (stake: Cardano.Credential) =>
  Cardano.RewardAddress.fromCredentials(Cardano.NetworkId.Mainnet, stake).toAddress().toBech32() as Cardano.RewardAccount;
const OWN_REWARD = reward(key(WALLET_STAKE));
const VAULT_ADDRESS = base(script(VAULT_PAYMENT), script(VAULT_STAKE));
const VAULT_PAYMENT_OTHER_STAKE = base(script(VAULT_PAYMENT), key('33'.repeat(28)));
const FOREIGN_ADDRESS = base(key('44'.repeat(28)), key('55'.repeat(28)));

const PAYMENT_0 = "m/1852'/1815'/0'/0/0";
const STAKE_0 = "m/1852'/1815'/0'/2/0";
const MULTISIG_0 = "m/1854'/1815'/0'/0/0";
const MULTISIG_PAYMENT_1 = "m/1854'/1815'/0'/0/1";
const MULTISIG_STAKE_0 = "m/1854'/1815'/0'/2/0";

/** The wallet's key set, with its payment and stake key at the given paths. */
const keysAt = (paymentPath = PAYMENT_0, stakePath = STAKE_0): Keys => ({
  payment: [{ address: WALLET_ADDRESS, cred: WALLET_PAYMENT, path: paymentPath }],
  change: [],
  stake: [{ address: OWN_REWARD, cred: WALLET_STAKE, path: stakePath }],
  script: [], ccCold: [], ccHot: [], drep105: [], drep129: [],
});

const txIn = (byte: string) => ({ txId: Cardano.TransactionId(byte.repeat(32)), index: 0 });
const WALLET_IN = txIn('f1');
const VAULT_IN = txIn('b1');
const FOREIGN_IN = txIn('c1');
const utxo = (input: Cardano.TxIn, address: Cardano.PaymentAddress): Cardano.Utxo =>
  [{ ...input, address }, { address, value: { coins: 5_000_000n } }];
const WALLET_UTXO = utxo(WALLET_IN, WALLET_ADDRESS);

/** A transaction spending the wallet's UTxO with change back to it, plus `body`. */
const tx = (body: Partial<Cardano.TxBody> = {}): Cardano.Tx => Serialization.Transaction.fromCore({
  id: Cardano.TransactionId('00'.repeat(32)),
  body: { inputs: [WALLET_IN], outputs: [{ address: WALLET_ADDRESS, value: { coins: 4_000_000n } }], fee: 200_000n, ...body },
  witness: { signatures: new Map() },
}).toCore();
const txId = (core: Cardano.Tx) => Serialization.Transaction.fromCore(core).body().hash();

/** Rule 1: a plan needing a CIP-1854 key other than 0/0. */
const VAULT_KEY_PLANS: [string, Keys, Cardano.Tx][] = [
  ['payment key 1, for the input it spends', keysAt(MULTISIG_PAYMENT_1), tx()],
  ['payment key 1, as a required signer', keysAt(MULTISIG_PAYMENT_1), tx({ requiredExtraSignatures: [Crypto.Ed25519KeyHashHex(WALLET_PAYMENT)] })],
  ['stake key 0, for its withdrawal', keysAt(PAYMENT_0, MULTISIG_STAKE_0), tx({ withdrawals: [{ stakeAddress: OWN_REWARD, quantity: 1_000_000n }] })],
  ['stake key 0, for its certificate', keysAt(PAYMENT_0, MULTISIG_STAKE_0), tx({
    certificates: [{ __typename: Cardano.CertificateType.StakeRegistration, stakeCredential: key(WALLET_STAKE) }],
  })],
];

/** Rule 2: a transaction that touches the known vault, with the UTxOs the signer holds. */
const VAULT_TOUCHES: [string, Cardano.Tx, Cardano.Utxo[]][] = [
  ['spends an input at the vault’s payment script', tx({ inputs: [VAULT_IN, WALLET_IN] }), [utxo(VAULT_IN, VAULT_ADDRESS), WALLET_UTXO]],
  ['spends from the vault’s payment script under another stake key', tx({ inputs: [VAULT_IN, WALLET_IN] }), [utxo(VAULT_IN, VAULT_PAYMENT_OTHER_STAKE), WALLET_UTXO]],
  ['withdraws from the vault’s stake script', tx({ withdrawals: [{ stakeAddress: reward(script(VAULT_STAKE)), quantity: 1_000_000n }] }), [WALLET_UTXO]],
  ['certifies the vault’s stake script', tx({
    certificates: [{ __typename: Cardano.CertificateType.StakeRegistration, stakeCredential: script(VAULT_STAKE) }],
  }), [WALLET_UTXO]],
];

/** Pays the vault from the wallet's own UTxO: nothing of the vault is spent. */
const PAY_TO_VAULT = tx({
  outputs: [{ address: VAULT_ADDRESS, value: { coins: 2_000_000n } }, { address: WALLET_ADDRESS, value: { coins: 2_000_000n } }],
});
/** Built by a dApp: the wallet owns no input or output, so the devices sign it in multisig mode. */
const MULTISIG_MODE_TX = tx({ inputs: [FOREIGN_IN], outputs: [{ address: FOREIGN_ADDRESS, value: { coins: 4_000_000n } }] });

const NO_VAULTS: KnownVaultScriptHashes = { payment: new Set(), stake: new Set() };
const THE_VAULT: KnownVaultScriptHashes = { payment: new Set([VAULT_PAYMENT]), stake: new Set([VAULT_STAKE]) };

beforeAll(() => {
  // The input resolvers log each input the wallet does not own.
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
beforeEach(() => {
  knownVaults.mockReset();
  knownVaults.mockResolvedValue(NO_VAULTS);
});

describe('Ledger', () => {
  let bip32Ed25519: Crypto.Bip32Ed25519;
  beforeAll(async () => { bip32Ed25519 = await Crypto.SodiumBip32Ed25519.create(); });

  let currentTxId = '';
  let connectViaUSB: ReturnType<typeof vi.fn>;
  let signTransaction: ReturnType<typeof vi.fn<(request: SignTransactionRequest) => Promise<unknown>>>;
  beforeEach(() => {
    connectViaUSB = vi.spyOn(ledgerUtils, 'connectViaUSB').mockResolvedValue({ decorateAppAPIMethods: vi.fn() } as unknown as Transport) as never;
    vi.spyOn(ledgerUtils, 'ensureLedgerVersion').mockResolvedValue(undefined);
    vi.spyOn(LedgerKeyAgent, 'createDeviceConnection').mockResolvedValue({} as never);
    vi.spyOn(LedgerKeyAgent, 'createWithDevice').mockImplementation(async ({ chainId, accountIndex }) => new LedgerKeyAgent(
      { accountIndex, chainId, communicationType: CommunicationType.Web, extendedAccountPublicKey: Crypto.Bip32PublicKeyHex(WALLET_ACCOUNT_XPUB), purpose: KeyPurpose.STANDARD },
      { bip32Ed25519, logger: console },
    ));
    signTransaction = vi.fn(async (_request: SignTransactionRequest) => ({ txHashHex: currentTxId, witnesses: [], auxiliaryDataSupplement: null }));
    vi.spyOn(LedgerKeyAgent, 'checkDeviceConnection').mockResolvedValue({ signTransaction } as never);
  });
  afterEach(() => { vi.mocked(ledgerUtils.connectViaUSB).mockRestore(); });

  const sign = (core: Cardano.Tx, keys: Keys, utxos: Cardano.Utxo[]) => {
    currentTxId = txId(core);
    return ledgerUtils.txToLedger(core, keys, utxos, true, MAINNET);
  };

  it.each(VAULT_KEY_PLANS)('refuses a plan that needs %s, and opens no device', async (_, keys, core) => {
    await expect(sign(core, keys, [WALLET_UTXO])).rejects.toThrow(VAULT_SIGN_REFUSAL_MESSAGE);
    expect(connectViaUSB).not.toHaveBeenCalled();
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it('still asks for the 0/0 multisig key of a transaction it signs in multisig mode', async () => {
    await sign(MULTISIG_MODE_TX, keysAt(), [WALLET_UTXO]);
    expect(signTransaction.mock.lastCall![0].additionalWitnessPaths).toEqual([[1854 + H, 1815 + H, H, 0, 0]]);
  });

  it.each(VAULT_TOUCHES)('with the vault known, refuses a transaction that %s', async (_, core, utxos) => {
    knownVaults.mockResolvedValue(THE_VAULT);
    await expect(sign(core, keysAt(), utxos)).rejects.toThrow(VAULT_SIGN_REFUSAL_MESSAGE);
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it('with the vault known, still signs a payment to it', async () => {
    knownVaults.mockResolvedValue(THE_VAULT);
    await sign(PAY_TO_VAULT, keysAt(), [WALLET_UTXO]);
    expect(signTransaction).toHaveBeenCalledTimes(1);
  });

  describe('a witness the device returns', () => {
    const agent = () => new LedgerKeyAgent(
      { accountIndex: 0, chainId: Cardano.ChainIds.Mainnet, communicationType: CommunicationType.Web, extendedAccountPublicKey: Crypto.Bip32PublicKeyHex(WALLET_ACCOUNT_XPUB), purpose: KeyPurpose.STANDARD },
      { bip32Ed25519, logger: console },
    );
    const body = Serialization.Transaction.fromCbor(Serialization.TxCBOR(NO_COLLATERAL_TX)).body();
    const context = { knownAddresses: [], txInKeyPathMap: {} };

    it.each([
      ['payment key 1', [1854 + H, 1815 + H, H, 0, 1]],
      ['stake key 0', [1854 + H, 1815 + H, H, 2, 0]],
    ])('is refused with the vault refusal under the wallet’s own multisig %s', async (_, path) => {
      signTransaction.mockResolvedValueOnce({ txHashHex: NO_COLLATERAL_TX_ID, witnesses: [{ path, witnessSignatureHex: 'ab'.repeat(64) }], auxiliaryDataSupplement: null });

      await expect(signLedgerTransaction(agent(), body, context)).rejects.toThrow(VAULT_SIGN_REFUSAL_MESSAGE);
    });
  });
});

describe('Trezor', () => {
  let currentTxId = '';
  beforeEach(() => {
    connect.cardanoSignTransaction.mockReset();
    connect.cardanoSignTransaction.mockImplementation(async () => ({ success: true, payload: { hash: currentTxId, witnesses: [] } }));
  });

  const sign = (core: Cardano.Tx, keys: Keys, utxos: Cardano.Utxo[]) => {
    currentTxId = txId(core);
    return trezor.signTransaction(core, keys, utxos, false, MAINNET, TREZOR_XPUB);
  };
  const deviceRequest = () => connect.cardanoSignTransaction.mock.lastCall![0] as Trezor.CardanoSignTransaction;

  it.each(VAULT_KEY_PLANS)('refuses a plan that needs %s, and asks the device nothing', async (_, keys, core) => {
    await expect(sign(core, keys, [WALLET_UTXO])).rejects.toThrow(VAULT_SIGN_REFUSAL_MESSAGE);
    expect(connect.cardanoSignTransaction).not.toHaveBeenCalled();
  });

  it('still asks for the 0/0 multisig key of a transaction it signs in multisig mode', async () => {
    await sign(MULTISIG_MODE_TX, keysAt(), [WALLET_UTXO]);
    expect(deviceRequest().additionalWitnessRequests).toEqual([MULTISIG_0]);
  });

  it.each(VAULT_TOUCHES)('with the vault known, refuses a transaction that %s', async (_, core, utxos) => {
    knownVaults.mockResolvedValue(THE_VAULT);
    await expect(sign(core, keysAt(), utxos)).rejects.toThrow(VAULT_SIGN_REFUSAL_MESSAGE);
    expect(connect.cardanoSignTransaction).not.toHaveBeenCalled();
  });

  it('with the vault known, still signs a payment to it', async () => {
    knownVaults.mockResolvedValue(THE_VAULT);
    await sign(PAY_TO_VAULT, keysAt(), [WALLET_UTXO]);
    expect(connect.cardanoSignTransaction).toHaveBeenCalledTimes(1);
  });

  it('reads every path a request has the device sign with', () => {
    const request = {
      inputs: [{ path: PAYMENT_0, prev_hash: 'aa', prev_index: 0 }, { prev_hash: 'bb', prev_index: 0 }],
      collateralInputs: [{ path: "m/1852'/1815'/0'/1/0", prev_hash: 'cc', prev_index: 0 }],
      withdrawals: [{ amount: '1', path: STAKE_0 }],
      requiredSigners: [{ keyPath: "m/1852'/1815'/0'/3/0" }, { keyHash: 'dd' }],
      certificates: [{ type: 0, path: MULTISIG_STAKE_0 }],
      additionalWitnessRequests: [MULTISIG_0],
    } as unknown as Parameters<typeof requestSigningPaths>[0];

    expect(requestSigningPaths(request).filter(Boolean)).toEqual([
      PAYMENT_0, "m/1852'/1815'/0'/1/0", STAKE_0, "m/1852'/1815'/0'/3/0", MULTISIG_STAKE_0, MULTISIG_0,
    ]);
  });
});

describe('Keystone', () => {
  const wallet = { xfp: '12345678' };
  const sign = (core: Cardano.Tx, keys: Keys, utxos: Cardano.Utxo[]) =>
    createKeystoneSignRequest(Serialization.Transaction.fromCore(core), wallet, utxos, keys);

  it.each(VAULT_KEY_PLANS)('refuses a plan that needs %s, and builds no QR', async (_, keys, core) => {
    await expect(sign(core, keys, [WALLET_UTXO])).rejects.toThrow(VAULT_SIGN_REFUSAL_MESSAGE);
  });

  it('still lists a 0/0 multisig key the key set carries, as before', async () => {
    const response = await sign(tx({ requiredExtraSignatures: [Crypto.Ed25519KeyHashHex(WALLET_PAYMENT)] }), keysAt(MULTISIG_0), [WALLET_UTXO]);
    expect(response.useHash).toBe(false);
    const signers = CardanoSignRequest.fromCBOR(response.ur.cbor).getAdditionalSigners().map((signer) => `m/${signer.getKeyPath()}`);
    expect(signers).toEqual([MULTISIG_0]);
  });

  it.each(VAULT_TOUCHES)('with the vault known, refuses a transaction that %s', async (_, core, utxos) => {
    knownVaults.mockResolvedValue(THE_VAULT);
    await expect(sign(core, keysAt(), utxos)).rejects.toThrow(VAULT_SIGN_REFUSAL_MESSAGE);
  });

  it('with the vault known, still signs a payment to it', async () => {
    knownVaults.mockResolvedValue(THE_VAULT);
    await expect(sign(PAY_TO_VAULT, keysAt(), [WALLET_UTXO])).resolves.toMatchObject({ useHash: false });
  });
});
