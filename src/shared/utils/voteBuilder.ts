import { Cardano } from '@cardano-sdk/core';
import { Hash28ByteBase16, Hash32ByteBase16 } from '@cardano-sdk/crypto';
import { parseDRepId } from '@/shared/utils/drepId';
import { parseGovActionId } from '@/shared/utils/govActionId';

/**
 * Pure construction of Conway `VotingProcedures`.
 *
 * `VotingProcedures` is an array of { voter, votes[] } GROUPS, not a flat list.
 * A DRep voting on ten actions is ONE group with ten votes — which is exactly
 * what makes batch voting a single signature and a single fee.
 *
 * Everything here throws on bad input rather than defaulting. A vote is a
 * signed, irreversible on-chain statement; silently substituting a value would
 * be far worse than a rejected build.
 */

export type VoteChoice = 'Yes' | 'No' | 'Abstain';

export interface VoteIntent {
  /** Any parseable gov action id form. */
  govActionId: string;
  choice: VoteChoice;
  /** CIP-136 rationale anchor. Null/absent is legal — a vote may carry no metadata. */
  anchor?: { url: string; dataHash: string } | null;
}

/** Map a UI choice onto the SDK's numeric Vote enum (no=0, yes=1, abstain=2). */
export function voteFromChoice(choice: VoteChoice): Cardano.Vote {
  switch (String(choice).toLowerCase()) {
    case 'yes':
      return Cardano.Vote.yes;
    case 'no':
      return Cardano.Vote.no;
    case 'abstain':
      return Cardano.Vote.abstain;
    default:
      throw new Error(`Unknown vote choice: ${choice}`);
  }
}

/**
 * Build the voting procedures for one DRep casting one or more votes.
 *
 * `drepId` accepts any of the live identifier forms (CIP-129 bech32, CIP-105
 * bech32, raw credential hex); it is normalized to the 28-byte credential,
 * which is what the ledger wants.
 */
export function buildVotingProcedures(drepId: string, votes: VoteIntent[]): Cardano.VotingProcedures {
  if (!votes || votes.length === 0) {
    throw new Error('A vote transaction needs at least one vote');
  }

  const parsedDRep = parseDRepId(drepId);
  if (!parsedDRep || parsedDRep.form === 'keyword') {
    throw new Error(`Unrecognised DRep id: ${drepId}`);
  }
  if (parsedDRep.credentialType !== 'keyHash') {
    // Script DReps vote through a native/Plutus script witness, which this
    // build path does not construct. Fail loudly rather than producing a
    // transaction that cannot be witnessed.
    throw new Error('Script-credential DReps cannot vote through this flow yet');
  }

  const voter: Cardano.Voter = {
    __typename: Cardano.VoterType.dRepKeyHash,
    credential: {
      type: Cardano.CredentialType.KeyHash,
      hash: Hash28ByteBase16(parsedDRep.credentialHex),
    },
  };

  const votingVotes: Cardano.VotingProcedureVote[] = votes.map(intent => {
    const actionId = parseGovActionId(intent.govActionId);
    if (!actionId) throw new Error(`Unrecognised governance action id: ${intent.govActionId}`);

    return {
      actionId: {
        id: Cardano.TransactionId(actionId.txHash),
        actionIndex: actionId.index,
      },
      votingProcedure: {
        vote: voteFromChoice(intent.choice),
        anchor: intent.anchor
          ? { url: intent.anchor.url, dataHash: Hash32ByteBase16(intent.anchor.dataHash) }
          : null,
      },
    };
  });

  return [{ voter, votes: votingVotes }];
}
