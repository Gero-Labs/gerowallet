import { describe, it, expect } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { buildVotingProcedures, voteFromChoice } from '@/shared/utils/voteBuilder';

const CRED = '463796d2a39623a5441e9eab1594c2d21f96d2a544f49f82bc023bff';
const TX_A = '941502b0aa104c850d1979232594459ad5be55bd7b18b6285bbaa32d5566213d';
const TX_B = 'a'.repeat(64);

describe('voteFromChoice', () => {
  it('maps the three choices onto the SDK numeric enum', () => {
    expect(voteFromChoice('Yes')).toBe(Cardano.Vote.yes);
    expect(voteFromChoice('No')).toBe(Cardano.Vote.no);
    expect(voteFromChoice('Abstain')).toBe(Cardano.Vote.abstain);
  });

  it('is case-insensitive', () => {
    expect(voteFromChoice('yes' as never)).toBe(Cardano.Vote.yes);
  });

  it('throws on an unknown choice rather than defaulting to a vote', () => {
    expect(() => voteFromChoice('maybe' as never)).toThrow(/vote choice/i);
  });
});

describe('buildVotingProcedures', () => {
  it('produces one voter group holding every vote', () => {
    const procedures = buildVotingProcedures(CRED, [
      { govActionId: `${TX_A}#0`, choice: 'Yes' },
      { govActionId: `${TX_B}#2`, choice: 'No' },
    ]);

    expect(procedures).toHaveLength(1);
    expect(procedures[0].votes).toHaveLength(2);
  });

  it('marks the voter as a DRep key hash with the given credential', () => {
    const [group] = buildVotingProcedures(CRED, [{ govActionId: `${TX_A}#0`, choice: 'Yes' }]);
    expect(group.voter.__typename).toBe(Cardano.VoterType.dRepKeyHash);
    expect(group.voter.credential.hash).toBe(CRED);
    expect(group.voter.credential.type).toBe(Cardano.CredentialType.KeyHash);
  });

  it('splits the gov action id into id and actionIndex', () => {
    const [group] = buildVotingProcedures(CRED, [{ govActionId: `${TX_B}#2`, choice: 'No' }]);
    expect(group.votes[0].actionId).toEqual({ id: TX_B, actionIndex: 2 });
  });

  it('attaches a null anchor when no rationale is supplied', () => {
    const [group] = buildVotingProcedures(CRED, [{ govActionId: `${TX_A}#0`, choice: 'Yes' }]);
    expect(group.votes[0].votingProcedure.anchor).toBeNull();
  });

  it('attaches the anchor when a rationale is supplied', () => {
    const anchor = { url: 'https://example.org/r.json', dataHash: 'b'.repeat(64) };
    const [group] = buildVotingProcedures(CRED, [{ govActionId: `${TX_A}#0`, choice: 'Yes', anchor }]);
    expect(group.votes[0].votingProcedure.anchor).toEqual(anchor);
  });

  it('accepts a CIP-129 DRep id and normalizes it to the credential', () => {
    const cip129 = 'drep1yfrr09kj5wtz8f2yr602k9v5ctfpl9kj54z0f8uzhsprhlcw09j6x';
    const [group] = buildVotingProcedures(cip129, [{ govActionId: `${TX_A}#0`, choice: 'Yes' }]);
    expect(group.voter.credential.hash).toBe(CRED);
  });

  it('throws on an empty vote list rather than building an empty group', () => {
    expect(() => buildVotingProcedures(CRED, [])).toThrow(/at least one vote/i);
  });

  it('throws on an unparseable gov action id', () => {
    expect(() => buildVotingProcedures(CRED, [{ govActionId: 'nope', choice: 'Yes' }])).toThrow(/governance action id/i);
  });

  it('throws on an unparseable DRep credential', () => {
    expect(() => buildVotingProcedures('nope', [{ govActionId: `${TX_A}#0`, choice: 'Yes' }])).toThrow(/drep/i);
  });

  it('throws on a keyword DRep — always-abstain is not a votable credential', () => {
    expect(() => buildVotingProcedures('drep_always_abstain', [{ govActionId: `${TX_A}#0`, choice: 'Yes' }])).toThrow(/drep/i);
  });

  it('throws on a script-credential DRep rather than building an unwitnessable tx', () => {
    const scriptDrep = 'drep_script1enxvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxvcmphcvc';
    expect(() => buildVotingProcedures(scriptDrep, [{ govActionId: `${TX_A}#0`, choice: 'Yes' }])).toThrow(/script/i);
  });
});
