// A Bitcoin send from a Trezor, through either Trezor Connect bundle, asks the device
// with the transaction's inputs and outputs and their paths (issue 1325). It used to pass
// a `psbt` field Connect does not take, with empty inputs and outputs.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

const connect = vi.hoisted(() => ({ init: vi.fn(), signTransaction: vi.fn() }));
vi.mock('@trezor/connect-webextension', () => ({ default: connect }));
vi.mock('@trezor/connect-web', () => ({ default: connect }));

import { deriveBitcoinAccountXpub, deriveBitcoinRootKey } from '@/chains/bitcoin/bitcoinKeyManager';
import { signPsbtWithMnemonic } from '@/chains/bitcoin/bitcoinSigner';

const { Buffer: NodeBuffer } = createRequire(import.meta.url)('node:buffer') as typeof import('node:buffer');

// The modules read chrome.runtime.id when they load, so they are imported after this stub.
// @ts-expect-error minimal chrome global for the test
globalThis.chrome = { runtime: { id: 'test-extension-id' } };

// Fixed test vector — never used to hold funds.
const PHRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const account = { xpub: deriveBitcoinAccountXpub(PHRASE, 'Testnet', 'segwit'), network: 'Testnet', addressType: 'segwit', accountIndex: 0 };
const script = (chain: number, index: number) => bitcoin.payments.p2wpkh({
  pubkey: NodeBuffer.from(deriveBitcoinRootKey(PHRASE).derive(`m/84'/1'/0'/${chain}/${index}`).publicKey!),
}).output!;

/** A send of one coin on a later receive address, with change. */
const unsigned = new bitcoin.Psbt({ network: bitcoin.networks.testnet })
  .addInput({ hash: '77'.repeat(32), index: 1, witnessUtxo: { script: script(0, 4), value: 30_000 } })
  .addOutput({ script: script(1, 0), value: 29_000 });

/** The device's answer: the transaction signed with the account's key. */
const signedTx = signPsbtWithMnemonic(unsigned.toHex(), PHRASE, 'Testnet').finalizeAllInputs().extractTransaction().toHex();

type BitcoinSign = (psbt: string, signer: typeof account) => Promise<string>;
const bundles: Array<[string, () => Promise<BitcoinSign>]> = [
  ['trezor (Bridge)', async () => { const { default: trezor } = await import('./trezor'); return trezor.signBitcoinTransaction.bind(trezor); }],
  ['trezorWeb (WebUSB)', async () => { const { default: trezor } = await import('./trezorWeb'); return trezor.signTransaction.bind(trezor); }],
];

describe.each(bundles)('%s Bitcoin signing', (_name, load) => {
  let sign: BitcoinSign;
  beforeAll(async () => { sign = await load(); });
  beforeEach(() => {
    connect.init.mockReset().mockResolvedValue(undefined);
    connect.signTransaction.mockReset().mockResolvedValue({ success: true, payload: { signatures: [], serializedTx: signedTx } });
  });

  it('asks the device with the inputs and outputs and their paths, not a PSBT', async () => {
    await sign(unsigned.toBase64(), account);

    expect(connect.signTransaction).toHaveBeenCalledTimes(1);
    const [params] = connect.signTransaction.mock.calls[0];
    expect(params).not.toHaveProperty('psbt');
    expect(params).toMatchObject({
      coin: 'test',
      inputs: [{ address_n: "m/84'/1'/0'/0/4", prev_hash: '77'.repeat(32), prev_index: 1, amount: '30000', script_type: 'SPENDWITNESS' }],
      outputs: [{ address_n: "m/84'/1'/0'/1/0", amount: '29000', script_type: 'PAYTOWITNESS' }],
    });
  });

  it('returns the approved PSBT, in hex, with the device’s signature', async () => {
    const signedHex = await sign(unsigned.toHex(), account);

    const signed = bitcoin.Psbt.fromHex(signedHex, { network: bitcoin.networks.testnet });
    expect(signed.validateSignaturesOfInput(0, (pubkey, hash, signature) => ecc.verify(hash, pubkey, signature))).toBe(true);
    expect(signed.finalizeAllInputs().extractTransaction().toHex()).toBe(signedTx);
  });

  it('surfaces the device’s error', async () => {
    connect.signTransaction.mockResolvedValue({ success: false, payload: { error: 'Cancelled' } });

    await expect(sign(unsigned.toHex(), account)).rejects.toThrow('Cancelled');
  });
});
