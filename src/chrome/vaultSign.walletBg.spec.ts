// WalletBg.signTx, the software signer behind every dApp approval, never gives a vault owner's
// signature (vaultSignGuard.ts): a plan needing a CIP-1854 key other than 0/0 is refused, and with
// a known vault, so is a transaction that spends from it or withdraws or certifies under it, all
// before the root key is opened. A payment to the vault, and every other signature, is unchanged.
// Drives a real WalletBg (real Dexie via fake-indexeddb, real key derivation) with the public
// "abandon … art" test phrase.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bech32 } from 'bech32';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Ed25519KeyHashHex, Hash28ByteBase16, type Bip32PrivateKey } from '@cardano-sdk/crypto';

vi.mock('@/chrome/storeMessagingBg', () => ({ default: { broadcastUpdate: vi.fn() } }));
vi.mock('@/services/storeMessaging.service', () => ({ default: { subscribe: vi.fn() } }));
vi.mock('@/stores/priceStore', () => ({ default: { initialize: vi.fn(), disconnect: vi.fn() } }));
const { knownVaults } = vi.hoisted(() => ({ knownVaults: vi.fn() }));
vi.mock('@/shared/utils/knownVaults', () => ({ knownVaultScriptHashes: knownVaults }));

import { WalletBg } from './walletBg';
import WalletStore from '@/stores/walletStore';
import { getPaymentKeyExternal, getStakeKey } from './serialization';
import { resolvePrivateKey } from '@/shared/utils/resolver';
import { VAULT_SIGN_REFUSAL_MESSAGE } from '@/chrome/config';
import { Blockchain, CoinTypes, HARDENED, Network, WalletType, WalletTypePurpose, type Keys } from '@/models/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal stand-in for the chrome namespace
(globalThis as any).chrome = {
  alarms: {
    getAll: (cb: (alarms: unknown[]) => void) => cb([]),
    clear: vi.fn(),
    create: vi.fn(),
    onAlarm: { addListener: vi.fn(), removeListener: vi.fn(), hasListener: () => false },
  },
  storage: { local: { set: vi.fn(), get: vi.fn() } },
  runtime: {},
};

const rootKey: Bip32PrivateKey = resolvePrivateKey(`${'abandon '.repeat(23)}art`);
const rootKeyBytes = Buffer.from(rootKey.bytes());
const XPUB = bech32.encode(
  'xpub',
  bech32.toWords(Buffer.from(rootKey.derive([WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED]).toPublic().hex(), 'hex')),
  1023,
);

// Synthetic vault hashes, never a real vault's.
const VAULT_PAYMENT = 'a1'.repeat(28);
const VAULT_STAKE = 'a2'.repeat(28);
const script = (hash: string) => ({ type: Cardano.CredentialType.ScriptHash, hash: Hash28ByteBase16(hash) });
const keyCred = (hash: string) => ({ type: Cardano.CredentialType.KeyHash, hash: Hash28ByteBase16(hash) });
const VAULT_ADDRESS = Cardano.BaseAddress.fromCredentials(Cardano.NetworkId.Testnet, script(VAULT_PAYMENT), script(VAULT_STAKE))
  .toAddress().toBech32() as Cardano.PaymentAddress;
const VAULT_PAYMENT_OTHER_STAKE = Cardano.BaseAddress.fromCredentials(Cardano.NetworkId.Testnet, script(VAULT_PAYMENT), keyCred('33'.repeat(28)))
  .toAddress().toBech32() as Cardano.PaymentAddress;
const VAULT_REWARD = Cardano.RewardAddress.fromCredentials(Cardano.NetworkId.Testnet, script(VAULT_STAKE))
  .toAddress().toBech32() as Cardano.RewardAccount;
const NO_VAULTS = { payment: new Set<string>(), stake: new Set<string>() };
const THE_VAULT = { payment: new Set([VAULT_PAYMENT]), stake: new Set([VAULT_STAKE]) };

const WALLET_TX = 'f1'.repeat(32);
const VAULT_TX = 'b1'.repeat(32);

let walletSeq = 0;
function bootWallet(): WalletBg {
  walletSeq += 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture stands in for the persisted Wallet record
  return new WalletBg({ id: 960_000 + walletSeq, name: `vault-${walletSeq}`, chain: Blockchain.CARDANO, network: Network.PREPROD, type: WalletType.Normal, publicKey: XPUB } as any);
}

/** The wallet's keys and UTxO, and a transaction spending it with `body` on top. */
function walletTx(bg: WalletBg, body: Partial<Cardano.TxBody> = {}, extraUtxos: Cardano.Utxo[] = []) {
  const keys = bg.resolvePathsForMissingAddresses([]);
  const own = keys.payment[0].address as Cardano.PaymentAddress;
  const tx = Serialization.Transaction.fromCore({
    id: Cardano.TransactionId('00'.repeat(32)),
    body: {
      inputs: [{ txId: Cardano.TransactionId(WALLET_TX), index: 0 }],
      outputs: [{ address: own, value: { coins: 3_000_000n } }],
      fee: 200_000n,
      ...body,
    },
    witness: { signatures: new Map() },
  });
  const utxos: Cardano.Utxo[] = [
    [{ txId: Cardano.TransactionId(WALLET_TX), index: 0, address: own }, { address: own, value: { coins: 5_000_000n } }],
    ...extraUtxos,
  ];
  return { txCbor: tx.toCbor(), utxos, keys };
}

const withPath = (keys: Keys, role: 'payment' | 'stake', path: string): Keys => ({
  ...keys,
  [role]: keys[role].map((key, index) => (index === 0 ? { ...key, path } : key)),
});

function signingKeys(witnesses: string): string[] {
  const vkeys = Serialization.TransactionWitnessSet.fromCbor(Serialization.TxCBOR(witnesses)).vkeys()?.values() ?? [];
  return vkeys.map((witness) => witness.vkey()).sort();
}

const vaultUtxo = (address: Cardano.PaymentAddress): Cardano.Utxo =>
  [{ txId: Cardano.TransactionId(VAULT_TX), index: 0, address }, { address, value: { coins: 10_000_000n } }];
const VAULT_INPUT = { txId: Cardano.TransactionId(VAULT_TX), index: 0 };

describe('WalletBg.signTx never signs with a vault key', () => {
  beforeEach(() => {
    WalletStore.clearForWalletSwitch();
    knownVaults.mockReset();
    knownVaults.mockResolvedValue(NO_VAULTS);
  });

  it('refuses a plan that needs multisig payment key 1, before the root key is opened', async () => {
    const bg = bootWallet();
    const { txCbor, utxos, keys } = walletTx(bg);
    const decrypt = vi.spyOn(bg as unknown as { decryptRootPrivateKey: () => Promise<unknown> }, 'decryptRootPrivateKey');

    await expect(bg.signTx(txCbor, 'synthetic-password', utxos, withPath(keys, 'payment', "m/1854'/1815'/0'/0/1")))
      .rejects.toThrow(VAULT_SIGN_REFUSAL_MESSAGE);
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('refuses a plan that needs the multisig stake key 0, for a required signer', async () => {
    const bg = bootWallet();
    const stakeHash = getStakeKey(XPUB, 0).hash().hex();
    const { txCbor, utxos, keys } = walletTx(bg, { requiredExtraSignatures: [Ed25519KeyHashHex(stakeHash)] });

    await expect(bg.signTx(txCbor, '', utxos, withPath(keys, 'stake', "m/1854'/1815'/0'/2/0"), rootKeyBytes))
      .rejects.toThrow(VAULT_SIGN_REFUSAL_MESSAGE);
  });

  it('signs as before when the plan names the 0/0 multisig key', async () => {
    const bg = bootWallet();
    const { txCbor, utxos, keys } = walletTx(bg);

    const before = await bg.signTx(txCbor, '', utxos, keys, rootKeyBytes);
    const multisig00 = await bg.signTx(txCbor, '', utxos, withPath(keys, 'payment', "m/1854'/1815'/0'/0/0"), rootKeyBytes);

    expect(signingKeys(multisig00.witnesses)).toEqual(signingKeys(before.witnesses));
  });

  it('signs the wallet’s own transaction as before while no vault is known', async () => {
    const bg = bootWallet();
    const { txCbor, utxos, keys } = walletTx(bg, { inputs: [VAULT_INPUT, { txId: Cardano.TransactionId(WALLET_TX), index: 0 }] }, [vaultUtxo(VAULT_ADDRESS)]);

    const { witnesses } = await bg.signTx(txCbor, '', utxos, keys, rootKeyBytes);
    expect(signingKeys(witnesses)).toEqual([getPaymentKeyExternal(XPUB, 0).hex()]);
  });
});

describe('WalletBg.signTx with a known vault', () => {
  beforeEach(() => {
    WalletStore.clearForWalletSwitch();
    knownVaults.mockReset();
    knownVaults.mockResolvedValue(THE_VAULT);
  });
  const walletInput = { txId: Cardano.TransactionId(WALLET_TX), index: 0 };

  it.each([
    ['spends an input at the vault’s payment script', { inputs: [VAULT_INPUT, walletInput] }, [vaultUtxo(VAULT_ADDRESS)]],
    ['spends from the vault’s payment script under another stake key', { inputs: [VAULT_INPUT, walletInput] }, [vaultUtxo(VAULT_PAYMENT_OTHER_STAKE)]],
    ['withdraws from the vault’s stake script', { withdrawals: [{ stakeAddress: VAULT_REWARD, quantity: 1_000_000n }] }, []],
    ['certifies the vault’s stake script', {
      certificates: [{ __typename: Cardano.CertificateType.StakeRegistration, stakeCredential: script(VAULT_STAKE) }],
    }, []],
  ] as [string, Partial<Cardano.TxBody>, Cardano.Utxo[]][])('refuses a transaction that %s, before the root key is opened', async (_, body, extra) => {
    const bg = bootWallet();
    const { txCbor, utxos, keys } = walletTx(bg, body, extra);
    const decrypt = vi.spyOn(bg as unknown as { decryptRootPrivateKey: () => Promise<unknown> }, 'decryptRootPrivateKey');

    await expect(bg.signTx(txCbor, 'synthetic-password', utxos, keys)).rejects.toThrow(VAULT_SIGN_REFUSAL_MESSAGE);
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('signs a payment to the vault: nothing of it is spent', async () => {
    const bg = bootWallet();
    const change = bg.resolvePathsForMissingAddresses([]).payment[0].address as Cardano.PaymentAddress;
    const { txCbor, utxos, keys } = walletTx(bg, {
      outputs: [{ address: VAULT_ADDRESS, value: { coins: 2_000_000n } }, { address: change, value: { coins: 2_000_000n } }],
    });

    const { witnesses } = await bg.signTx(txCbor, '', utxos, keys, rootKeyBytes);
    expect(signingKeys(witnesses)).toEqual([getPaymentKeyExternal(XPUB, 0).hex()]);
  });
});
