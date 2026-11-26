import { describe, expect, it } from 'vitest';
import { buildBitcoinTxFlow, isCoinbaseInput } from './bitcoinTxFlow';

const OWN = 'bc1qownaddress0000000000000000000000000000';
const CHANGE = 'bc1qownchange00000000000000000000000000000';
const OTHER = 'bc1qsomeoneelse000000000000000000000000000';
const TAPROOT = 'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297';
const P2WSH = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';
const own = new Set([OWN, CHANGE]);

const ZERO_TXID = '0'.repeat(64);

describe('buildBitcoinTxFlow', () => {
  it('draws a send with change back to the own wallet and the fee as a sink', () => {
    const model = buildBitcoinTxFlow({
      fee: 1_410,
      inputs: [
        { address: OWN, value: 150_000, txid: 'a'.repeat(64), vout: 0 },
        { address: OWN, value: 50_000, txid: 'b'.repeat(64), vout: 3 },
      ],
      outputs: [
        { address: OTHER, value: 120_000 },
        { address: CHANGE, value: 78_590 },
      ],
    }, own);

    expect(model).not.toBeNull();
    expect(model!.inputs).toEqual([
      { key: `in:own:${OWN}`, kind: 'own', address: OWN, lovelace: 200_000, count: 2, tokens: [] },
    ]);
    expect(model!.outputs.map((node) => [node.kind, node.address, node.lovelace])).toEqual([
      ['other', OTHER, 120_000],
      ['own', CHANGE, 78_590],
      ['fee', '', 1_410],
    ]);
    // Nothing Cardano-only
    expect(model!.collateralCount).toBe(0);
    expect(model!.referenceInputCount).toBe(0);
    const kinds = [...model!.inputs, ...model!.outputs].map((node) => node.kind);
    for (const kind of ['rewards', 'refund', 'deposit', 'donation', 'script']) expect(kinds).not.toContain(kind);
    expect([...model!.inputs, ...model!.outputs].every((node) => node.tokens.length === 0)).toBe(true);
  });

  it('balances: inputs equal outputs plus fee', () => {
    const model = buildBitcoinTxFlow({
      fee: 500,
      inputs: [{ address: OTHER, value: 10_000, txid: 'c'.repeat(64), vout: 1 }],
      outputs: [{ address: OWN, value: 9_500 }],
    }, own)!;
    const sum = (nodes: { lovelace: number }[]) => nodes.reduce((total, node) => total + node.lovelace, 0);
    expect(sum(model.inputs)).toBe(sum(model.outputs));
  });

  it('draws a coinbase transaction from newly mined coins, with no fee', () => {
    const model = buildBitcoinTxFlow({
      fee: 0,
      // What the parser makes of an Esplora coinbase vin: no prevout, so no address and no value
      inputs: [{ address: '', value: 0, txid: ZERO_TXID, vout: 0xffffffff }],
      outputs: [
        { address: OWN, value: 312_500_000 },
        { address: '', value: 0 },
      ],
    }, own)!;

    expect(model.inputs).toEqual([
      { key: 'src:coinbase', kind: 'coinbase', address: '', lovelace: 312_500_000, count: 1, tokens: [] },
    ]);
    expect(model.outputs.map((node) => node.kind)).toEqual(['own', 'data']);
  });

  it('treats Taproot and P2WSH addresses as ordinary addresses, never contracts', () => {
    const model = buildBitcoinTxFlow({
      fee: 300,
      inputs: [{ address: TAPROOT, value: 5_300, txid: 'd'.repeat(64), vout: 0 }],
      outputs: [{ address: P2WSH, value: 5_000 }],
    }, own)!;
    expect(model.inputs[0].kind).toBe('other');
    expect(model.outputs[0].kind).toBe('other');
  });

  it('groups repeated addresses into one node with a count', () => {
    const model = buildBitcoinTxFlow({
      fee: 100,
      inputs: [{ address: OTHER, value: 3_100, txid: 'e'.repeat(64), vout: 0 }],
      outputs: [{ address: OWN, value: 1_000 }, { address: OWN, value: 2_000 }],
    }, own)!;
    expect(model.outputs[0]).toMatchObject({ kind: 'own', count: 2, lovelace: 3_000 });
  });

  it('infers the fee from the values when the record has none', () => {
    const model = buildBitcoinTxFlow({
      inputs: [{ address: OTHER, value: 10_000, txid: 'f'.repeat(64), vout: 0 }],
      outputs: [{ address: OWN, value: 9_000 }],
    }, own)!;
    expect(model.outputs.at(-1)).toMatchObject({ kind: 'fee', lovelace: 1_000 });
  });

  it('draws nothing without outputs, or without inputs that are not a coinbase', () => {
    expect(buildBitcoinTxFlow(null, own)).toBeNull();
    expect(buildBitcoinTxFlow({ inputs: [{ address: OWN, value: 1, txid: 'a'.repeat(64), vout: 0 }], outputs: [] }, own)).toBeNull();
    expect(buildBitcoinTxFlow({ inputs: [], outputs: [{ address: OWN, value: 1 }] }, own)).toBeNull();
  });
});

describe('isCoinbaseInput', () => {
  it('recognises the null outpoint and never an input with an address', () => {
    expect(isCoinbaseInput({ address: '', txid: ZERO_TXID, vout: 0xffffffff })).toBe(true);
    expect(isCoinbaseInput({ address: '', txid: '' })).toBe(true);
    expect(isCoinbaseInput({ address: OWN, txid: ZERO_TXID, vout: 0xffffffff })).toBe(false);
    expect(isCoinbaseInput({ address: '', txid: 'a'.repeat(64), vout: 1 })).toBe(false);
  });
});
