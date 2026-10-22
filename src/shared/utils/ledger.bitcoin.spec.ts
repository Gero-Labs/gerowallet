// A Bitcoin send from a Ledger signs through hw-app-btc's signPsbtBuffer, the method the
// installed library has (issue 1324): it used to call a `signPsbt` that doesn't exist.
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const device = vi.hoisted(() => ({ signPsbtBuffer: vi.fn() }));
vi.mock('@ledgerhq/hw-app-btc', () => ({
  default: class { signPsbtBuffer = device.signPsbtBuffer; },
}));
vi.mock('@/plugins/hardwareLoading', () => ({ default: { setText: vi.fn(), setLoading: vi.fn() } }));

import { deserializePsbt } from '@ledgerhq/hw-app-btc/lib/signPsbt/parsePsbt';
import type { SignPsbtBufferOptions } from '@ledgerhq/hw-app-btc/lib/signPsbt/types';
import ledger from './ledger';
import { deriveBitcoinAccountXpub, deriveBitcoinRootKey } from '@/chains/bitcoin/bitcoinKeyManager';
import { signPsbtWithMnemonic } from '@/chains/bitcoin/bitcoinSigner';

const { Buffer: NodeBuffer } = createRequire(import.meta.url)('node:buffer') as typeof import('node:buffer');

// Fixed test vector — never used to hold funds.
const PHRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const xpub = deriveBitcoinAccountXpub(PHRASE, 'Testnet', 'segwit');
const account = { xpub, network: 'Testnet', addressType: 'segwit', accountIndex: 0 };

const script = (chain: number, index: number) => bitcoin.payments.p2wpkh({
  pubkey: NodeBuffer.from(deriveBitcoinRootKey(PHRASE).derive(`m/84'/1'/0'/${chain}/${index}`).publicKey!),
}).output!;

/** A send of one coin on a later receive address, as a dApp builds it: no derivation. */
const unsigned = new bitcoin.Psbt({ network: bitcoin.networks.testnet })
  .addInput({ hash: NodeBuffer.alloc(32, 7), index: 1, witnessUtxo: { script: script(0, 4), value: 30_000 } })
  .addOutput({ script: script(1, 0), value: 29_000 });

/** The device: signs what it is handed with the account's key and answers as hw-app-btc does, in PSBT v2. */
async function signLikeTheDevice(psbt: Buffer, _options: SignPsbtBufferOptions): Promise<{ psbt: Buffer }> {
  const signed = signPsbtWithMnemonic(bitcoin.Psbt.fromBuffer(psbt).toHex(), PHRASE, 'Testnet');
  const answer = deserializePsbt(psbt);
  signed.data.inputs.forEach((input, i) => input.partialSig!.forEach(({ pubkey, signature }) => answer.setInputPartialSig(i, pubkey, signature)));
  return { psbt: answer.serialize() };
}

beforeEach(() => {
  device.signPsbtBuffer.mockReset().mockImplementation(signLikeTheDevice);
  vi.spyOn(ledger, 'connectViaUSB').mockResolvedValue({} as never);
});

describe('ledger.signBitcoinTransaction', () => {
  it('asks the device with signPsbtBuffer, the account path, address format and the wallet’s addresses', async () => {
    await ledger.signBitcoinTransaction(unsigned.toHex(), account);

    expect(device.signPsbtBuffer).toHaveBeenCalledTimes(1);
    const [buffer, options] = device.signPsbtBuffer.mock.calls[0] as [Buffer, SignPsbtBufferOptions];
    expect(NodeBuffer.from(buffer).equals(unsigned.toBuffer())).toBe(true);
    expect(options).toMatchObject({ finalizePsbt: false, accountPath: "m/84'/1'/0'", addressFormat: 'bech32' });
    expect(options.knownAddressDerivations.get(script(0, 4).subarray(2).toString('hex'))?.path)
      .toEqual([0x80000054, 0x80000001, 0x80000000, 0, 4]);
  });

  it('returns the approved PSBT, in hex, with the device’s signature', async () => {
    const signedHex = await ledger.signBitcoinTransaction(unsigned.toBase64(), account);

    const signed = bitcoin.Psbt.fromHex(signedHex, { network: bitcoin.networks.testnet });
    expect(signed.data.globalMap.unsignedTx.toBuffer().equals(unsigned.data.globalMap.unsignedTx.toBuffer())).toBe(true);
    expect(signed.validateSignaturesOfInput(0, (pubkey, hash, signature) => ecc.verify(hash, pubkey, signature))).toBe(true);
    expect(() => signed.finalizeAllInputs().extractTransaction()).not.toThrow();
  });

  it('fails when the device signs nothing', async () => {
    device.signPsbtBuffer.mockImplementation(async (psbt: Buffer) => ({ psbt: deserializePsbt(psbt).serialize() }));

    await expect(ledger.signBitcoinTransaction(unsigned.toHex(), account)).rejects.toThrow('did not sign');
  });
});
