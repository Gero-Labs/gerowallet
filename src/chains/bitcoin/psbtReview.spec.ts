import { describe, expect, it } from 'vitest';
import { Psbt, address, networks } from 'bitcoinjs-lib';
import { createRequire } from 'node:module';
import { reviewPsbt } from './psbtReview';

// bitcoinjs-lib is externalized to Node by Vitest; its Buffer identity is native.
const { Buffer: NodeBuffer } = createRequire(import.meta.url)('node:buffer') as typeof import('node:buffer');

const p2wpkh = (byte: string) => NodeBuffer.from('0014' + byte.repeat(20), 'hex');
const addressOf = (byte: string) => address.fromOutputScript(p2wpkh(byte), networks.bitcoin);

const MINE = addressOf('aa');
const MY_CHANGE = addressOf('bb');
const SHOP = addressOf('cc');
const own = { receive: new Set([MINE]), change: new Set([MY_CHANGE]) };

/** One 100,000-sat input of mine paying 60,000 to the shop with 39,000 change: 1,000 fee. */
function payment() {
  return new Psbt()
    .addInput({ hash: '01'.repeat(32), index: 0, witnessUtxo: { script: p2wpkh('aa'), value: 100_000 } })
    .addOutput({ script: p2wpkh('cc'), value: 60_000 })
    .addOutput({ script: p2wpkh('bb'), value: 39_000 });
}

describe('reviewPsbt', () => {
  it('names each output, whose it is, what leaves the wallet and the fee', () => {
    const review = reviewPsbt(payment().toHex(), 'Mainnet', own);
    expect(review.inputCount).toBe(1);
    expect(review.outputs).toEqual([
      { address: SHOP, value: 60_000, owner: 'external' },
      { address: MY_CHANGE, value: 39_000, owner: 'change' },
    ]);
    expect(review.sending).toBe(60_000);
    expect(review.fee).toBe(1_000);
  });

  it('reads base64 as well as hex', () => {
    expect(reviewPsbt(payment().toBase64(), 'Mainnet', own).fee).toBe(1_000);
  });

  it('counts an output to an address it does not recognise as leaving the wallet', () => {
    const review = reviewPsbt(payment().toHex(), 'Mainnet', { receive: new Set(), change: new Set() });
    expect(review.sending).toBe(99_000);
  });

  it('marks a receive address of the wallet as its own', () => {
    const psbt = new Psbt()
      .addInput({ hash: '01'.repeat(32), index: 0, witnessUtxo: { script: p2wpkh('aa'), value: 50_000 } })
      .addOutput({ script: p2wpkh('aa'), value: 49_000 });
    const review = reviewPsbt(psbt.toHex(), 'Mainnet', own);
    expect(review.outputs[0].owner).toBe('own');
    expect(review.sending).toBe(0);
  });

  it('has no fee when an input does not say what it spends', () => {
    const psbt = payment().addInput({ hash: '02'.repeat(32), index: 1 });
    expect(reviewPsbt(psbt.toHex(), 'Mainnet', own).fee).toBeNull();
  });

  it('has no fee when the inputs it knows cover less than the outputs (others add theirs later)', () => {
    const listing = new Psbt()
      .addInput({ hash: '01'.repeat(32), index: 0, witnessUtxo: { script: p2wpkh('aa'), value: 546 } })
      .addOutput({ script: p2wpkh('aa'), value: 1_000_000 });
    expect(reviewPsbt(listing.toHex(), 'Mainnet', own).fee).toBeNull();
  });

  it('shows a data output without an address', () => {
    const psbt = payment().addOutput({ script: NodeBuffer.from('6a0568656c6c6f', 'hex'), value: 0 });
    const review = reviewPsbt(psbt.toHex(), 'Mainnet', own);
    expect(review.outputs[2]).toEqual({ address: null, value: 0, owner: 'external' });
  });

  it('reads testnet addresses on Testnet', () => {
    const review = reviewPsbt(payment().toHex(), 'Testnet', own);
    expect(review.outputs[0].address).toBe(address.fromOutputScript(p2wpkh('cc'), networks.testnet));
  });
});
