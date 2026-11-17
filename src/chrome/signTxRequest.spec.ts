// The transaction a SIGN_TX request signs is parsed from its CBOR only: the signed id and the
// bodies the guards read must belong together.
import { describe, expect, it } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { transactionFromSignRequest } from './signTxRequest';

const OWN = 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp';

function cbor(coins: bigint): { cbor: string; id: string } {
  const tx = Serialization.Transaction.fromCore({
    id: Cardano.TransactionId('00'.repeat(32)),
    body: {
      inputs: [{ txId: Cardano.TransactionId('a1'.repeat(32)), index: 0 }],
      outputs: [{ address: Cardano.PaymentAddress(OWN), value: { coins } }],
      fee: 200_000n,
    },
    witness: { signatures: new Map() },
  });
  return { cbor: tx.toCbor(), id: tx.getId() };
}

describe('transactionFromSignRequest', () => {
  it('parses the CBOR, and the id is that of its body', () => {
    const { cbor: txCbor, id } = cbor(3_000_000n);
    const tx = transactionFromSignRequest({ txCbor, password: 'x' });
    expect(tx.id).toBe(id);
    expect(tx.body.outputs[0].value.coins).toBe(3_000_000n);
  });

  it('refuses a request that carries a transaction object and no CBOR', () => {
    const { id } = cbor(3_000_000n);
    const lying = { id, body: { inputs: [], outputs: [], fee: 0n }, witness: { signatures: new Map() } };
    expect(() => transactionFromSignRequest({ tx: lying })).toThrow(/txCbor is required/);
  });

  it('ignores a transaction object next to the CBOR: the signed id comes from the CBOR', () => {
    const real = cbor(3_000_000n);
    const other = cbor(4_000_000n);
    const lying = { id: other.id, body: { inputs: [], outputs: [], fee: 0n }, witness: { signatures: new Map() } };
    const tx = transactionFromSignRequest({ txCbor: real.cbor, tx: lying });
    expect(tx.id).toBe(real.id);
    expect(tx.id).not.toBe(other.id);
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['an empty request', {}],
    ['an empty string', { txCbor: '' }],
    ['a number', { txCbor: 12 }],
    ['an object', { txCbor: { id: 'x' } }],
  ])('refuses %s', (_name, data) => {
    expect(() => transactionFromSignRequest(data)).toThrow(/txCbor is required/);
  });

  it('refuses CBOR that is not a transaction', () => {
    expect(() => transactionFromSignRequest({ txCbor: 'zz' })).toThrow(/Failed to deserialize transaction/);
  });
});
