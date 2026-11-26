import { describe, expect, it } from 'vitest';
import { fromHex } from './cbor';
import type { DecodeContext } from './context';
import { decodeInputSet, proveInputs } from './inputs';
import { Refusals } from './refusals';
import { array, bytes, FUND_TX, FUND_TX_ID, fundSource, inputSet, PAYMENT_TX, uint, VAULT_ADDRESS } from './__fixtures__/vaultTxs';

const ctx = (): DecodeContext => ({ networkId: 0, refusals: new Refusals() });

describe('decodeInputSet', () => {
  it('reads references in body order, as a list or a tag 258 set', () => {
    expect(decodeInputSet(fromHex(inputSet(1, 0)), 'body.0')).toEqual([
      { txId: FUND_TX_ID, index: 1, path: 'body.0[0]' },
      { txId: FUND_TX_ID, index: 0, path: 'body.0[1]' },
    ]);
    expect(decodeInputSet(fromHex(`d90102${inputSet(3)}`), 'body.18')).toEqual([{ txId: FUND_TX_ID, index: 3, path: 'body.18[0]' }]);
  });

  it('refuses a repeat, a short id and an index above 16 bits', () => {
    expect(() => decodeInputSet(fromHex(inputSet(0, 0)), 'body.0')).toThrow(/duplicate_element/);
    expect(() => decodeInputSet(fromHex(array(array(bytes('aa'.repeat(31)), uint(0)))), 'body.0')).toThrow(/expected_32_bytes/);
    expect(() => decodeInputSet(fromHex(array(array(bytes(FUND_TX_ID), uint(65_536)))), 'body.0')).toThrow(/input_index/);
  });
});

describe('proveInputs', () => {
  const refs = decodeInputSet(fromHex(inputSet(0, 2)), 'body.0');

  it('reads each output from the creating transaction that hashes to its id', async () => {
    const c = ctx();
    const proven = await proveInputs(refs, [fundSource()], c);
    expect(c.refusals.list).toEqual([]);
    expect(proven.get(`${FUND_TX_ID}#0`)?.address.hex).toBe(VAULT_ADDRESS);
    expect(proven.get(`${FUND_TX_ID}#2`)?.value.lovelace).toBe(5_000_000n);
  });

  it('asks a source only for what is still missing, once per transaction', async () => {
    const asked: string[][] = [];
    const source = async (hashes: string[]) => {
      asked.push(hashes);
      return new Map([[FUND_TX_ID, FUND_TX]]);
    };
    await proveInputs(refs, [source, source], ctx());
    expect(asked).toEqual([[FUND_TX_ID]]);
  });

  it('ignores CBOR of another transaction served under the id', async () => {
    const c = ctx();
    const proven = await proveInputs(refs, [async () => new Map([[FUND_TX_ID, PAYMENT_TX]])], c);
    expect(proven.size).toBe(0);
    expect(c.refusals.list).toEqual([
      { code: 'input_unresolved', path: 'body.0[0]', detail: 'wrong-transaction' },
      { code: 'input_unresolved', path: 'body.0[1]', detail: 'wrong-transaction' },
    ]);
  });

  it('reports undecodable CBOR', async () => {
    const c = ctx();
    await proveInputs(refs.slice(0, 1), [async () => new Map([[FUND_TX_ID, 'deadbeef']])], c);
    expect(c.refusals.list).toEqual([{ code: 'input_unresolved', path: 'body.0[0]', detail: 'undecodable' }]);
  });
});
