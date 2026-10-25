import { describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { useProvenApprovalUtxos } from './useProvenApprovalUtxos';

const keyCred = (c: string) => ({ type: Cardano.CredentialType.KeyHash, hash: c.repeat(56) as Cardano.Credential['hash'] });
const base = (pay: string, stake: string) =>
  Cardano.BaseAddress.fromCredentials(Cardano.NetworkId.Testnet, keyCred(pay), keyCred(stake)).toAddress().toBech32();
const OWN = base('a', 'b');
const OTHER = base('c', 'd');

/** The real transaction that created the wallet's UTxO: 1,000 ADA to OWN at index 0. */
function creatingTx() {
  const core = {
    id: '0'.repeat(64),
    body: { inputs: [{ txId: '1'.repeat(64), index: 0 }], outputs: [{ address: OWN, value: { coins: 1_000_000_000n } }], fee: 200_000n },
    witness: { signatures: new Map() },
  } as unknown as Cardano.Tx;
  const tx = Serialization.Transaction.fromCore(core);
  return { cbor: tx.toCbor(), hash: String(tx.getId()) as Cardano.TransactionId };
}

const created = creatingTx();
const history = [{ tx_hash: created.hash, cbor: created.cbor }];
const txIn = { txId: created.hash, index: 0 } as Cardano.TxIn;
const spending = { body: { inputs: [txIn], outputs: [], fee: 200_000n } } as unknown as Cardano.Tx;
const utxo = (address: string, coins: bigint): Cardano.Utxo =>
  [txIn as Cardano.HydratedTxIn, { address: address as Cardano.PaymentAddress, value: { coins } }];

async function settle() {
  await vi.waitFor(async () => { await nextTick(); });
  await new Promise((r) => setTimeout(r, 0));
  await nextTick();
}

describe('useProvenApprovalUtxos', () => {
  it('keeps the UTxO list when it says what the chain says', async () => {
    const claimed = ref<readonly Cardano.Utxo[]>([utxo(OWN, 1_000_000_000n)]);
    const { ownUtxos, misreported } = useProvenApprovalUtxos(ref(spending), claimed, ref('Stagenet'), () => history);
    await settle();
    expect(misreported.value).toBe(false);
    expect(ownUtxos.value).toBe(claimed.value);
  });

  it('replaces an understated input with its proven value and asks for an acknowledgement', async () => {
    const claimed = ref<readonly Cardano.Utxo[]>([utxo(OWN, 1_000_000n)]);
    const { ownUtxos, misreported } = useProvenApprovalUtxos(ref(spending), claimed, ref('Stagenet'), () => history);
    await settle();
    expect(misreported.value).toBe(true);
    expect(ownUtxos.value[0][1].value.coins).toBe(1_000_000_000n);
  });

  it('drops an input the list wrongly calls the wallet\'s', async () => {
    const otherIn = { txId: created.hash, index: 0 } as Cardano.HydratedTxIn;
    const claimed = ref<readonly Cardano.Utxo[]>([[otherIn, { address: OTHER as Cardano.PaymentAddress, value: { coins: 1_000_000_000n } }]]);
    const { ownUtxos, misreported } = useProvenApprovalUtxos(ref(spending), claimed, ref('Stagenet'), () => history);
    await settle();
    expect(misreported.value).toBe(true);
    expect(ownUtxos.value).toEqual([]);
  });

  it('never blocks when an input cannot be proven', async () => {
    const claimed = ref<readonly Cardano.Utxo[]>([utxo(OWN, 1_000_000n)]);
    const { ownUtxos, misreported } = useProvenApprovalUtxos(ref(spending), claimed, ref('Stagenet'), () => []);
    await settle();
    expect(misreported.value).toBe(false);
    expect(ownUtxos.value).toBe(claimed.value);
  });
});
