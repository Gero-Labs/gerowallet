// A software Bitcoin wallet signs each input with the key of the address it spends from.
// Under Gero Sync the wallet's UTxOs carry no derivation path, so the PSBTs built from
// them name none (issue 1336): the signer finds the key from the input's own address.
import { describe, expect, it, vi } from 'vitest';
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

import { signPsbtWithMnemonic } from './bitcoinSigner';
import { deriveBitcoinRootKey } from './bitcoinKeyManager';

const { Buffer: NodeBuffer } = createRequire(import.meta.url)('node:buffer') as typeof import('node:buffer');

// Fixed test vectors — never used to hold funds.
const PHRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const OTHER_PHRASE = 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above';

/** The public key at m/84'/1'/account'/chain/index of `phrase` (Testnet, segwit). */
function pubkeyAt(chain: number, index: number, account = 0, phrase = PHRASE): Buffer {
  return NodeBuffer.from(deriveBitcoinRootKey(phrase).derive(`m/84'/1'/${account}'/${chain}/${index}`).publicKey!);
}

const scriptOf = (pubkey: Buffer) => bitcoin.payments.p2wpkh({ pubkey }).output!;

/** A PSBT spending one 10 000 sat output to each of `pubkeys`, with no bip32Derivation. */
function spending(...pubkeys: Buffer[]): bitcoin.Psbt {
  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.testnet });
  pubkeys.forEach((pubkey, i) => {
    psbt.addInput({ hash: NodeBuffer.alloc(32, i + 1), index: 0, witnessUtxo: { script: scriptOf(pubkey), value: 10_000 } });
  });
  return psbt.addOutput({ script: scriptOf(pubkeyAt(0, 0)), value: 9_000 * pubkeys.length });
}

/** The key each input was signed with, after checking every signature. */
function signerKeys(psbt: bitcoin.Psbt): string[] {
  return psbt.data.inputs.map((input, i) => {
    expect(psbt.validateSignaturesOfInput(i, (pubkey, hash, signature) => ecc.verify(hash, pubkey, signature))).toBe(true);
    return input.partialSig![0].pubkey.toString('hex');
  });
}

describe('signPsbtWithMnemonic', () => {
  it('signs coins on a later receive address and on a change address with their own keys', () => {
    const receive = pubkeyAt(0, 3);
    const change = pubkeyAt(1, 2);

    const signed = signPsbtWithMnemonic(spending(receive, change).toHex(), PHRASE, 'Testnet');

    expect(signerKeys(signed)).toEqual([receive.toString('hex'), change.toString('hex')]);
  });

  it('does the same on an added account, with that account’s keys', () => {
    const change = pubkeyAt(1, 0, 1);

    const signed = signPsbtWithMnemonic(spending(change).toHex(), PHRASE, 'Testnet', 'segwit', 1);

    expect(signerKeys(signed)).toEqual([change.toString('hex')]);
  });

  it('still signs at the path an input’s bip32Derivation names', () => {
    const receive = pubkeyAt(0, 5);
    const psbt = spending(receive);
    psbt.updateInput(0, { bip32Derivation: [{ masterFingerprint: NodeBuffer.alloc(4), pubkey: receive, path: 'm/0/5' }] });

    expect(signerKeys(signPsbtWithMnemonic(psbt, PHRASE, 'Testnet'))).toEqual([receive.toString('hex')]);
  });

  it('still refuses an input that spends from an address the wallet does not hold', () => {
    const foreign = pubkeyAt(0, 1, 0, OTHER_PHRASE);

    expect(() => signPsbtWithMnemonic(spending(foreign).toHex(), PHRASE, 'Testnet')).toThrow('Failed to sign input 0');
  });
});
