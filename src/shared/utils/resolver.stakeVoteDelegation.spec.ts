import { describe, it, expect } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { analyzeTransactionForSignatures } from '@/shared/utils/resolver';

// A StakeVoteDelegation certificate is what useDelegation.ts:198 builds when the
// stake key is already registered but has no drep_id yet. It delegates to a pool
// AND a DRep in one certificate, so it needs the stake-key witness.
function txWithCert(certType: Cardano.CertificateType) {
  return {
    body: {
      inputs: [],
      outputs: [],
      certificates: [
        {
          __typename: certType,
          stakeCredential: { hash: 'a'.repeat(56), type: 0 },
          dRepCredential: { hash: 'b'.repeat(56), type: 0 },
          poolId: 'pool1'.padEnd(56, 'c'),
        },
      ],
    },
  } as never;
}

// analyzeTransactionForSignatures(transaction, utxos, addresses)
// returns the signer array directly. The key set carries the certificate's stake
// credential (the wallet's own); the certificate branch consults nothing else.
function requiredPaths(certType: Cardano.CertificateType): string[] {
  const result = analyzeTransactionForSignatures(txWithCert(certType), [], { stake: [{ cred: 'a'.repeat(56), path: "m/1852'/1815'/0'/2/0" }] } as never);
  return result.map(s => JSON.stringify(s.derivationPath));
}

describe('analyzeTransactionForSignatures — Conway vote-delegation certificates', () => {
  it('requires a stake-key witness for StakeVoteDelegation', () => {
    expect(requiredPaths(Cardano.CertificateType.StakeVoteDelegation)).toContain(JSON.stringify([2, 0]));
  });

  it('still requires it for the three vote-delegation types that already worked', () => {
    for (const t of [
      Cardano.CertificateType.VoteDelegation,
      Cardano.CertificateType.VoteRegistrationDelegation,
      Cardano.CertificateType.StakeVoteRegistrationDelegation,
    ]) {
      expect(requiredPaths(t), `${t} lost its stake witness`).toContain(JSON.stringify([2, 0]));
    }
  });
});
