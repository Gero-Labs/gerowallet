import { effectScope, watch } from 'vue';
import { Cardano } from '@cardano-sdk/core';
import { walletStore } from '@/stores/walletStore';
import governanceStoreActions from '@/stores/governanceStore';
import blockchainApi from '@/api/blockchain-api';
import { isCardanoTx } from '@/models/transaction.types';
import { extractCip149Compensation } from '@/shared/utils/builder';
import { KEYWORD_DREPS } from '@/shared/utils/drepId';
import { createTtlCache } from '@/shared/utils/ttlCache';
import type { DelegatedDRepRecord } from '@/shared/composables/useDelegationHealth';
import { debugLog } from '@/utils/debug';

/**
 * Hydrates the CIP-149 slice of the governance store from the wallet itself.
 *
 * `useWithdrawal.compensationInfo` reads `currentDRep` (for the DRep's CIP-119
 * payment address) and `currentCompensationBps` to decide whether a withdrawal
 * carries a CIP-149 donation output — and withdrawals are built from surfaces
 * that never mount a governance view (the dashboard StakingCard). Hydration
 * keyed to a view means a user who logs in and withdraws straight from the
 * dashboard silently drops the donation they committed to, so it lives here,
 * keyed to the wallet: bootstrapped once at the dashboard root and re-run on
 * every delegation change. MyGovernance calls the same writer off its own
 * fetch, so the page and the bootstrap can never disagree about the store.
 */

/**
 * The donation rate the user last committed to, read off the newest CONFIRMED
 * vote-delegation transaction's CIP-149 metadata. A pending one is excluded:
 * it can still fail, and acting on it would attach a donation the chain never
 * agreed to.
 */
export function activeCompensationBps(): number | null {
  const txs = walletStore.transactions ?? [];
  const latestDelegation = txs
    .filter(
      tx =>
        !tx.pending &&
        isCardanoTx(tx) &&
        (tx.body?.certificates ?? []).some(
          (cert: Cardano.Certificate) =>
            cert.__typename === Cardano.CertificateType.VoteDelegation ||
            cert.__typename === Cardano.CertificateType.VoteRegistrationDelegation,
        ),
    )
    .sort((a, b) => (b.block_height || 0) - (a.block_height || 0))[0];

  return latestDelegation ? extractCip149Compensation(latestDelegation.auxiliaryData) : null;
}

/**
 * Write the delegation state into the governance store — the single writer
 * shared by the bootstrap watcher and MyGovernance (which passes the record it
 * fetched for its own display rather than fetching twice).
 */
export function applyGovernanceHydration(record: DelegatedDRepRecord | null): void {
  const drepId = walletStore.account?.drep_id;
  if (!drepId) {
    governanceStoreActions.clearCurrentDRep();
    governanceStoreActions.setCompensationBps(null);
    return;
  }

  // The predefined choices have no record to fetch; the store only ever held
  // the bare id for them, and compensation cannot apply to a keyword.
  governanceStoreActions.setCurrentDRep(
    KEYWORD_DREPS.includes(drepId as (typeof KEYWORD_DREPS)[number])
      ? { drep_id: drepId }
      : record,
  );
  governanceStoreActions.setCompensationBps(activeCompensationBps());
}

/**
 * How long one DRep's record stays fresh. The same window the register uses:
 * these figures move once an epoch, not once a second.
 */
export const DREP_RECORD_TTL_MS = 5 * 60 * 1000;

/**
 * Every `getDRepById` lookup in the app, memoised per chain/network/id.
 *
 * One cache for all of them on purpose. The profile page and My governance ask
 * for the same record through different paths, and a wallet that opens its own
 * DRep's profile was fetching ~240 KB it already had in memory. Now whichever
 * surface asks first pays, and going back and forth between them is free.
 *
 * Bounded at 24 records so browsing the directory cannot retain every profile
 * ever opened — the payload is large, which is the whole reason this is not a
 * plain Map.
 */
const records = createTtlCache<DelegatedDRepRecord | null>(DREP_RECORD_TTL_MS);

const recordKey = (drepId: string, wallet: { chain: string; network: string }): string =>
  `${wallet.chain}:${wallet.network}:${drepId}`;

/**
 * One DRep's record, from cache when it is fresh and from the API otherwise.
 * Concurrent callers share one request; a failure is not cached, so the next
 * mount can succeed.
 */
export function loadDRepRecord(
  drepId: string,
  wallet: { chain: string; network: string },
): Promise<DelegatedDRepRecord | null> {
  return records.get(recordKey(drepId, wallet), () =>
    blockchainApi.getDRepById(drepId, wallet.chain, wallet.network),
  );
}

/** Whether a record is in hand right now — lets a view skip its skeleton. */
export function hasDRepRecord(drepId: string, wallet: { chain: string; network: string }): boolean {
  return records.has(recordKey(drepId, wallet));
}

/**
 * When this record was actually fetched, or null when it was not cached.
 *
 * What an "as of" stamp must be built from. Stamping `Date.now()` after a cached
 * read would date five-minute-old figures to this second.
 */
export function drepRecordFetchedAt(
  drepId: string,
  wallet: { chain: string; network: string },
): number | null {
  return records.at(recordKey(drepId, wallet));
}

/**
 * Drop a cached record so the next read refetches. Called after delegating: the
 * delegator counts on the record the user just joined are now wrong.
 */
export function forgetDRepRecord(drepId: string, wallet: { chain: string; network: string }): void {
  records.forget(recordKey(drepId, wallet));
}

/** Test seam, and the eviction hook for a wallet or network switch. */
export function resetDRepRecords(): void {
  records.clear();
}

/**
 * Fetch the delegated DRep's record. The bootstrap watcher and a mounted
 * governance view react to the same `drep_id` change; both go through the shared
 * cache above, so that is one lookup rather than one per consumer.
 */
export function fetchDelegatedDRepRecord(
  drepId: string,
  wallet: { chain: string; network: string },
): Promise<DelegatedDRepRecord | null> {
  return loadDRepRecord(drepId, wallet);
}

/**
 * Fetch-and-write hydration for callers with no display state of their own
 * (the bootstrap watcher). Returns the record; null when there was nothing to
 * fetch (no delegation, or a predefined choice).
 *
 * Throws on a failed lookup, WITHOUT touching the store: blanking a good
 * record over a transient network error would detach the donation from the
 * next withdrawal.
 */
export async function hydrateGovernanceStore(): Promise<DelegatedDRepRecord | null> {
  const drepId = walletStore.account?.drep_id;
  if (!drepId || KEYWORD_DREPS.includes(drepId as (typeof KEYWORD_DREPS)[number])) {
    applyGovernanceHydration(null);
    return null;
  }

  const wallet = walletStore.loggedWallet;
  // Mid-transition (account outliving the wallet record): nothing safe to
  // fetch, and the store is left alone rather than blanked.
  if (!wallet) return null;

  const record = await fetchDelegatedDRepRecord(drepId, wallet);
  // Superseded mid-flight by a newer delegation: the call watching the new id
  // owns the store now, and a late write here would put the old DRep back.
  if (walletStore.account?.drep_id !== drepId) return record;
  applyGovernanceHydration(record);
  return record;
}

let applied = false;

/**
 * Install the wallet-keyed hydration watchers. Called once from
 * src/options/App.vue setup (dashboard root) — the sidepanel has its own
 * StakingPage-owned hydration. The watchers live in a DETACHED effectScope so
 * a caller unmounting can never dispose them (the module latch would
 * otherwise make this a permanent no-op for the page).
 */
export function useGovernanceHydration(): void {
  if (applied) return;
  applied = true;
  const scope = effectScope(true); // detached: immune to caller lifetime
  scope.run(() => {
    // Fires at login (the account arrives carrying a drep_id), at logout
    // (clears both slots) and on delegating from any surface.
    watch(
      () => walletStore.account?.drep_id,
      () => {
        hydrateGovernanceStore().catch(err => debugLog('Governance hydration: DRep lookup failed', err));
      },
      { immediate: true },
    );
    // The tx history lands after the account at login, and the committed
    // donation rate lives in it: without this, hydration keyed on drep_id
    // alone reads an empty list and parks the rate at null until the next
    // delegation. Also covers a wallet switch onto the same DRep, where
    // drep_id never changes but the new wallet's history carries its own rate.
    watch(
      () => activeCompensationBps(),
      bps => {
        if (walletStore.account?.drep_id) governanceStoreActions.setCompensationBps(bps);
      },
    );
  });
}
