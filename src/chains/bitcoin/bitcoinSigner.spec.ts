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

import { signAndFinalizePsbt, signPsbtWithMnemonic, taprootKeyPathSigner } from './bitcoinSigner';
import { buildSimpleSendPsbt } from './bitcoinPsbtBuilder';
import { bitcoinMasterFingerprint, deriveBitcoinAccountXpub, deriveBitcoinAddress, deriveBitcoinRootKey } from './bitcoinKeyManager';

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

describe('Taproot (BIP86) wallets', () => {
  /** The public key at m/86'/1'/0'/chain/index of the test phrase (Testnet). */
  const taprootKeyAt = (chain: number, index: number) =>
    NodeBuffer.from(deriveBitcoinRootKey(PHRASE).derive(`m/86'/1'/0'/${chain}/${index}`).publicKey!);
  const xOnly = (pubkey: Buffer) => pubkey.subarray(1, 33);
  const taprootScriptOf = (pubkey: Buffer) => bitcoin.payments.p2tr({ internalPubkey: xOnly(pubkey) }).output!;

  /** Checks each input's witness is one Schnorr signature that its output key verifies. */
  function expectKeyPathSpends(txHex: string, prevouts: Array<{ script: Buffer; value: number }>): void {
    const tx = bitcoin.Transaction.fromHex(txHex);
    const scripts = prevouts.map((p) => p.script);
    const values = prevouts.map((p) => p.value);
    tx.ins.forEach((input, i) => {
      expect(input.witness).toHaveLength(1);
      const [signature] = input.witness;
      expect(signature).toHaveLength(64);
      const hash = tx.hashForWitnessV1(i, scripts, values, bitcoin.Transaction.SIGHASH_DEFAULT);
      expect(ecc.verifySchnorr(hash, scripts[i].subarray(2, 34), signature)).toBe(true);
    });
  }

  it('tweaks the key as BIP86 does (its first mainnet receive address)', () => {
    const key = deriveBitcoinRootKey('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about')
      .derive(`m/86'/0'/0'/0/0`);

    const signer = taprootKeyPathSigner({ privateKey: key.privateKey!, publicKey: key.publicKey! });

    expect(xOnly(signer.publicKey).toString('hex')).toBe('a60869f0dbcf1dc659c9cecbaf8050135ea9e8cdc487053f1dc6880949dc684c');
  });

  it('signs a Taproot input with a Schnorr key-path signature its output key verifies', () => {
    const script = taprootScriptOf(taprootKeyAt(0, 2));
    const psbt = new bitcoin.Psbt({ network: bitcoin.networks.testnet })
      .addInput({ hash: NodeBuffer.alloc(32, 1), index: 0, witnessUtxo: { script, value: 10_000 } })
      .addOutput({ script: taprootScriptOf(taprootKeyAt(1, 0)), value: 9_000 });

    const signed = signAndFinalizePsbt(psbt.toHex(), PHRASE, 'Testnet', 'taproot');

    expectKeyPathSpends(signed.hex, [{ script, value: 10_000 }]);
  });

  it('builds a send from Taproot coins with Taproot path data, then signs it', () => {
    const xpub = deriveBitcoinAccountXpub(PHRASE, 'Testnet', 'taproot');
    const address = deriveBitcoinAddress(xpub, 'Testnet', 'taproot', 0, 3);
    const utxo = { txHash: '11'.repeat(32), index: 0, address, value: 50_000n, confirmed: true, derivationChain: 0, derivationIndex: 3 };

    const unsigned = buildSimpleSendPsbt([utxo], deriveBitcoinAddress(xpub, 'Testnet', 'taproot', 0, 4), 20_000n,
      deriveBitcoinAddress(xpub, 'Testnet', 'taproot', 1, 0), 2, 'Testnet', { xpub, path: "m/86'/1'/0'", masterFingerprint: 'c0ffee42' });

    const [input] = bitcoin.Psbt.fromHex(unsigned.raw.hex as string).data.inputs;
    expect(input.bip32Derivation).toBeUndefined();
    expect(input.tapInternalKey!.toString('hex')).toBe(xOnly(taprootKeyAt(0, 3)).toString('hex'));
    expect(input.tapBip32Derivation).toMatchObject([{ path: "m/86'/1'/0'/0/3", leafHashes: [] }]);
    expect(input.tapBip32Derivation![0].masterFingerprint.toString('hex')).toBe('c0ffee42');
    const signed = signAndFinalizePsbt(unsigned.raw.hex as string, PHRASE, 'Testnet', 'taproot');
    expectKeyPathSpends(signed.hex, [{ script: input.witnessUtxo!.script, value: 50_000 }]);
  });
});

describe('PSBT derivation metadata (BIP174)', () => {
  const xpub = deriveBitcoinAccountXpub(PHRASE, 'Testnet', 'segwit');
  const send = (masterFingerprint?: string) => {
    const utxo = { txHash: '22'.repeat(32), index: 1, address: deriveBitcoinAddress(xpub, 'Testnet', 'segwit', 1, 5), value: 40_000n, confirmed: true, derivationChain: 1, derivationIndex: 5 };
    const unsigned = buildSimpleSendPsbt([utxo], deriveBitcoinAddress(xpub, 'Testnet', 'segwit', 0, 9), 10_000n,
      deriveBitcoinAddress(xpub, 'Testnet', 'segwit', 1, 6), 2, 'Testnet', { xpub, path: "m/84'/1'/0'", masterFingerprint });
    return unsigned.raw.hex as string;
  };

  it('names each input by the wallet’s master fingerprint and its full path, as a hardware signer matches it', () => {
    const [input] = bitcoin.Psbt.fromHex(send('deadbeef')).data.inputs;

    expect(input.bip32Derivation).toHaveLength(1);
    const [origin] = input.bip32Derivation!;
    expect(origin.masterFingerprint.toString('hex')).toBe('deadbeef');
    expect(origin.path).toBe("m/84'/1'/0'/1/5");
    expect(origin.pubkey.toString('hex')).toBe(pubkeyAt(1, 5).toString('hex'));
  });

  it('marks an unknown master fingerprint as zero rather than another key’s', () => {
    const [input] = bitcoin.Psbt.fromHex(send()).data.inputs;

    expect(input.bip32Derivation![0].masterFingerprint.toString('hex')).toBe('00000000');
    expect(input.bip32Derivation![0].path).toBe("m/84'/1'/0'/1/5");
  });

  it('is still signed by the software signer at that path', () => {
    const signed = signPsbtWithMnemonic(send('deadbeef'), PHRASE, 'Testnet');

    expect(signerKeys(signed)).toEqual([pubkeyAt(1, 5).toString('hex')]);
  });

  it('reads the master fingerprint as BIP32 defines it', () => {
    const root = deriveBitcoinRootKey('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');

    expect(bitcoinMasterFingerprint(root)).toBe('73c5da0a');
  });
});
