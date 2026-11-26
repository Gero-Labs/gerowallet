// The dApp signing path against the real vault store: nothing mocks knownVaults.ts here. A vault the
// wallet stores (vaultStore.ts, fake-indexeddb) is seen by WalletBg.signTx, which then refuses a
// transaction that withdraws from it, and refuses the 0/0 multisig key once the wallet holds a vault
// at its own index 0. Drives a real WalletBg with the public "abandon ... art" test phrase.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bech32 } from 'bech32';
import { Cardano, Serialization } from '@cardano-sdk/core';
import type { Bip32PrivateKey } from '@cardano-sdk/crypto';

vi.mock('@/chrome/storeMessagingBg', () => ({ default: { broadcastUpdate: vi.fn() } }));
vi.mock('@/services/storeMessaging.service', () => ({ default: { subscribe: vi.fn() } }));
vi.mock('@/stores/priceStore', () => ({ default: { initialize: vi.fn(), disconnect: vi.fn() } }));

import { WalletBg } from './walletBg';
import WalletStore from '@/stores/walletStore';
import { resolvePrivateKey } from '@/shared/utils/resolver';
import { VAULT_SIGN_REFUSAL_MESSAGE } from '@/chrome/config';
import { Blockchain, CoinTypes, HARDENED, Network, WalletType, WalletTypePurpose, type Keys } from '@/models/types';
import { geroDBSchema, geroDBVersion, geroWalletDbName } from '@/db/schema';
import { clearDbCache } from '@/db/wallet-db';
import { vaultStore } from '@/db/vaultStore';
import {
  buildVaultFromParticipants,
  deriveRoleKeys,
  deriveVaultPublicKeys,
  multisigAccountPublicKey,
  vaultAddresses,
  vaultId,
  type VaultParticipant,
  type VaultPublicKeys,
  type VaultScripts,
} from '@/shared/gerovault';
import { testParticipants, type TestParticipant } from '@/shared/gerovault/__fixtures__/manifest';

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
const WALLET_TX = 'f1'.repeat(32);

let cosigners: TestParticipant[];
let ownAtZero: VaultPublicKeys;
let ownRoleKeys: Awaited<ReturnType<typeof deriveRoleKeys>>;

beforeAll(async () => {
  cosigners = (await testParticipants()).slice(1, 3);
  // This wallet's own CIP-1854 account key, and its vault keys at index 0.
  const account = multisigAccountPublicKey(rootKey.derive([HARDENED + 1854, HARDENED + 1815, HARDENED]).toPublic().hex());
  ownRoleKeys = await deriveRoleKeys(account);
  ownAtZero = await deriveVaultPublicKeys(ownRoleKeys, 0);
});

let walletSeq = 0;
const walletIds: number[] = [];
async function bootWallet(): Promise<WalletBg> {
  walletSeq += 1;
  const id = 970_000 + walletSeq;
  walletIds.push(id);
  // The wallet list the vault provider reads wallet ids from.
  const list = new Dexie(geroWalletDbName);
  list.version(geroDBVersion).stores(geroDBSchema);
  await list.open();
  await list.table('wallets').put({ id, name: `vault-store-${walletSeq}`, chain: Blockchain.CARDANO, network: Network.PREPROD });
  list.close();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture stands in for the persisted Wallet record
  return new WalletBg({ id, name: `vault-store-${walletSeq}`, chain: Blockchain.CARDANO, network: Network.PREPROD, type: WalletType.Normal, publicKey: XPUB } as any);
}

afterEach(async () => {
  for (const id of walletIds.splice(0)) {
    clearDbCache(id);
    await Dexie.delete(`wallet-${id}`);
  }
  await Dexie.delete(geroWalletDbName);
});

/** A 2 of 3 vault: this wallet and two test cosigners. */
const buildVault = (self: VaultParticipant): Promise<VaultScripts> => buildVaultFromParticipants({
  template: { kind: 'standard', threshold: 2 },
  owners: [self, ...cosigners.map(p => ({ vaultKeys: p.vaultKeys }))],
});

/** Stores the vault for the wallet, this wallet at `ownIndex`. */
async function storeVault(walletId: number, vault: VaultScripts, selfKeys: VaultPublicKeys, ownIndex: number): Promise<void> {
  await vaultStore.addCandidate(walletId, {
    vaultId: vaultId(vault, 'preprod'),
    network: 'preprod',
    origin: 'imported',
    paymentScriptCbor: vault.payment.cbor,
    stakeScriptCbor: vault.stake.cbor,
    participants: [
      { role: 'owner', vaultKeys: selfKeys, self: true },
      ...cosigners.map(p => ({ role: 'owner' as const, vaultKeys: p.vaultKeys })),
    ],
    ownIndex,
  });
}

/** The wallet's keys and UTxO, and a transaction spending it with `body` on top. */
function walletTx(bg: WalletBg, body: Partial<Cardano.TxBody> = {}) {
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
  ];
  return { txCbor: tx.toCbor(), utxos, keys };
}

const withMultisig00 = (keys: Keys): Keys => ({
  ...keys,
  payment: keys.payment.map((key, index) => (index === 0 ? { ...key, path: "m/1854'/1815'/0'/0/0" } : key)),
});

describe('WalletBg.signTx with vaults from the vault store', () => {
  beforeEach(() => {
    WalletStore.clearForWalletSwitch();
  });

  it('refuses a withdrawal from a stored vault, before the root key is opened', async () => {
    const bg = await bootWallet();
    const vault = await buildVault({ roleKeys: ownRoleKeys, index: 1 });
    const { reward } = vaultAddresses(vault, 'preprod');
    const { txCbor, utxos, keys } = walletTx(bg, { withdrawals: [{ stakeAddress: reward, quantity: 1_000_000n }] });

    // Before the vault is stored, nothing tells the signer the reward account is a vault's.
    await expect(bg.signTx(txCbor, '', utxos, keys, rootKeyBytes)).resolves.toMatchObject({ witnesses: expect.any(String) });

    await storeVault(bg.id, vault, await deriveVaultPublicKeys(ownRoleKeys, 1), 1);
    const decrypt = vi.spyOn(bg as unknown as { decryptRootPrivateKey: () => Promise<unknown> }, 'decryptRootPrivateKey');
    await expect(bg.signTx(txCbor, 'synthetic-password', utxos, keys)).rejects.toThrow(VAULT_SIGN_REFUSAL_MESSAGE);
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('refuses the 0/0 multisig key once the wallet stores a vault at its own index 0', async () => {
    const bg = await bootWallet();
    const { txCbor, utxos, keys } = walletTx(bg);

    // Before: the 0/0 multisig key signs, as it always has.
    await expect(bg.signTx(txCbor, '', utxos, withMultisig00(keys), rootKeyBytes)).resolves.toMatchObject({ witnesses: expect.any(String) });

    await storeVault(bg.id, await buildVault({ roleKeys: ownRoleKeys, index: 0 }), ownAtZero, 0);
    await expect(bg.signTx(txCbor, '', utxos, withMultisig00(keys), rootKeyBytes)).rejects.toThrow(VAULT_SIGN_REFUSAL_MESSAGE);
    // The wallet's own keys still sign its own transaction.
    await expect(bg.signTx(txCbor, '', utxos, keys, rootKeyBytes)).resolves.toMatchObject({ witnesses: expect.any(String) });
  });
});
