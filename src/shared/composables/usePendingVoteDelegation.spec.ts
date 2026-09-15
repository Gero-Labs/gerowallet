// The gap between submitting a delegation and the chain agreeing.
//
// `account.drep_id` is the chain's answer, so for the minute or two a
// certificate spends in flight the governance home kept rendering the position
// the user had just changed. Un-delegating showed "Registered, no DRep — reward
// withdrawals are blocked and your stake backs no one" over a transaction on its
// way to fixing that; delegating for the first time left the empty state up as
// though the click had done nothing.
import { describe, it, expect } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { hasPendingVoteDelegation } from './usePendingVoteDelegation';

/** A Cardano tx as walletStore holds it. `body` is what makes isCardanoTx true. */
const tx = (pending: boolean, certTypes: Cardano.CertificateType[]) => ({
  pending,
  body: { certificates: certTypes.map(t => ({ __typename: t })) },
});

describe('hasPendingVoteDelegation', () => {
  it.each([
    ['VoteDelegation', Cardano.CertificateType.VoteDelegation],
    ['VoteRegistrationDelegation', Cardano.CertificateType.VoteRegistrationDelegation],
    // The combined stake+vote forms. Checking only the two plain ones would go
    // blind on first-time delegators and on anyone delegating both at once —
    // the users who most need the feedback.
    ['StakeVoteDelegation', Cardano.CertificateType.StakeVoteDelegation],
    ['StakeVoteRegistrationDelegation', Cardano.CertificateType.StakeVoteRegistrationDelegation],
  ])('sees a pending %s', (_label, type) => {
    expect(hasPendingVoteDelegation([tx(true, [type])])).toBe(true);
  });

  it('ignores a delegation that has already confirmed', () => {
    // Once it is on chain, `drep_id` carries the answer and the qualifier must
    // get out of the way — otherwise the page would say "pending" forever.
    expect(hasPendingVoteDelegation([tx(false, [Cardano.CertificateType.VoteDelegation])])).toBe(false);
  });

  it('ignores pending transactions that are not delegations', () => {
    expect(hasPendingVoteDelegation([tx(true, [Cardano.CertificateType.StakeDelegation])])).toBe(false);
    expect(hasPendingVoteDelegation([tx(true, [])])).toBe(false);
  });

  it('finds a delegation behind an unrelated pending send', () => {
    // Every pending tx is scanned, not just the newest: a send sitting in the
    // mempool must not hide a delegation that is also in flight.
    const txs = [
      tx(true, []),
      tx(true, [Cardano.CertificateType.StakeDelegation]),
      tx(true, [Cardano.CertificateType.VoteDelegation]),
    ];
    expect(hasPendingVoteDelegation(txs)).toBe(true);
  });

  it('finds one in a transaction carrying several certificates', () => {
    const combined = tx(true, [
      Cardano.CertificateType.StakeRegistration,
      Cardano.CertificateType.VoteDelegation,
    ]);
    expect(hasPendingVoteDelegation([combined])).toBe(true);
  });

  it('is false for nothing at all, rather than throwing', () => {
    expect(hasPendingVoteDelegation([])).toBe(false);
    expect(hasPendingVoteDelegation(null)).toBe(false);
    expect(hasPendingVoteDelegation(undefined)).toBe(false);
    expect(hasPendingVoteDelegation([null, undefined, {}])).toBe(false);
  });
})
