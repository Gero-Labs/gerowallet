// A Taproot wallet proves its own bc1p address when it signs a message with BIP322, as a
// verifier checks it: one Schnorr signature by the address's output key (issue 1337).
// This drives a real WalletBg (real Dexie via fake-indexeddb, real key derivation).
import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { createRequire } from 'node:module';

// bitcoinjs-lib is externalized to Node by Vitest and checks keys against Node's Buffer,
// while the sources get the polyfill. Hand the sources Node's Buffer too (the bundles use
// one Buffer, so the extension is unaffected).
vi.mock('vite-plugin-node-polyfills/shims/buffer', async () => {
  const { createRequire: requireFrom } = await import('node:module');
  const { Buffer } = requireFrom(import.meta.url)('node:buffer');
  return { default: Buffer, Buffer };
});
vi.mock('@/chrome/storeMessagingBg', () => ({ default: { broadcastUpdate: vi.fn() } }));
vi.mock('@/services/storeMessaging.service', () => ({ default: { subscribe: vi.fn() } }));
vi.mock('@/stores/priceStore', () => ({ default: { initialize: vi.fn(), disconnect: vi.fn() } }));

import { WalletBg } from './walletBg';
import { SecretPurpose } from '@/shared/utils/crypto';
import { sealTextSecret } from '@/shared/utils/secretWriters';
import { deriveBitcoinAccountXpub, deriveBitcoinRootKey } from '@/chains/bitcoin/bitcoinKeyManager';
import { Blockchain, Network, WalletType } from '@/models/types';

const { Buffer: NodeBuffer } = createRequire(import.meta.url)('node:buffer') as typeof import('node:buffer');

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

// Fixed test vector — never used to hold funds.
const PHRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const PASSWORD = 'public-test-password';

let walletSeq = 0;
async function bitcoinWallet(addressType: 'taproot' | 'segwit'): Promise<WalletBg> {
  walletSeq += 1;
  const encryptedMnemonic = await sealTextSecret(PHRASE, PASSWORD, SecretPurpose.Mnemonic);
  return new WalletBg({
    id: 951_000 + walletSeq, name: `bitcoin-${walletSeq}`, chain: Blockchain.BITCOIN, network: Network.TESTNET, type: WalletType.Normal,
    addressType, publicKey: deriveBitcoinAccountXpub(PHRASE, Network.TESTNET, addressType), accountIndex: 0,
    encryptionMethod: 'password' as const, encryptedMnemonic,
  });
}

/** The witness stack a BIP322 "simple" signature encodes. */
function witnessOf(signature: string): Buffer[] {
  const bytes = NodeBuffer.from(signature, 'base64');
  const items: Buffer[] = [];
  let offset = 1;
  for (let i = 0; i < bytes[0]; i++) {
    const length = bytes[offset];
    items.push(bytes.subarray(offset + 1, offset + 1 + length));
    offset += 1 + length;
  }
  return items;
}

/** The BIP322 to_sign transaction proving `message` for the output `script`, as a verifier builds it. */
function toSign(message: string, script: Buffer): bitcoin.Transaction {
  const tag = bitcoin.crypto.sha256(NodeBuffer.from('BIP0322-signed-message'));
  const messageHash = bitcoin.crypto.sha256(NodeBuffer.concat([tag, tag, NodeBuffer.from(message)]));
  const toSpend = new bitcoin.Transaction();
  toSpend.version = 0;
  toSpend.addInput(NodeBuffer.alloc(32), 0xffffffff, 0, bitcoin.script.compile([bitcoin.opcodes['OP_0'], messageHash]));
  toSpend.addOutput(script, 0);
  const tx = new bitcoin.Transaction();
  tx.version = 0;
  tx.addInput(toSpend.getHash(), 0, 0);
  tx.addOutput(bitcoin.script.compile([bitcoin.opcodes['OP_RETURN']]), 0);
  return tx;
}

describe('BIP322 message signing on a Bitcoin wallet', () => {
  it('proves a Taproot wallet’s own address with a Schnorr signature by its output key', async () => {
    const bg = await bitcoinWallet('taproot');
    const script = bitcoin.address.toOutputScript(bg.baseAddress, bitcoin.networks.testnet);

    const witness = witnessOf(await bg.signBitcoinDappMessage('hello', 'bip322-simple', PASSWORD));

    expect(witness).toHaveLength(1);
    expect(witness[0]).toHaveLength(64);
    const hash = toSign('hello', script).hashForWitnessV1(0, [script], [0], bitcoin.Transaction.SIGHASH_DEFAULT);
    expect(ecc.verifySchnorr(hash, script.subarray(2, 34), witness[0])).toBe(true);
  });

  it('still proves a SegWit wallet’s P2WPKH address with its key', async () => {
    const bg = await bitcoinWallet('segwit');
    const pubkey = NodeBuffer.from(deriveBitcoinRootKey(PHRASE).derive(`m/84'/1'/0'/0/0`).publicKey!);

    const witness = witnessOf(await bg.signBitcoinDappMessage('hello', 'bip322-simple', PASSWORD));

    expect(witness).toHaveLength(2);
    expect(witness[1].toString('hex')).toBe(pubkey.toString('hex'));
    expect(bitcoin.payments.p2wpkh({ pubkey, network: bitcoin.networks.testnet }).address).toBe(bg.baseAddress);
  });
});
