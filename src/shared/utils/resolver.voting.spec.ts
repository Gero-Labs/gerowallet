import { describe, it, expect } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { analyzeTransactionForSignatures } from '@/shared/utils/resolver';
import { ChainDerivations } from '@/models/types';

const CRED = '463796d2a39623a5441e9eab1594c2d21f96d2a544f49f82bc023bff';

function txWithVote(voterType: Cardano.VoterType) {
  return {
    body: {
      inputs: [],
      outputs: [],
      votingProcedures: [
        {
          voter: { __typename: voterType, credential: { type: Cardano.CredentialType.KeyHash, hash: CRED } },
          votes: [
            {
              actionId: { id: 'a'.repeat(64), actionIndex: 0 },
              votingProcedure: { vote: Cardano.Vote.yes, anchor: null },
            },
          ],
        },
      ],
    },
  } as never;
}

// analyzeTransactionForSignatures(transaction, utxos, addresses, accountIndex, stakeAddress)
// returns the signer array directly. Empty utxos/addresses are fine here: the
// voting branch does not consult them.
function analyze(tx: never) {
  return analyzeTransactionForSignatures(tx, [], {} as never, 0, '');
}

describe('analyzeTransactionForSignatures — voting procedures', () => {
  it('requires a DRep-key witness for a dRepKeyHash voter', () => {
    const result = analyze(txWithVote(Cardano.VoterType.dRepKeyHash));
    // Role 3 is the CIP-105 DRep key role.
    expect(result.some(s => s.derivationPath[0] === ChainDerivations.DREP)).toBe(true);
  });

  it('does not add a DRep signer for a stake-pool voter', () => {
    const result = analyze(txWithVote(Cardano.VoterType.stakePoolKeyHash));
    expect(result.some(s => s.derivationPath[0] === ChainDerivations.DREP)).toBe(false);
  });

  it('flags the cold key out-of-band for a stake-pool voter, like pool certificates do', () => {
    const result = analyze(txWithVote(Cardano.VoterType.stakePoolKeyHash));
    expect((result as unknown as { requiresColdKeySignature?: boolean }).requiresColdKeySignature).toBe(true);
  });

  it('requires a CC hot-key witness for a ccHotKeyHash voter', () => {
    const result = analyze(txWithVote(Cardano.VoterType.ccHotKeyHash));
    expect(result.some(s => s.derivationPath[0] === ChainDerivations.CONSTITUTIONAL_COMMITTEE_HOT)).toBe(true);
  });

  it('adds no key signer for script-credential voters', () => {
    for (const voterType of [Cardano.VoterType.dRepScriptHash, Cardano.VoterType.ccHotScriptHash]) {
      const result = analyze(txWithVote(voterType));
      expect(result).toHaveLength(0);
    }
  });

  it('adds exactly one signer for a batch of votes from one voter', () => {
    const tx = txWithVote(Cardano.VoterType.dRepKeyHash) as never as {
      body: { votingProcedures: { votes: unknown[] }[] };
    };
    tx.body.votingProcedures[0].votes = new Array(5).fill(tx.body.votingProcedures[0].votes[0]);

    const result = analyze(tx as never);
    const drepSigners = result.filter(s => s.derivationPath[0] === ChainDerivations.DREP);
    expect(drepSigners).toHaveLength(1);
  });

  it('is a no-op for a transaction with no voting procedures', () => {
    const plain = { body: { inputs: [], outputs: [] } } as never;
    expect(() => analyze(plain)).not.toThrow();
    expect(analyze(plain)).toHaveLength(0);
  });
});

describe('analyzeTransactionForSignatures — only signs for the wallet’s own credentials', () => {
  const FOREIGN = 'f'.repeat(56);
  const keys = (over: Record<string, unknown>) => ({ payment: [], change: [], stake: [], drep105: [], drep129: [], ccHot: [], ccCold: [], script: [], ...over }) as never;
  const voteBy = (voterType: Cardano.VoterType, hash: string) => ({
    body: { inputs: [], outputs: [], votingProcedures: [{
      voter: { __typename: voterType, credential: { type: Cardano.CredentialType.KeyHash, hash } },
      votes: [{ actionId: { id: 'a'.repeat(64), actionIndex: 0 }, votingProcedure: { vote: Cardano.Vote.yes, anchor: null } }],
    }] },
  }) as never;

  it('adds the DRep witness for our own DRep voter, not for someone else’s', () => {
    const own = keys({ drep129: [{ cred: CRED, path: '' }] });
    expect(analyzeTransactionForSignatures(voteBy(Cardano.VoterType.dRepKeyHash, CRED), [], own, 0, '')
      .some(s => s.derivationPath[0] === ChainDerivations.DREP)).toBe(true);
    expect(analyzeTransactionForSignatures(voteBy(Cardano.VoterType.dRepKeyHash, FOREIGN), [], own, 0, '')
      .some(s => s.derivationPath[0] === ChainDerivations.DREP)).toBe(false);
  });

  it('adds the CC-hot witness only for our own CC-hot voter', () => {
    const own = keys({ ccHot: [{ cred: CRED, path: '' }] });
    expect(analyzeTransactionForSignatures(voteBy(Cardano.VoterType.ccHotKeyHash, FOREIGN), [], own, 0, '')).toHaveLength(0);
  });

  it('adds the stake witness only for a certificate on our own stake credential', () => {
    const own = keys({ stake: [{ cred: CRED, path: '', address: 'stake_test1' }] });
    const cert = (hash: string) => ({ body: { inputs: [], outputs: [], certificates: [{
      __typename: Cardano.CertificateType.VoteDelegation,
      stakeCredential: { type: Cardano.CredentialType.KeyHash, hash },
      dRep: { __typename: 'AlwaysAbstain' },
    }] } }) as never;
    expect(analyzeTransactionForSignatures(cert(CRED), [], own, 0, '').some(s => s.type === 'stake')).toBe(true);
    expect(analyzeTransactionForSignatures(cert(FOREIGN), [], own, 0, '').some(s => s.type === 'stake')).toBe(false);
  });
});
