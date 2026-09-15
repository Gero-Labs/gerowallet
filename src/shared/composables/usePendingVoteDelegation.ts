import { computed, type ComputedRef } from 'vue';
import { Cardano } from '@cardano-sdk/core';
import { walletStore } from '@/stores/walletStore';
import { isCardanoTx } from '@/models/transaction.types';

/**
 * Whether this wallet has a vote delegation submitted but not yet confirmed.
 *
 * The governance home reads its state from `account.drep_id`, which is the
 * CHAIN's answer and does not move until the certificate is in a block. Between
 * submitting and confirming, the page therefore kept rendering the position the
 * user had just changed — and in the un-delegating direction that reads as an
 * accusation: "Registered, no DRep. Reward withdrawals are blocked and your
 * stake backs no one", stated over a transaction that is on its way to fixing
 * exactly that. Delegating for the first time has the mirror problem: the empty
 * state stays up as though the click did nothing.
 *
 * Neither is a wrong FACT — the chain really has not moved yet. What is wrong is
 * presenting it as settled. So this is not a status, it is a qualifier the view
 * lays over one.
 *
 * ALL FOUR certificate types count. A wallet delegating its stake and its vote
 * in one transaction emits `StakeVoteDelegation` or
 * `StakeVoteRegistrationDelegation`, and a first-time delegator emits a
 * `…RegistrationDelegation` variant; checking only the two plain ones would go
 * blind on precisely the users who most need the feedback. (`resolver.ts` treats
 * the four as one set for the same reason.)
 */
const VOTE_DELEGATION_CERTS: readonly Cardano.CertificateType[] = [
  Cardano.CertificateType.VoteDelegation,
  Cardano.CertificateType.VoteRegistrationDelegation,
  Cardano.CertificateType.StakeVoteDelegation,
  Cardano.CertificateType.StakeVoteRegistrationDelegation,
];

/** True when at least one PENDING transaction carries a vote-delegation certificate. */
export function hasPendingVoteDelegation(transactions: readonly unknown[] | null | undefined): boolean {
  return (transactions ?? []).some(tx => {
    const candidate = tx as { pending?: boolean; body?: { certificates?: Cardano.Certificate[] } };
    if (!candidate?.pending || !isCardanoTx(candidate as never)) return false;
    return (candidate.body?.certificates ?? []).some(cert =>
      VOTE_DELEGATION_CERTS.includes(cert.__typename),
    );
  });
}

/**
 * Reactive form of the above, over `walletStore.transactions`.
 *
 * Every pending transaction is scanned rather than just the newest: an unrelated
 * pending send must not hide a delegation that is also in flight.
 */
export function usePendingVoteDelegation(): ComputedRef<boolean> {
  return computed(() => hasPendingVoteDelegation(walletStore.transactions));
}
