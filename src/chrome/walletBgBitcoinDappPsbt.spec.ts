// A dApp's PSBT is signed exactly as the approval view reviewed it: only the
// wallet's own inputs, only the ones toSignInputs lists, and never one whose
// value or sighash the review refuses. Drives a real WalletBg (real Dexie via
// fake-indexeddb, real key derivation and signing).
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { createRequire } from 'node:module';

// bitcoinjs-lib is externalized to Node by Vitest and checks buffers against Node's
// Buffer, while the sources get the polyfill (see bitcoinSigner.spec.ts).
vi.mock('vite-plugin-node-polyfills/shims/buffer', async () => {
  const { createRequire: requireFrom } = await import('node:module');
  const { Buffer } = requireFrom(import.meta.url)('node:buffer');
  return { default: Buffer, Buffer };
});
vi.mock('@/chrome/storeMessagingBg', () => ({ default: { broadcastUpdate: vi.fn() } }));
vi.mock('@/services/storeMessaging.service', () => ({ default: { subscribe: vi.fn() } }));
vi.mock('@/stores/priceStore', () => ({ default: { initialize: vi.fn(), disconnect: vi.fn() } }));
vi.mock('@/shared/utils/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/utils/crypto')>();
  return { ...actual, decrypt: vi.fn(actual.decrypt) };
});

import { WalletBg } from './walletBg';
import WalletStore from '@/stores/walletStore';
import { decrypt, SecretPurpose } from '@/shared/utils/crypto';
import { sealTextSecret } from '@/shared/utils/secretWriters';
import { deriveBitcoinAccountXpub, deriveBitcoinRootKey } from '@/chains/bitcoin/bitcoinKeyManager';
import { Blockchain, Network, WalletType } from '@/models/types';

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

const { Buffer: NodeBuffer } = createRequire(import.meta.url)('node:buffer') as typeof import('node:buffer');

// Fixed test vectors — never used to hold funds.
const PHRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const OTHER_PHRASE = 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above';
const PASSWORD = 'public-test-password';

const pubkeyAt = (chain: number, index: number, phrase = PHRASE) =>
  NodeBuffer.from(deriveBitcoinRootKey(phrase).derive(`m/84'/1'/0'/${chain}/${index}`).publicKey!);
const scriptOf = (pubkey: Buffer) => bitcoin.payments.p2wpkh({ pubkey, network: bitcoin.networks.testnet }).output!;

async function bitcoinWallet(): Promise<WalletBg> {
  const encryptedMnemonic = await sealTextSecret(PHRASE, PASSWORD, SecretPurpose.Mnemonic);
  return new WalletBg({
    id: 951_001, name: 'bitcoin-dapp', chain: Blockchain.BITCOIN, network: Network.TESTNET, type: WalletType.Normal,
    addressType: 'segwit', publicKey: deriveBitcoinAccountXpub(PHRASE, Network.TESTNET, 'segwit', 0), accountIndex: 0,
    encryptionMethod: 'password' as const, encryptedMnemonic,
  });
}

/** Own coin at input 0, another party's coin at input 1, one output to that party. */
function sharedPsbt(sighashType?: number): bitcoin.Psbt {
  return new bitcoin.Psbt({ network: bitcoin.networks.testnet })
    .addInput({
      hash: NodeBuffer.alloc(32, 1), index: 0, witnessUtxo: { script: scriptOf(pubkeyAt(0, 0)), value: 10_000 },
      ...(sighashType !== undefined ? { sighashType } : {}),
    })
    .addInput({ hash: NodeBuffer.alloc(32, 2), index: 0, witnessUtxo: { script: scriptOf(pubkeyAt(0, 0, OTHER_PHRASE)), value: 10_000 } })
    .addOutput({ script: scriptOf(pubkeyAt(0, 0, OTHER_PHRASE)), value: 19_000 });
}

describe('WalletBg.signBitcoinDappPsbt', () => {
  beforeEach(() => {
    WalletStore.clearForWalletSwitch();
    vi.mocked(decrypt).mockClear();
  });

  it('signs and finalizes only the wallet’s input, returning a PSBT while another party still has to sign', async () => {
    const bg = await bitcoinWallet();

    const out = await bg.signBitcoinDappPsbt(sharedPsbt().toHex(), { toSignInputs: [{ index: 0 }] }, PASSWORD);

    const signed = bitcoin.Psbt.fromHex(out, { network: bitcoin.networks.testnet });
    expect(signed.data.inputs[0].finalScriptWitness).toBeDefined();
    expect(signed.data.inputs[1].finalScriptWitness).toBeUndefined();
    expect(signed.data.inputs[1].partialSig).toBeUndefined();
  });

  it('refuses to sign another party’s input, before decrypting anything', async () => {
    const bg = await bitcoinWallet();

    await expect(bg.signBitcoinDappPsbt(sharedPsbt().toHex(), { toSignInputs: [{ index: 1 }] }, PASSWORD))
      .rejects.toThrow('does not spend from this wallet');
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('refuses a non-ALL sighash and a stated value that differs from the wallet’s coin', async () => {
    const bg = await bitcoinWallet();
    const anyoneCanPay = bitcoin.Transaction.SIGHASH_ALL | bitcoin.Transaction.SIGHASH_ANYONECANPAY;

    await expect(bg.signBitcoinDappPsbt(sharedPsbt(anyoneCanPay).toHex(), undefined, PASSWORD)).rejects.toThrow('sighash');
    const coin = { txHash: NodeBuffer.alloc(32, 1).reverse().toString('hex'), index: 0, value: 999_999n, address: 'tb1q-own' };
    await expect(bg.signBitcoinDappPsbt(sharedPsbt().toHex(), undefined, PASSWORD, undefined, [coin]))
      .rejects.toThrow('differs from the wallet');
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('still extracts a broadcast-ready transaction when it signs every input', async () => {
    const bg = await bitcoinWallet();
    const psbt = new bitcoin.Psbt({ network: bitcoin.networks.testnet })
      .addInput({ hash: NodeBuffer.alloc(32, 3), index: 0, witnessUtxo: { script: scriptOf(pubkeyAt(1, 0)), value: 10_000 } })
      .addOutput({ script: scriptOf(pubkeyAt(0, 0, OTHER_PHRASE)), value: 9_000 });

    const txHex = await bg.signBitcoinDappPsbt(psbt.toHex(), {}, PASSWORD);

    expect(bitcoin.Transaction.fromHex(txHex).ins).toHaveLength(1);
  });
});
