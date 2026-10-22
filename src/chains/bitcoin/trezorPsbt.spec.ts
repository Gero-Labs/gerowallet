// A Trezor signs a Bitcoin PSBT through TrezorConnect.signTransaction, which takes the
// transaction's inputs and outputs with full paths, not a PSBT (issue 1325). It answers
// with the signed transaction, whose signatures go back into the PSBT the user approved.
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

import { getBitcoinNetwork as trezorNetwork, parseCoinsJson } from '@trezor/connect/lib/data/coinInfo';
import { validateTrezorInputs, validateTrezorOutputs } from '@trezor/connect/lib/api/bitcoin';
import coins from '@trezor/connect-common/files/coins.json';
import { mergeTrezorSignatures, parseBitcoinPsbt, trezorSignTransactionParams } from './trezorPsbt';
import { deriveBitcoinAccountXpub, deriveBitcoinAddress, deriveBitcoinRootKey } from './bitcoinKeyManager';
import { signPsbtWithMnemonic } from './bitcoinSigner';

const { Buffer: NodeBuffer } = createRequire(import.meta.url)('node:buffer') as typeof import('node:buffer');

parseCoinsJson(coins);

// Fixed test vectors — never used to hold funds.
const PHRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const OTHER_PHRASE = 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above';
const FOREIGN = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';

const keyAt = (purpose: number, coin: number, account: number, chain: number, index: number, phrase = PHRASE) =>
  NodeBuffer.from(deriveBitcoinRootKey(phrase).derive(`m/${purpose}'/${coin}'/${account}'/${chain}/${index}`).publicKey!);
const segwit = (pubkey: Buffer) => bitcoin.payments.p2wpkh({ pubkey, network: bitcoin.networks.testnet }).output!;
const taproot = (pubkey: Buffer) => bitcoin.payments.p2tr({ internalPubkey: pubkey.subarray(1, 33) }).output!;

const testnetAccount = (accountIndex = 0) => ({
  xpub: deriveBitcoinAccountXpub(PHRASE, 'Testnet', 'segwit', accountIndex), network: 'Testnet', addressType: 'segwit', accountIndex,
});

/** The device: signs the PSBT with the account's key and answers with the signed transaction. */
function deviceAnswer(unsigned: bitcoin.Psbt, addressType = 'segwit', network = 'Testnet', accountIndex = 0): string {
  const signed = signPsbtWithMnemonic(unsigned.toHex(), PHRASE, network, addressType, accountIndex);
  return signed.finalizeAllInputs().extractTransaction().toHex();
}

describe('trezorSignTransactionParams', () => {
  /** Spends a later receive coin and a change coin of account 1; pays someone, change, and a note. */
  function send(): bitcoin.Psbt {
    return new bitcoin.Psbt({ network: bitcoin.networks.testnet })
      .setVersion(2).setLocktime(120)
      .addInput({ hash: '11'.repeat(32), index: 3, sequence: 0xfffffffd, witnessUtxo: { script: segwit(keyAt(84, 1, 1, 0, 7)), value: 30_000 } })
      .addInput({ hash: '22'.repeat(32), index: 0, witnessUtxo: { script: segwit(keyAt(84, 1, 1, 1, 3)), value: 20_000 } })
      .addOutput({ address: FOREIGN, value: 25_000 })
      .addOutput({ script: segwit(keyAt(84, 1, 1, 1, 4)), value: 24_000 })
      .addOutput({ script: bitcoin.payments.embed({ data: [NodeBuffer.from('gero')] }).output!, value: 0 });
  }

  it('names each input by its full path, and the change output by its path so the device hides it', () => {
    const params = trezorSignTransactionParams(send(), testnetAccount(1));

    expect(params).toMatchObject({ coin: 'test', version: 2, locktime: 120, serialize: true });
    expect(params).not.toHaveProperty('psbt');
    expect(params.inputs).toEqual([
      { address_n: "m/84'/1'/1'/0/7", prev_hash: '11'.repeat(32), prev_index: 3, amount: '30000', sequence: 0xfffffffd, script_type: 'SPENDWITNESS' },
      { address_n: "m/84'/1'/1'/1/3", prev_hash: '22'.repeat(32), prev_index: 0, amount: '20000', sequence: 0xffffffff, script_type: 'SPENDWITNESS' },
    ]);
    expect(params.outputs).toEqual([
      { address: FOREIGN, amount: '25000', script_type: 'PAYTOADDRESS' },
      { address_n: "m/84'/1'/1'/1/4", amount: '24000', script_type: 'PAYTOWITNESS' },
      { script_type: 'PAYTOOPRETURN', amount: '0', op_return_data: NodeBuffer.from('gero').toString('hex') },
    ]);
  });

  it('is a request Trezor Connect accepts', () => {
    const params = trezorSignTransactionParams(send(), testnetAccount(1));
    const coin = trezorNetwork(params.coin)!;

    expect(validateTrezorInputs(params.inputs, coin)[0].address_n).toEqual([0x80000054, 0x80000001, 0x80000001, 0, 7]);
    expect(validateTrezorOutputs(params.outputs, coin)).toHaveLength(3);
  });

  it('shows a payment to the wallet’s own receive address rather than hiding it as change', () => {
    const psbt = new bitcoin.Psbt({ network: bitcoin.networks.testnet })
      .addInput({ hash: '11'.repeat(32), index: 0, witnessUtxo: { script: segwit(keyAt(84, 1, 0, 0, 0)), value: 30_000 } })
      .addOutput({ script: segwit(keyAt(84, 1, 0, 0, 1)), value: 29_000 });

    const [output] = trezorSignTransactionParams(psbt, testnetAccount()).outputs;

    expect(output).toEqual({ address: deriveBitcoinAddress(testnetAccount().xpub, 'Testnet', 'segwit', 0, 1), amount: '29000', script_type: 'PAYTOADDRESS' });
  });

  it('uses the Taproot script types and the mainnet coin on a mainnet Taproot account', () => {
    const xpub = deriveBitcoinAccountXpub(PHRASE, 'Mainnet', 'taproot');
    const psbt = new bitcoin.Psbt()
      .addInput({ hash: '11'.repeat(32), index: 0, witnessUtxo: { script: taproot(keyAt(86, 0, 0, 0, 2)), value: 30_000 } })
      .addOutput({ script: taproot(keyAt(86, 0, 0, 1, 0)), value: 29_000 });

    const params = trezorSignTransactionParams(psbt, { xpub, network: 'Mainnet', addressType: 'taproot', accountIndex: 0 });

    expect(params.coin).toBe('btc');
    expect(params.inputs[0]).toMatchObject({ address_n: "m/86'/0'/0'/0/2", script_type: 'SPENDTAPROOT' });
    expect(params.outputs[0]).toMatchObject({ address_n: "m/86'/0'/0'/1/0", script_type: 'PAYTOTAPROOT' });
  });

  it('reads a legacy input’s amount from its previous transaction', () => {
    const xpub = deriveBitcoinAccountXpub(PHRASE, 'Testnet', 'legacy');
    const previous = new bitcoin.Transaction();
    previous.addInput(NodeBuffer.alloc(32, 9), 0);
    previous.addOutput(bitcoin.payments.p2pkh({ pubkey: keyAt(44, 1, 0, 0, 5) }).output!, 41_000);
    const psbt = new bitcoin.Psbt({ network: bitcoin.networks.testnet })
      .addInput({ hash: previous.getId(), index: 0, nonWitnessUtxo: previous.toBuffer() })
      .addOutput({ address: FOREIGN, value: 40_000 });

    const [input] = trezorSignTransactionParams(psbt, { xpub, network: 'Testnet', addressType: 'legacy', accountIndex: 0 }).inputs;

    expect(input).toMatchObject({ address_n: "m/44'/1'/0'/0/5", amount: '41000', prev_hash: previous.getId(), script_type: 'SPENDADDRESS' });
  });

  it('refuses a coin the wallet does not hold, which the device cannot sign', () => {
    const psbt = new bitcoin.Psbt({ network: bitcoin.networks.testnet })
      .addInput({ hash: '11'.repeat(32), index: 0, witnessUtxo: { script: segwit(keyAt(84, 1, 0, 0, 0, OTHER_PHRASE)), value: 30_000 } })
      .addOutput({ address: FOREIGN, value: 29_000 });

    expect(() => trezorSignTransactionParams(psbt, testnetAccount())).toThrow('Input 0 does not spend a coin of this wallet');
  });
});

describe('mergeTrezorSignatures', () => {
  const spend = (script: Buffer, network = bitcoin.networks.testnet) => new bitcoin.Psbt({ network })
    .addInput({ hash: '33'.repeat(32), index: 1, witnessUtxo: { script, value: 50_000 } })
    .addOutput({ script, value: 49_000 });

  it('puts the device’s signatures into the approved PSBT, which then finalizes to the device’s transaction', () => {
    const unsigned = spend(segwit(keyAt(84, 1, 0, 1, 2)));
    const answer = deviceAnswer(unsigned);

    const merged = mergeTrezorSignatures(parseBitcoinPsbt(unsigned.toBase64(), 'Testnet'), answer);

    expect(merged.validateSignaturesOfInput(0, (pubkey, hash, signature) => ecc.verify(hash, pubkey, signature))).toBe(true);
    expect(merged.finalizeAllInputs().extractTransaction().toHex()).toBe(answer);
  });

  it('carries a Taproot key-path signature', () => {
    const unsigned = spend(taproot(keyAt(86, 0, 0, 0, 0)), bitcoin.networks.bitcoin);
    const answer = deviceAnswer(unsigned, 'taproot', 'Mainnet');

    const merged = mergeTrezorSignatures(parseBitcoinPsbt(unsigned.toHex(), 'Mainnet'), answer);

    expect(merged.data.inputs[0].tapKeySig).toHaveLength(64);
    expect(merged.finalizeAllInputs().extractTransaction().toHex()).toBe(answer);
  });

  it('carries a legacy input’s signature from its scriptSig', () => {
    const script = bitcoin.payments.p2pkh({ pubkey: keyAt(44, 1, 0, 0, 1) }).output!;
    const previous = new bitcoin.Transaction();
    previous.addInput(NodeBuffer.alloc(32, 9), 0);
    previous.addOutput(script, 41_000);
    const unsigned = new bitcoin.Psbt({ network: bitcoin.networks.testnet })
      .addInput({ hash: previous.getId(), index: 0, nonWitnessUtxo: previous.toBuffer() })
      .addOutput({ script, value: 40_000 });
    const answer = deviceAnswer(unsigned, 'legacy');

    const merged = mergeTrezorSignatures(parseBitcoinPsbt(unsigned.toHex(), 'Testnet'), answer);

    expect(merged.finalizeAllInputs().extractTransaction().toHex()).toBe(answer);
  });

  it('refuses a signed transaction other than the approved one', () => {
    const script = segwit(keyAt(84, 1, 0, 0, 0));
    const changed = new bitcoin.Psbt({ network: bitcoin.networks.testnet })
      .addInput({ hash: '33'.repeat(32), index: 1, witnessUtxo: { script, value: 50_000 } })
      .addOutput({ script, value: 40_000 });

    expect(() => mergeTrezorSignatures(spend(script), deviceAnswer(changed))).toThrow('does not match');
  });

  it('refuses an answer that leaves an input unsigned', () => {
    const unsigned = spend(segwit(keyAt(84, 1, 0, 0, 0)));

    expect(() => mergeTrezorSignatures(unsigned, unsigned.data.globalMap.unsignedTx.toBuffer().toString('hex'))).toThrow('did not sign input 0');
  });
});
