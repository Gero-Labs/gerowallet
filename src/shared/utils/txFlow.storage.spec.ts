import { describe, expect, it } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';
import { convertTransactionsForStorage } from '@/chrome/serialization';
import { buildTxFlow, type FlowTxRecord } from './txFlow';

// The flow diagram's failed-script guard reads `isValid` from the STORED record, not from CBOR.
// This runs a real transaction through the storage conversion so a rename on either side fails here.

const OWN = Cardano.BaseAddress.fromCredentials(
  Cardano.NetworkId.Mainnet,
  { type: Cardano.CredentialType.KeyHash, hash: Hash28ByteBase16('1'.repeat(56)) },
  { type: Cardano.CredentialType.KeyHash, hash: Hash28ByteBase16('f'.repeat(56)) },
).toAddress().toBech32();

function storedRecord(isValid: boolean): FlowTxRecord {
  const body: Cardano.TxBody = {
    inputs: [{ txId: Cardano.TransactionId('a'.repeat(64)), index: 0 }],
    outputs: [{ address: Cardano.PaymentAddress(OWN), value: { coins: 4_800_000n } }],
    fee: 200_000n,
  };
  const tx = Serialization.Transaction.fromCore({
    id: Serialization.TransactionBody.fromCore(body).hash(),
    body,
    witness: { signatures: new Map() },
    isValid,
  });
  const id = tx.getId();
  const [record] = convertTransactionsForStorage(
    [{ tx_hash: id, cbor: tx.toCbor(), utxo: { inputs: [{ address: OWN, amount: [{ unit: 'lovelace', quantity: 5_000_000 }] }], outputs: [] } }] as never,
    [],
  );
  return record as unknown as FlowTxRecord;
}

describe('flow diagram on stored records', () => {
  it('keeps isValid: false through storage, so a failed-script transaction draws no diagram', () => {
    const failed = storedRecord(false);
    expect(failed.isValid).toBe(false);
    expect(buildTxFlow(failed, new Set([OWN]))).toBeNull();
  });

  it('draws a valid transaction from the same storage path', () => {
    const valid = storedRecord(true);
    expect(valid.isValid).toBe(true);
    expect(buildTxFlow(valid, new Set([OWN]))?.outputs.map((node) => node.kind)).toEqual(['own', 'fee']);
  });
});
