// The approval view and the signer share one decode of a dApp's PSBT: what
// leaves the wallet, every output, and exactly which inputs get signed.
import { describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { createRequire } from 'node:module';

// bitcoinjs-lib is externalized to Node by Vitest and checks buffers against Node's
// Buffer, while the sources get the polyfill (see bitcoinSigner.spec.ts).
vi.mock('vite-plugin-node-polyfills/shims/buffer', async () => {
  const { createRequire: requireFrom } = await import('node:module');
  const { Buffer } = requireFrom(import.meta.url)('node:buffer');
  return { default: Buffer, Buffer };
});

import { bitcoinOwnAddresses, describePsbtProblem, reviewBitcoinPsbt, assertPsbtSignable } from './psbtReview';
import { satsToBtcString } from './btcAmount';
import { deriveBitcoinAccountXpub, deriveBitcoinRootKey } from './bitcoinKeyManager';

const { Buffer: NodeBuffer } = createRequire(import.meta.url)('node:buffer') as typeof import('node:buffer');

// Fixed test vectors — never used to hold funds.
const PHRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const OTHER_PHRASE = 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above';
const NETWORK = 'Testnet';
const XPUB = deriveBitcoinAccountXpub(PHRASE, NETWORK, 'segwit', 0);

const pubkeyAt = (chain: number, index: number, phrase = PHRASE) =>
  NodeBuffer.from(deriveBitcoinRootKey(phrase).derive(`m/84'/1'/0'/${chain}/${index}`).publicKey!);
const p2wpkh = (pubkey: Buffer) => bitcoin.payments.p2wpkh({ pubkey, network: bitcoin.networks.testnet });
const scriptOf = (pubkey: Buffer) => p2wpkh(pubkey).output!;
const addressOf = (pubkey: Buffer) => p2wpkh(pubkey).address!;

const OWN_RECEIVE = pubkeyAt(0, 0);
const OWN_CHANGE = pubkeyAt(1, 0);
const FOREIGN = pubkeyAt(0, 0, OTHER_PHRASE);
const own = bitcoinOwnAddresses(XPUB, 'segwit', NETWORK);

interface InputSpec { pubkey: Buffer; value?: number; withValue?: boolean; sighashType?: number }
function psbtOf(inputs: InputSpec[], outputs: Array<{ script: Buffer; value: number }>): bitcoin.Psbt {
  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.testnet });
  inputs.forEach(({ pubkey, value = 10_000, withValue = true, sighashType }, i) => {
    psbt.addInput({
      hash: NodeBuffer.alloc(32, i + 1), index: 0,
      ...(withValue ? { witnessUtxo: { script: scriptOf(pubkey), value } } : {}),
      ...(sighashType !== undefined ? { sighashType } : {}),
    });
  });
  for (const out of outputs) psbt.addOutput(out);
  return psbt;
}

/** The txid a PSBT input of `psbtOf` spends (its hash is the fill byte, reversed). */
const txidOfInput = (i: number) => NodeBuffer.alloc(32, i + 1).reverse().toString('hex');

describe('reviewBitcoinPsbt', () => {
  it('shows a drain: every wallet coin to one foreign output, all of it leaving the wallet', () => {
    const psbt = psbtOf(
      [{ pubkey: OWN_RECEIVE, value: 40_000 }, { pubkey: OWN_CHANGE, value: 60_000 }],
      [{ script: scriptOf(FOREIGN), value: 99_000 }],
    );

    const review = reviewBitcoinPsbt(psbt.toHex(), { network: NETWORK, ownAddresses: own });

    expect(review.problems).toEqual([]);
    expect(review.signIndices).toEqual([0, 1]);
    expect(review.outputs).toEqual([{ index: 0, address: addressOf(FOREIGN), valueSats: 99_000n, own: false }]);
    expect(review.spentSats).toBe(100_000n);
    expect(review.receivedSats).toBe(0n);
    expect(review.netSats).toBe(100_000n);
    expect(review.feeSats).toBe(1_000n);
  });

  it('counts change back to the wallet and accepts base64', () => {
    const psbt = psbtOf([{ pubkey: OWN_RECEIVE, value: 50_000 }], [
      { script: scriptOf(FOREIGN), value: 20_000 },
      { script: scriptOf(OWN_CHANGE), value: 29_500 },
    ]);

    const review = reviewBitcoinPsbt(psbt.toBase64(), { network: NETWORK, ownAddresses: own });

    expect(review.outputs.map((o) => o.own)).toEqual([false, true]);
    expect(review.netSats).toBe(20_500n);
    expect(review.feeSats).toBe(500n);
  });

  it('signs only the wallet’s inputs, and only the ones toSignInputs lists', () => {
    const psbt = psbtOf(
      [{ pubkey: OWN_RECEIVE }, { pubkey: FOREIGN }, { pubkey: OWN_CHANGE }],
      [{ script: scriptOf(FOREIGN), value: 29_000 }],
    );

    const all = reviewBitcoinPsbt(psbt, { network: NETWORK, ownAddresses: own });
    expect(all.signIndices).toEqual([0, 2]);
    expect(all.inputs.map((i) => i.own)).toEqual([true, false, true]);

    const listed = reviewBitcoinPsbt(psbt, { network: NETWORK, ownAddresses: own, signOptions: { toSignInputs: [{ index: 2 }] } });
    expect(listed.problems).toEqual([]);
    expect(listed.signIndices).toEqual([2]);
    expect(listed.spentSats).toBe(10_000n);

    // WalletConnect sends the list bare.
    expect(reviewBitcoinPsbt(psbt, { network: NETWORK, ownAddresses: own, signOptions: [{ index: 0, address: addressOf(OWN_RECEIVE) }] }).signIndices)
      .toEqual([0]);
  });

  it('refuses a toSignInputs entry the wallet cannot honour', () => {
    const psbt = psbtOf([{ pubkey: OWN_RECEIVE }, { pubkey: FOREIGN }], [{ script: scriptOf(FOREIGN), value: 19_000 }]);
    const codes = (signOptions: unknown) =>
      reviewBitcoinPsbt(psbt, { network: NETWORK, ownAddresses: own, signOptions }).problems.map((p) => p.code);

    expect(codes({ toSignInputs: [{ index: 1 }] })).toEqual(['notOwn']);
    expect(codes({ toSignInputs: [{ index: 5 }] })).toEqual(['badIndex']);
    expect(codes({ toSignInputs: [{ index: 0, address: addressOf(OWN_CHANGE) }] })).toEqual(['addressMismatch']);
    expect(codes({ toSignInputs: [{ index: 0, sighashTypes: [bitcoin.Transaction.SIGHASH_NONE] }] })).toEqual(['unsupportedSighash']);
    expect(codes({ toSignInputs: [{ index: 0, sighashTypes: [bitcoin.Transaction.SIGHASH_ALL] }] })).toEqual([]);
    expect(codes({ toSignInputs: 'all' })).toEqual(['invalidToSignInputs']);
  });

  it('refuses an own input that asks for a non-ALL sighash in the PSBT itself', () => {
    const anyoneCanPay = bitcoin.Transaction.SIGHASH_ALL | bitcoin.Transaction.SIGHASH_ANYONECANPAY;
    const psbt = psbtOf([{ pubkey: OWN_RECEIVE, sighashType: anyoneCanPay }], [{ script: scriptOf(FOREIGN), value: 9_000 }]);

    expect(reviewBitcoinPsbt(psbt, { network: NETWORK, ownAddresses: own }).problems).toEqual([{ code: 'unsupportedSighash', index: 0 }]);
  });

  it('refuses an own input with no value, and one whose stated value differs from the wallet’s coin', () => {
    const noValue = psbtOf([{ pubkey: OWN_RECEIVE, withValue: false }], [{ script: scriptOf(FOREIGN), value: 9_000 }]);
    const ownUtxos = [{ txHash: txidOfInput(0), index: 0, value: 10_000n }];

    const missing = reviewBitcoinPsbt(noValue, { network: NETWORK, ownAddresses: own, ownUtxos });
    expect(missing.inputs[0].own).toBe(true); // known from the wallet's coins even without a script
    expect(missing.problems).toEqual([{ code: 'missingValue', index: 0 }]);
    expect(missing.feeSats).toBeNull();

    const lying = psbtOf([{ pubkey: OWN_RECEIVE, value: 1_000 }], [{ script: scriptOf(FOREIGN), value: 900 }]);
    expect(reviewBitcoinPsbt(lying, { network: NETWORK, ownAddresses: own, ownUtxos: [{ txHash: txidOfInput(0), index: 0, value: '50000' }] }).problems)
      .toEqual([{ code: 'valueMismatch', index: 0 }]);
  });

  it('leaves the fee unknown when another party’s input carries no value, without blocking', () => {
    const psbt = psbtOf([{ pubkey: OWN_RECEIVE }, { pubkey: FOREIGN, withValue: false }], [{ script: scriptOf(FOREIGN), value: 9_000 }]);

    const review = reviewBitcoinPsbt(psbt, { network: NETWORK, ownAddresses: own });
    expect(review.problems).toEqual([]);
    expect(review.feeSats).toBeNull();
  });

  it('has nothing to sign when no input is the wallet’s, and cannot read garbage', () => {
    const foreignOnly = psbtOf([{ pubkey: FOREIGN }], [{ script: scriptOf(FOREIGN), value: 9_000 }]);
    expect(reviewBitcoinPsbt(foreignOnly, { network: NETWORK, ownAddresses: own }).problems).toEqual([{ code: 'nothingToSign' }]);
    expect(reviewBitcoinPsbt('not-a-psbt', { network: NETWORK, ownAddresses: own }).problems).toEqual([{ code: 'unparseable' }]);
  });

  it('turns a problem into a refusal', () => {
    const foreignOnly = psbtOf([{ pubkey: FOREIGN }], [{ script: scriptOf(FOREIGN), value: 9_000 }]);
    const review = reviewBitcoinPsbt(foreignOnly, { network: NETWORK, ownAddresses: own });
    expect(() => assertPsbtSignable(review)).toThrow(describePsbtProblem({ code: 'nothingToSign' }));
  });
});

describe('bitcoinOwnAddresses', () => {
  it('covers the account’s receive and change addresses and the synced coins', () => {
    const set = bitcoinOwnAddresses(XPUB, 'segwit', NETWORK, [{ address: 'tb1q-synced' }]);
    expect(set.has(addressOf(OWN_RECEIVE))).toBe(true);
    expect(set.has(addressOf(OWN_CHANGE))).toBe(true);
    expect(set.has('tb1q-synced')).toBe(true);
    expect(set.has(addressOf(FOREIGN))).toBe(false);
  });
});

describe('satsToBtcString', () => {
  it('formats exactly', () => {
    expect(satsToBtcString(123_456_789n)).toBe('1.23456789');
    expect(satsToBtcString(2_100_000_000_000_001n)).toBe('21000000.00000001');
    expect(satsToBtcString(-5n)).toBe('-0.00000005');
  });
});
