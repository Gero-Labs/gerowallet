import { describe, it, expect } from 'vitest';
import { buildVotingProcedures } from '@/shared/utils/voteBuilder';
import { analyzeTransactionForSignatures } from '@/shared/utils/resolver';
import { ChainDerivations } from '@/models/types';

const CRED = '463796d2a39623a5441e9eab1594c2d21f96d2a544f49f82bc023bff';
const TX = 'a'.repeat(64);

/**
 * Fee sanity for batch voting. The fee estimator prices one witness per
 * required signer (witnessCount × 110 bytes × minFeeCoefficient), so if five
 * votes produced five voter groups the fee would jump by ~110 bytes per vote.
 * One group → one DRep witness → the fee grows only by the extra body bytes.
 */
describe('buildVotingProcedures — batch fee sanity', () => {
  it('yields ONE voter group for five votes, not five', () => {
    const votes = Array.from({ length: 5 }, (_, i) => ({
      govActionId: `${TX}#${i}`,
      choice: 'Yes' as const,
    }));

    const procedures = buildVotingProcedures(CRED, votes);

    expect(procedures).toHaveLength(1);
    expect(procedures[0].votes).toHaveLength(5);
  });

  it('prices exactly one DRep witness for the five-vote group', () => {
    const votes = Array.from({ length: 5 }, (_, i) => ({
      govActionId: `${TX}#${i}`,
      choice: 'Abstain' as const,
    }));
    const tx = { body: { inputs: [], outputs: [], votingProcedures: buildVotingProcedures(CRED, votes) } };

    const signers = analyzeTransactionForSignatures(tx as never, [], {} as never, 0, '');
    const drepSigners = signers.filter(signer => signer.derivationPath[0] === ChainDerivations.DREP);

    expect(drepSigners).toHaveLength(1);
  });
});
