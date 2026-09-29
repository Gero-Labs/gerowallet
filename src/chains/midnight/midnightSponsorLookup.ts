/**
 * Load the sponsor candidates for a Midnight send.
 *
 * Glue only — the decision rule lives in `midnightSponsorEligibility`, which is
 * pure and unit-tested. This module does the fetches that rule needs: the stored
 * wallets, then one Nexus `dust/destination` lookup per candidate wallet's own
 * dust address.
 *
 * Asking by dust address is what makes the answer right. The indexer's DUST
 * figures are per DUST ADDRESS, not per stake, so summing per-stake rows counted
 * a shared destination once per stake; and the stakes behind an address are found
 * by Nexus from the on-chain registrations, so a registration made from a Cardano
 * wallet outside this profile is seen too.
 *
 * FAIL-SAFE: a lookup that fails leaves that candidate `unknown` and marks the
 * result `lookupIncomplete`, never a confident zero.
 *
 * FALLBACK: a Nexus without `dust/destination` answers 404/501; then the old
 * per-stake `dust/status` path runs (`loadViaStakeRows`), which takes each
 * destination's capacity once. Delete it, and `DustDestinationUnsupportedError`
 * handling, once every Nexus serves the endpoint.
 *
 * INSTRUMENTED ON PURPOSE. During the mainnet investigation the old lookup
 * silently returned one stake address instead of all of them, because
 * `enumerateCardanoStakeIdentities` was called without its `cardanoNetwork`
 * argument and quietly skipped every Cardano wallet record. The result looked
 * like a definitive "no registration exists" and cost about an hour. Every step
 * below logs its cardinality so an empty result can be told apart from a lookup
 * that never ran.
 */
import { debugLog } from '@/utils/debug';
import { Blockchain } from '@/models/types';
import type { Wallet } from '@/models/types';
import {
  eligibleSponsorWallets,
  sortSponsorCandidates,
  sponsorCandidates,
  sponsorStateFor,
  sponsorStateFromDestination,
  type DustStatusRow,
  type SponsorCandidate,
  type SponsorWalletRef,
} from './midnightSponsorEligibility';

/**
 * The dust address a Midnight wallet stores. Midnight records keep their three
 * role addresses as a JSON blob under `publicKey` (see `createNewWallet`), so
 * this needs no unlock and no network call.
 */
export function storedDustAddress(wallet: { publicKey?: string }): string {
  try {
    const blob: unknown = JSON.parse(String(wallet.publicKey ?? '{}'));
    const dust = (blob as { dust?: unknown })?.dust;
    return typeof dust === 'string' ? dust : '';
  } catch {
    return '';
  }
}

/** Midnight wallets on `network`, reduced to what the eligibility rule needs. */
export function toSponsorRefs(
  wallets: readonly (Wallet & { publicKey?: string })[],
  network: string,
): SponsorWalletRef[] {
  return wallets
    .filter((w) => w.chain === Blockchain.MIDNIGHT && w.network === network)
    .map((w) => ({
      id: w.id,
      name: w.name,
      network: w.network,
      dustAddress: storedDustAddress(w),
    }));
}

export interface SponsorLookupResult {
  readonly candidates: SponsorCandidate[];
  /**
   * True when at least one candidate could not be checked (a failed lookup, or on
   * the fallback path a Cardano stake enumeration that produced nothing), so it is
   * `unknown` only because we could not tell. The UI must say "couldn't check"
   * rather than "no wallet can pay" — the two look identical otherwise.
   */
  readonly lookupIncomplete: boolean;
}

/** How many `dust/destination` lookups run at once. Wallets on one network are few. */
const DESTINATION_LOOKUP_CONCURRENCY = 3;

/** Nexus caps the status batch; matches `useDustPathB`. Fallback path only. */
const STATUS_BATCH_LIMIT = 50;

/**
 * Sponsor candidates for `senderWalletId` on `network`.
 *
 * Never throws: a failed lookup degrades to `unknown` candidates with
 * `lookupIncomplete` set, because refusing to show a sponsor the user can
 * actually use is worse than showing one whose state we could not confirm.
 */
export async function loadSponsorCandidates(
  senderWalletId: number,
  network: string,
): Promise<SponsorLookupResult> {
  // Named export is the observable state; the default export is the actions object.
  const { geroStore } = await import('@/stores/geroStore');
  const records = Object.values(geroStore.wallets ?? {}) as Array<Wallet & { publicKey?: string }>;
  const refs = toSponsorRefs(records, network);
  debugLog('[sponsors] wallet refs', refs.map((r) => `${r.name}#${r.id}:${r.dustAddress || 'NO-DUST-ADDR'}`));

  const eligible = eligibleSponsorWallets(refs, senderWalletId, network);
  // A wallet record without a stored dust address cannot be asked about.
  const targets = eligible.filter((w) => w.dustAddress);

  const resolved = new Map<number, SponsorCandidate>();
  let incomplete = false;
  try {
    const { getMidnightApi, DustDestinationUnsupportedError } = await import('@/api/midnight-api');
    const api = getMidnightApi(network);
    for (let i = 0; i < targets.length; i += DESTINATION_LOOKUP_CONCURRENCY) {
      const group = targets.slice(i, i + DESTINATION_LOOKUP_CONCURRENCY);
      const settled = await Promise.allSettled(group.map((w) => api.getDustDestination(w.dustAddress)));
      for (let j = 0; j < group.length; j += 1) {
        const outcome = settled[j];
        if (outcome.status === 'fulfilled') {
          resolved.set(group[j].id, sponsorStateFromDestination(group[j], outcome.value));
        } else if (outcome.reason instanceof DustDestinationUnsupportedError) {
          debugLog('[sponsors] dust/destination unsupported by this Nexus — using the per-stake fallback');
          return await loadViaStakeRows(refs, senderWalletId, network);
        } else {
          // This wallet stays `unknown` ("not checked"), and the UI is told.
          incomplete = true;
          debugLog(`[sponsors] dust/destination failed for ${group[j].name}#${group[j].id}`, outcome.reason);
        }
      }
    }
  } catch (error) {
    // Loading the API client itself failed: nothing was checked.
    incomplete = true;
    debugLog('[sponsors] destination lookup failed — candidates will be unknown', error);
  }

  const candidates = sortSponsorCandidates(
    eligible.map((w) => resolved.get(w.id) ?? sponsorStateFor(w, [])),
  );
  debugLog(`[sponsors] resolved ${resolved.size}/${eligible.length} by destination`,
    candidates.map((c) => `${c.name}#${c.walletId}=${c.state}(${c.capacity ?? 'null'})`));
  return { candidates, lookupIncomplete: incomplete };
}

/**
 * FALLBACK for a Nexus without `dust/destination`: the per-stake path this module
 * used before. Enumerates the Cardano stakes the profile controls, reads their
 * `dust/status` rows and matches them to each wallet's dust address. Rows that
 * point at one address all carry that address's total, so `sponsorStateFor` takes
 * it once. It can only see stakes this profile holds, hence `lookupIncomplete`
 * when enumeration finds none.
 */
async function loadViaStakeRows(
  refs: readonly SponsorWalletRef[],
  senderWalletId: number,
  network: string,
): Promise<SponsorLookupResult> {
  let rows: DustStatusRow[] = [];
  let incomplete = false;
  try {
    const { enumerateCardanoStakeIdentities } = await import('@/shared/composables/useCardanoStakeEnumeration');
    // The network argument is load-bearing: without it every Cardano wallet
    // record is skipped and only the twin identity survives.
    const identities = await enumerateCardanoStakeIdentities(network);
    const stakes = identities.map((i) => i.stakeAddress).filter(Boolean);
    debugLog(`[sponsors] controlled Cardano stakes on ${network}: ${stakes.length}`, stakes);

    if (stakes.length === 0) {
      incomplete = true;
    } else {
      const { getMidnightApi } = await import('@/api/midnight-api');
      rows = await getMidnightApi(network).getDustStatusBatch(stakes.slice(0, STATUS_BATCH_LIMIT));
      debugLog(`[sponsors] dust/status rows: ${rows.length}`,
        rows.map((r) => `${r.cardanoRewardAddress}→${r.dustAddress ?? 'null'} registered=${r.registered}`));
    }
  } catch (error) {
    // Keep going with no rows: candidates come back `unknown`, which the UI
    // renders as "not checked" rather than "no DUST".
    incomplete = true;
    debugLog('[sponsors] status lookup failed — candidates will be unknown', error);
  }

  const candidates = sponsorCandidates(refs, rows, senderWalletId, network);
  debugLog('[sponsors] resolved', candidates.map((c) => `${c.name}#${c.walletId}=${c.state}(${c.capacity ?? 'null'})`));
  return { candidates, lookupIncomplete: incomplete };
}
