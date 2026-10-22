// A Ledger signs a Bitcoin PSBT through hw-app-btc's signPsbtBuffer (issue 1324): it
// needs the account path, the address format and the wallet's own addresses, and it
// answers with a PSBT v2 whose signatures go back into the PSBT the user approved.
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

import { deserializePsbt } from '@ledgerhq/hw-app-btc/lib/signPsbt/parsePsbt';
import { populateMissingBip32Derivations } from '@ledgerhq/hw-app-btc/lib/signPsbt/derivationPopulation';
import { ledgerAddressFormat, ledgerSignPsbtOptions, mergeLedgerSignatures, parseBitcoinPsbt } from './ledgerPsbt';
import { deriveBitcoinAccountXpub, deriveBitcoinRootKey } from './bitcoinKeyManager';
import { signPsbtWithMnemonic } from './bitcoinSigner';

const { Buffer: NodeBuffer } = createRequire(import.meta.url)('node:buffer') as typeof import('node:buffer');

// Fixed test vector — never used to hold funds.
const PHRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const HARDENED = 0x80000000;
const MASTER_FP = NodeBuffer.from('c0ffee42', 'hex');

const keyAt = (purpose: number, account: number, chain: number, index: number) =>
  NodeBuffer.from(deriveBitcoinRootKey(PHRASE).derive(`m/${purpose}'/1'/${account}'/${chain}/${index}`).publicKey!);
const segwitScript = (pubkey: Buffer) => bitcoin.payments.p2wpkh({ pubkey }).output!;
const taprootScript = (pubkey: Buffer) => bitcoin.payments.p2tr({ internalPubkey: pubkey.subarray(1, 33) }).output!;

/** A PSBT spending one 10 000 sat output at each script, naming no derivation (as a dApp builds it). */
function spending(...scripts: Buffer[]): bitcoin.Psbt {
  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.testnet });
  scripts.forEach((script, i) => psbt.addInput({ hash: NodeBuffer.alloc(32, i + 1), index: 0, witnessUtxo: { script, value: 10_000 } }));
  return psbt.addOutput({ script: scripts[0], value: 9_000 * scripts.length });
}

/** What the device returns: the PSBT as v2, carrying the signatures `signed` holds. */
function deviceAnswer(unsigned: bitcoin.Psbt, signed: bitcoin.Psbt): Buffer {
  const v2 = deserializePsbt(unsigned.toBuffer());
  signed.data.inputs.forEach((input, i) => {
    input.partialSig?.forEach(({ pubkey, signature }) => v2.setInputPartialSig(i, pubkey, signature));
    if (input.tapKeySig) v2.setInputTapKeySig(i, input.tapKeySig);
  });
  return v2.serialize();
}

describe('ledgerSignPsbtOptions', () => {
  it('names the account path and address format, and never finalizes', () => {
    const xpub = deriveBitcoinAccountXpub(PHRASE, 'Testnet', 'segwit', 1);

    const options = ledgerSignPsbtOptions({ xpub, network: 'Testnet', addressType: 'segwit', accountIndex: 1 });

    expect(options).toMatchObject({ finalizePsbt: false, accountPath: "m/84'/1'/1'", addressFormat: 'bech32' });
    expect(options.knownAddressDerivations.size).toBe(40);
  });

  it('maps each address type to the device’s address format', () => {
    expect(ledgerAddressFormat('segwit')).toBe('bech32');
    expect(ledgerAddressFormat('taproot')).toBe('bech32m');
    expect(ledgerAddressFormat('legacy')).toBe('legacy');
    expect(() => ledgerAddressFormat('p2sh-segwit')).toThrow('Unknown address type');
  });

  it('lets the device find a later receive and a change address of the account by their script', async () => {
    const xpub = deriveBitcoinAccountXpub(PHRASE, 'Testnet', 'segwit', 1);
    const receive = keyAt(84, 1, 0, 7);
    const change = keyAt(84, 1, 1, 3);
    const options = ledgerSignPsbtOptions({ xpub, network: 'Testnet', addressType: 'segwit', accountIndex: 1 });
    const psbt = deserializePsbt(spending(segwitScript(receive), segwitScript(change)).toBuffer());

    await populateMissingBip32Derivations({} as never, psbt, 2, MASTER_FP, [84 + HARDENED, 1 + HARDENED, 1 + HARDENED], options.knownAddressDerivations);

    expect(psbt.getInputBip32Derivation(0, receive)).toEqual({ masterFingerprint: MASTER_FP, path: [84 + HARDENED, 1 + HARDENED, 1 + HARDENED, 0, 7] });
    expect(psbt.getInputBip32Derivation(1, change)).toEqual({ masterFingerprint: MASTER_FP, path: [84 + HARDENED, 1 + HARDENED, 1 + HARDENED, 1, 3] });
  });

  it('lets the device find a Taproot address by its tweaked output key', async () => {
    const xpub = deriveBitcoinAccountXpub(PHRASE, 'Testnet', 'taproot');
    const key = keyAt(86, 0, 0, 2);
    const options = ledgerSignPsbtOptions({ xpub, network: 'Testnet', addressType: 'taproot', accountIndex: 0 });
    const psbt = deserializePsbt(spending(taprootScript(key)).toBuffer());

    await populateMissingBip32Derivations({} as never, psbt, 1, MASTER_FP, [86 + HARDENED, 1 + HARDENED, HARDENED], options.knownAddressDerivations);

    expect(psbt.getInputTapBip32Derivation(0, key.subarray(1, 33))).toMatchObject({ path: [86 + HARDENED, 1 + HARDENED, HARDENED, 0, 2] });
  });
});

describe('mergeLedgerSignatures', () => {
  it('puts the device’s signatures into the approved PSBT, which then finalizes', () => {
    const unsigned = spending(segwitScript(keyAt(84, 0, 0, 1)), segwitScript(keyAt(84, 0, 1, 0)));
    const answer = deviceAnswer(unsigned, signPsbtWithMnemonic(unsigned.toHex(), PHRASE, 'Testnet'));

    const merged = mergeLedgerSignatures(parseBitcoinPsbt(unsigned.toHex(), 'Testnet'), answer);

    expect(merged.data.globalMap.unsignedTx.toBuffer().equals(unsigned.data.globalMap.unsignedTx.toBuffer())).toBe(true);
    [0, 1].forEach((i) => expect(merged.validateSignaturesOfInput(i, (pubkey, hash, signature) => ecc.verify(hash, pubkey, signature))).toBe(true));
    expect(() => merged.finalizeAllInputs().extractTransaction()).not.toThrow();
  });

  it('carries a Taproot key-path signature', () => {
    const unsigned = spending(taprootScript(keyAt(86, 0, 0, 0)));
    const answer = deviceAnswer(unsigned, signPsbtWithMnemonic(unsigned.toHex(), PHRASE, 'Testnet', 'taproot'));

    const merged = mergeLedgerSignatures(parseBitcoinPsbt(unsigned.toBase64(), 'Testnet'), answer);

    expect(merged.data.inputs[0].tapKeySig).toHaveLength(64);
    expect(() => merged.finalizeAllInputs().extractTransaction()).not.toThrow();
  });

  it('refuses an answer the device signed nothing in', () => {
    const unsigned = spending(segwitScript(keyAt(84, 0, 0, 1)));

    expect(() => mergeLedgerSignatures(unsigned, deviceAnswer(unsigned, unsigned))).toThrow('did not sign');
  });

  it('refuses an answer for a transaction with other inputs', () => {
    const unsigned = spending(segwitScript(keyAt(84, 0, 0, 1)));
    const other = spending(segwitScript(keyAt(84, 0, 0, 1)), segwitScript(keyAt(84, 0, 0, 2)));

    expect(() => mergeLedgerSignatures(unsigned, deviceAnswer(other, other))).toThrow('does not match');
  });
});
