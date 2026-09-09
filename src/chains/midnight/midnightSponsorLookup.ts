/**
 * Load the sponsor candidates for a Midnight send.
 *
 * Glue only — the decision rule lives in `midnightSponsorEligibility`, which is
 * pure and unit-tested. This module does the three fetches that rule needs:
 * stored wallets, the Cardano stake addresses the user controls, and Nexus's
 * `dust/status` rows for those stakes.
 *
 * INSTRUMENTED ON PURPOSE. During the mainnet investigation this exact lookup
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
  sponsorCandidates,
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
   * True when the Cardano stake enumeration produced nothing, so every
   * candidate is necessarily `unknown`. The UI must say "couldn't check"
   * rather than "no wallet can pay" — the two look identical otherwise.
   */
  readonly lookupIncomplete: boolean;
}

/** Nexus caps the status batch; matches `useDustPathB`. */
const STATUS_BATCH_LIMIT = 50;

/**
 * Sponsor candidates for `senderWalletId` on `network`.
 *
 * Never throws: a failed lookup degrades to every candidate `unknown` with
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
