import { describe, it, expect } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';
import { analyzeTransactionForSignatures } from '@/shared/utils/resolver';

// An input the key set cannot place by its address used to fall back to the external-0 payment
// key, script-locked inputs included. A script input (a CIP-113 programmable UTxO, say) is
// witnessed by its script; a key witness for it authorises nothing and inflates the fee. A
// key-locked input is signed by the key carrying its payment key hash, or not at all.
const TX_ID = 'ab'.repeat(32);

function address(payment: Cardano.CredentialType): string {
  return Cardano.BaseAddress.fromCredentials(
    Cardano.NetworkId.Testnet,
    { hash: Hash28ByteBase16('11'.repeat(28)), type: payment },
    { hash: Hash28ByteBase16('22'.repeat(28)), type: Cardano.CredentialType.KeyHash },
  ).toAddress().toBech32();
}

function signersFor(inputAddress: string, payment: unknown[] = []) {
  const tx = { body: { inputs: [{ txId: TX_ID, index: 0 }], outputs: [] } } as never;
  const utxos = [[
    { txId: TX_ID, index: 0, address: inputAddress },
    { address: inputAddress, value: { coins: 2_000_000n } },
  ]] as unknown as Cardano.Utxo[];
  return analyzeTransactionForSignatures(tx, utxos, { payment, change: [], stake: [] } as never);
}

describe('analyzeTransactionForSignatures — inputs outside the key set', () => {
  it('never key-signs a script-locked input', () => {
    expect(signersFor(address(Cardano.CredentialType.ScriptHash))).toEqual([]);
  });

  it('signs a key-locked input outside the key set with the key carrying its payment key hash', () => {
    // The key sits at another address of the same payment key (another stake part).
    const key = { address: 'addr_test_other_stake_part', cred: '11'.repeat(28), path: "m/1852'/1815'/1'/0/7" };
    expect(signersFor(address(Cardano.CredentialType.KeyHash), [key])).toEqual([{ derivationPath: [0, 7], type: 'payment' }]);
  });

  it('signs nothing for a key-locked input whose key the key set doesn\'t carry', () => {
    expect(signersFor(address(Cardano.CredentialType.KeyHash))).toEqual([]);
  });
});
