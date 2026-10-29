// WalletBg.signTx and the CIP-113 allowance: a transaction spending one of the wallet's
// programmable UTxOs is refused unless it is the exact transaction CIP113_PREPARE_TRANSFER
// verified, and then it is signed once. Drives a real WalletBg (real Dexie via
// fake-indexeddb, real key derivation) with the public "abandon … art" test phrase.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bech32 } from 'bech32';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Ed25519KeyHashHex, type Bip32PrivateKey } from '@cardano-sdk/crypto';

vi.mock('@/chrome/storeMessagingBg', () => ({ default: { broadcastUpdate: vi.fn() } }));
vi.mock('@/services/storeMessaging.service', () => ({ default: { subscribe: vi.fn() } }));
vi.mock('@/stores/priceStore', () => ({ default: { initialize: vi.fn(), disconnect: vi.fn() } }));

import { WalletBg } from './walletBg';
import WalletStore from '@/stores/walletStore';
import { getPaymentKeyExternal, getStakeKey } from './serialization';
import { resolvePrivateKey } from '@/shared/utils/resolver';
import { setWalletConfiguration } from '@/db/wallet-db';
import { CIP113_SIGN_REFUSAL_MESSAGE } from '@/chrome/config';
import { clearCip113SignAllowance, grantCip113SignAllowance } from './cip113Allowance';
import { programmableAddress } from './cip113VerifyTransfer';
import { CIP113_BASE_PREPROD } from '@/utils/cip113Deployments';
import { Blockchain, CoinTypes, HARDENED, Network, WalletType, WalletTypePurpose } from '@/models/types';

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
const PROGRAMMABLE_TX = 'b1'.repeat(32);
const FEE_TX = 'f1'.repeat(32);
const PROGRAMMABLE_REF = `${PROGRAMMABLE_TX}#0`;

let walletSeq = 0;
async function bootWallet(): Promise<WalletBg> {
  walletSeq += 1;
  const id = 940_000 + walletSeq;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture stands in for the persisted Wallet record
  const bg = new WalletBg({ id, name: `send-${walletSeq}`, chain: Blockchain.CARDANO, network: Network.PREPROD, type: WalletType.Normal, publicKey: XPUB } as any);
  await setWalletConfiguration(id, 'cip113ProgrammableInputRefs', JSON.stringify([PROGRAMMABLE_REF]));
  await bg.loadProgrammableRefs();
  return bg;
}

/** A transfer-shaped transaction: the programmable UTxO plus a fee input, the stake key required. */
function transfer(bg: WalletBg) {
  const keys = bg.resolvePathsForMissingAddresses([]);
  const own = keys.payment[0].address!;
  const stakeHash = getStakeKey(XPUB, 0).hash().hex();
  const tx = Serialization.Transaction.fromCore({
    id: Cardano.TransactionId('00'.repeat(32)),
    body: {
      inputs: [{ txId: Cardano.TransactionId(PROGRAMMABLE_TX), index: 0 }, { txId: Cardano.TransactionId(FEE_TX), index: 0 }],
      outputs: [{ address: Cardano.PaymentAddress(own), value: { coins: 3_000_000n } }],
      fee: 200_000n,
      requiredExtraSignatures: [Ed25519KeyHashHex(stakeHash)],
    },
    witness: { signatures: new Map() },
  });
  const utxos: Cardano.Utxo[] = [[
    { txId: Cardano.TransactionId(FEE_TX), index: 0, address: own as Cardano.PaymentAddress },
    { address: own as Cardano.PaymentAddress, value: { coins: 5_000_000n } },
  ]];
  return { txCbor: tx.toCbor(), txId: tx.getId(), utxos, keys };
}

function signingKeys(witnesses: string): string[] {
  const vkeys = Serialization.TransactionWitnessSet.fromCbor(Serialization.TxCBOR(witnesses)).vkeys()?.values() ?? [];
  return vkeys.map((witness) => witness.vkey()).sort();
}

describe('WalletBg.signTx with a CIP-113 allowance', () => {
  beforeEach(() => {
    WalletStore.clearForWalletSwitch();
    clearCip113SignAllowance();
  });

  it('refuses a transaction spending a programmable UTxO without an allowance', async () => {
    const bg = await bootWallet();
    const { txCbor, utxos, keys } = transfer(bg);
    expect(bg.findProgrammableInputs(Serialization.Transaction.fromCbor(Serialization.TxCBOR(txCbor)).toCore())).toEqual([PROGRAMMABLE_REF]);

    await expect(bg.signTx(txCbor, '', utxos, keys, rootKeyBytes)).rejects.toThrow(CIP113_SIGN_REFUSAL_MESSAGE);
  });

  it('signs the allowed transaction once, with the fee payment key and the owner stake key', async () => {
    const bg = await bootWallet();
    const { txCbor, txId, utxos, keys } = transfer(bg);
    grantCip113SignAllowance(bg.id, txId, [PROGRAMMABLE_REF]);

    const { witnesses } = await bg.signTx(txCbor, '', utxos, keys, rootKeyBytes);
    expect(signingKeys(witnesses)).toEqual([getPaymentKeyExternal(XPUB, 0).hex(), getStakeKey(XPUB, 0).hex()].sort());

    await expect(bg.signTx(txCbor, '', utxos, keys, rootKeyBytes)).rejects.toThrow(CIP113_SIGN_REFUSAL_MESSAGE);
  });

  it('refuses when the allowance names another transaction or another wallet', async () => {
    const bg = await bootWallet();
    const { txCbor, txId, utxos, keys } = transfer(bg);

    grantCip113SignAllowance(bg.id, 'cd'.repeat(32), [PROGRAMMABLE_REF]);
    await expect(bg.signTx(txCbor, '', utxos, keys, rootKeyBytes)).rejects.toThrow(CIP113_SIGN_REFUSAL_MESSAGE);

    grantCip113SignAllowance(bg.id + 1, txId, [PROGRAMMABLE_REF]);
    await expect(bg.signTx(txCbor, '', utxos, keys, rootKeyBytes)).rejects.toThrow(CIP113_SIGN_REFUSAL_MESSAGE);
  });

  it('does not use the allowance up when the signer is not authorized', async () => {
    const bg = await bootWallet();
    const { txCbor, txId, utxos, keys } = transfer(bg);
    grantCip113SignAllowance(bg.id, txId, [PROGRAMMABLE_REF]);

    const unauthorized = () => { throw new Error('session ended'); };
    await expect(bg.signTx(txCbor, '', utxos, keys, rootKeyBytes, unauthorized)).rejects.toThrow('session ended');
    // Still there for the user's retry.
    await expect(bg.signTx(txCbor, '', utxos, keys, rootKeyBytes)).resolves.toBeTruthy();
  });

  it('never signs for the programmable input itself', async () => {
    const bg = await bootWallet();
    const { txCbor, txId, keys } = transfer(bg);
    grantCip113SignAllowance(bg.id, txId, [PROGRAMMABLE_REF]);
    const plb = programmableAddress(CIP113_BASE_PREPROD[0], getStakeKey(XPUB, 0).hash().hex(), Cardano.NetworkId.Testnet);
    // Even if a caller hands the programmable UTxO over as if it were spendable.
    const utxos: Cardano.Utxo[] = [[
      { txId: Cardano.TransactionId(PROGRAMMABLE_TX), index: 0, address: plb as Cardano.PaymentAddress },
      { address: plb as Cardano.PaymentAddress, value: { coins: 1_300_000n } },
    ]];

    const { witnesses } = await bg.signTx(txCbor, '', utxos, keys, rootKeyBytes);
    expect(signingKeys(witnesses)).toEqual([getStakeKey(XPUB, 0).hex()]);
  });
});
