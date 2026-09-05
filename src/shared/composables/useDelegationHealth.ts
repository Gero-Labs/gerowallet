import { computed, unref, type ComputedRef, type Ref } from 'vue';
import { epochsRemaining } from '@/shared/utils/govLifecycle';
import { pctOf } from '@/shared/utils/lovelace';

/**
 * Health of the DRep a wallet has delegated its voting power to.
 *
 * Pure over its arguments: this module NEVER fetches and reads no ambient
 * clock. The caller supplies the DRep record (gero-backend
 * `GET /api/dreps/{id}`, snake_case), the current epoch
 * (`networkStore.getCurrentEpoch()`) and optionally the wall time (`nowSec`),
 * so the same maths is reusable from a view, from an alert evaluator, and from
 * a test with no store at all.
 *
 * The CIP-1694 / Conway-ledger facts that drive everything here:
 *
 *  - A DRep that neither votes nor submits a DRep update certificate for
 *    `drep_activity` epochs stops counting: "Inactive DReps do not count
 *    towards the active voting stake anymore, and can become active again ...
 *    by voting on any governance actions or submitting a DRep update
 *    certificate" (CIP-1694). That exclusion is why the warning exists at all.
 *  - A stored expiry is NOT a clean countdown. Epochs with no open proposals
 *    are dormant (`numDormantEpochs`) and do not consume the window, but the
 *    accrued credit is only folded into stored expiries when the NEXT proposal
 *    is submitted (cardano-ledger, Certs.hs `updateDormantDRepExpiry`). During
 *    a proposal drought an indexer's `expires_epoch_no` can therefore sit in
 *    the past for a DRep that has missed nothing. A past expiry is evidence of
 *    inactivity, never proof.
 *  - What refreshes the expiry: the DRep's own votes (Certs.hs,
 *    `updateVotingDRepExpiries`) and its registration/update certificates
 *    (GovCert.hs). A delegator's vote-delegation certificate does NOT.
 *
 * Hence the trust hierarchy `delegationHealth` implements, strongest first:
 *
 *  1. `registered: false` is retirement. Permanent, outranks everything.
 *  2. An explicit `active` flag is the indexer's own verdict and beats any
 *     arithmetic done here on `expires_epoch_no`. `active: true` beside an
 *     already-passed expiry is a self-contradiction: the expiry is provably
 *     stale, so the countdown is discarded (`expiryStale`) instead of being
 *     rendered as "0 left".
 *  3. With no `active` flag, expiry arithmetic may conclude "expired", but a
 *     vote younger than the activity window vetoes it: a vote fully resets the
 *     window and dormancy only ever ADDS credit, so expiry after a recent vote
 *     is impossible. The veto needs wall time, so it runs only when the caller
 *     passes `nowSec`.
 *
 * `n/a` is not `0`. A DRep with no votes has NO rationale rate — reporting 0%
 * would accuse them of withholding rationales they were never asked for. Those
 * fields are `null` and the UI must render them as "n/a".
 */

/** One row of the DRep's voting record, as gero-backend returns it. */
export interface DRepVoteRecord {
  proposal_id?: string | null;
  vote?: string | null;
  /** Unix seconds. Absent on some providers, so it is treated as unordered. */
  block_time?: number | null;
  /** The CIP-136 rationale anchor. Non-empty means a rationale was attached. */
  meta_url?: string | null;
  meta_hash?: string | null;
}

/**
 * The delegated DRep as gero-backend returns it. Structurally typed and fully
 * optional: the endpoint is untyped upstream (`blockchain-api.getDRepById`
 * returns `any` and `null` on 404), and every field here has been seen absent.
 *
 * `registered` and `active` are distinct and both matter: `registered: false`
 * is retirement (a deregistration certificate), while `active: false` is an
 * expiry through inactivity. Only the first is permanent.
 */
export interface DelegatedDRepRecord {
  drep_id?: string | null;
  registered?: boolean | null;
  active?: boolean | null;
  expires_epoch_no?: number | null;
  votes?: DRepVoteRecord[] | null;
  delegators?: unknown[] | null;
  metadata?: unknown;
  /**
   * The DRep's 56-char credential hex, and whether that credential is a script.
   *
   * Both are on the wire and read all over the governance module
   * (DRepDirectory, DRepProfile, GovernanceView, drepRegister), but they were
   * never declared here, so anything reading them off a DelegatedDRepRecord was
   * a type error — invisible, because `tsc --noEmit` does not read `.vue` files
   * and `vue-tsc` is not in CI. drepRegister worked around it with an index
   * access and a cast; declaring them is the honest fix.
   *
   * `hex` is what a delegation certificate is actually built from
   * (useDRepDelegation refuses to build one without it), and `has_script`
   * decides between newScriptHash and newKeyHash — get it wrong and the
   * certificate names a credential that does not exist.
   */
  hex?: string | null;
  has_script?: boolean | null;
}

export interface DelegationHealthOptions {
  /** `networkStore.getCurrentEpoch()`. Null on a Bitcoin tip or before sync. */
  currentEpoch?: number | null;
  /**
   * The protocol's `drep_activity`. On `networkStore.epochParams` this is the
   * Cardano SDK's `dRepInactivityPeriod` (camelCase); the raw gero-backend
   * epoch-params payload spells it `drep_activity`. Null falls back to 20.
   */
  activityWindow?: number | null;
  /** Warn once this many epochs (or fewer) remain. */
  warnAt?: number;
  /** How many of the newest votes `rationaleRecent` covers. */
  recentWindow?: number;
  /**
   * Wall time in unix seconds, enabling the recent-vote veto (rule 3 of the
   * trust hierarchy). Optional on purpose: the module reads no ambient clock,
   * so a caller that does not pass it simply forgoes the veto.
   */
  nowSec?: number | null;
  /** Seconds per epoch for the veto's age arithmetic. Cardano: 432000 (5 days). */
  epochLengthSec?: number;
}

export interface DelegationHealth {
  /**
   * Whole epochs until the DRep goes inactive; 0 once passed, null when the
   * expiry is unknown or was discarded as stale (`expiryStale`).
   */
  epochsLeft: number | null;
  /**
   * Epochs into the activity window, derived as `activityWindow − epochsLeft`.
   * A statement about the EXPIRY COUNTDOWN, never about voting behaviour: in
   * Conway the expiry also moves on DRep update certificates and dormancy
   * credits, so this must never be rendered as "epochs since their last vote".
   * Real vote recency is `lastVoteAt`.
   */
  windowUsed: number | null;
  /**
   * The expiry countdown contradicted stronger evidence (an explicit
   * `active: true`, or a vote younger than the activity window) and was
   * discarded as stale. `epochsLeft`/`windowUsed` are null; surfaces must drop
   * the countdown line rather than render "0 more epochs".
   */
  expiryStale: boolean;
  /** The window actually used, after the `drep_activity` fallback. */
  activityWindow: number;
  /** The epochs-left threshold actually used. */
  warnAt: number;
  /** Going inactive (or already there) and not retired: the amber state. */
  inactiveSoon: boolean;
  /**
   * Already stopped counting: an explicit `active: false`, or an elapsed
   * countdown that no stronger evidence vetoed. Never true while the record
   * itself claims `active: true` — the explicit flag outranks the arithmetic.
   */
  expired: boolean;
  /** Deregistered on-chain. Permanent, and it outranks the inactivity warning. */
  retired: boolean;
  /** Percent (0–100) of the newest `recentWindow` votes carrying a rationale, or null. */
  rationaleRecent: number | null;
  /** Percent (0–100) over the whole voting record, or null when there are no votes. */
  rationaleLongRun: number | null;
  /** The window actually used for `rationaleRecent`. */
  recentWindow: number;
  /** How many votes the record carried. */
  voteCount: number;
  /** Unix seconds of the newest vote, or null when unknown. */
  lastVoteAt: number | null;
}

/** CIP-1694's default `drep_activity`, used when the epoch params do not carry one. */
export const DEFAULT_DREP_ACTIVITY_EPOCHS = 20;
/** Warn with 5 epochs (about 25 days) left — the 15-of-20 point the alerts surface names. */
export const DEFAULT_WARN_EPOCHS_LEFT = 5;
/** "Their last 10 votes" is the recency window the DRep surfaces quote. */
export const DEFAULT_RATIONALE_WINDOW = 10;
/** A Cardano epoch is 432,000 seconds (5 days). */
export const DEFAULT_EPOCH_LENGTH_SEC = 432_000;

/** A value, a ref of it, or a getter for it — so callers can stay reactive or not. */
export type HealthSource<T> = T | Ref<T> | (() => T);

function read<T>(source: HealthSource<T>): T {
  return typeof source === 'function' ? (source as () => T)() : (unref(source as T | Ref<T>) as T);
}

function hasRationale(entry: DRepVoteRecord): boolean {
  return String(entry.meta_url ?? '').trim().length > 0;
}

/**
 * Newest first. `block_time` is optional upstream, so undated votes sort last
 * rather than poisoning the order — they still count toward the long-run rate.
 */
function newestFirst(entries: DRepVoteRecord[]): DRepVoteRecord[] {
  return [...entries].sort((a, b) => (b.block_time ?? -Infinity) - (a.block_time ?? -Infinity));
}

/** Percent of `entries` carrying a rationale, or null when there are none to judge. */
function rationaleRate(entries: DRepVoteRecord[]): number | null {
  if (entries.length === 0) return null;
  return pctOf(entries.filter(hasRationale).length, entries.length);
}

/** Compute the health of one delegated DRep. Pure — safe to call in a render. */
export function delegationHealth(
  record: DelegatedDRepRecord | null | undefined,
  options: DelegationHealthOptions = {},
): DelegationHealth {
  const activityWindow = options.activityWindow ?? DEFAULT_DREP_ACTIVITY_EPOCHS;
  const warnAt = options.warnAt ?? DEFAULT_WARN_EPOCHS_LEFT;
  const recentWindow = options.recentWindow ?? DEFAULT_RATIONALE_WINDOW;
  const epochLengthSec = options.epochLengthSec ?? DEFAULT_EPOCH_LENGTH_SEC;

  const ordered = newestFirst(record?.votes ?? []);
  const lastVoteAt = ordered[0]?.block_time ?? null;

  const retired = record?.registered === false;

  // Ledger boundary (Conway RATIFY): a DRep is excluded only when
  // `currentEpoch > expiry` — the expiry epoch itself still counts. So
  // "0 left" means "final active epoch", a warning, never an exclusion.
  // `epochsRemaining` clamps at 0, and `expiryPassed` carries the strict test.
  const expiryPassed =
    typeof options.currentEpoch === 'number' &&
    typeof record?.expires_epoch_no === 'number' &&
    options.currentEpoch > record.expires_epoch_no;
  let epochsLeft = epochsRemaining(options.currentEpoch, record?.expires_epoch_no);
  let expiryStale = false;

  if (record?.active === true && expiryPassed) {
    // Rule 2: the indexer says active while its own expiry says already gone.
    // In Conway that is exactly what a stale index looks like (the dormancy
    // credit is only folded into stored expiries when the next proposal is
    // submitted), so the countdown is unreliable and must not be rendered.
    expiryStale = true;
  } else if (record?.active === false && epochsLeft !== null && !expiryPassed) {
    // Rule 2, mirrored: an explicit inactive verdict beside a countdown that
    // claims epochs remain. Whichever field is right, rendering "window has
    // run out" next to "N epochs left" would state at least one falsehood, so
    // the flag is trusted (it is the indexer's verdict) and the countdown is
    // discarded rather than displayed against it.
    expiryStale = true;
  } else if (
    record?.active !== false &&
    epochsLeft !== null &&
    lastVoteAt !== null &&
    options.nowSec !== null &&
    options.nowSec !== undefined
  ) {
    // Rule 3: the record's own newest vote proves a MINIMUM headroom — per
    // CIP-1694 a vote fully resets the window, and dormancy only ever ADDS
    // credit on top. A stored countdown materially below that proof is stale,
    // whether it has already elapsed or is merely counting down toward a
    // false warning. One epoch of slack absorbs the wall-clock estimate of
    // the vote's age, so a countdown a single epoch adrift is never
    // discarded. Without `nowSec` the veto is simply skipped.
    const voteAgeEpochs = Math.floor((options.nowSec - lastVoteAt) / epochLengthSec);
    if (activityWindow - voteAgeEpochs - epochsLeft > 1) expiryStale = true;
  }
  if (expiryStale) epochsLeft = null;

  // Derived from the countdown, NOT from `votes[]` — see `windowUsed`'s doc.
  // Clamped both ways: a dormancy-bumped expiry can exceed the fallback
  // window, which would otherwise read as negative usage.
  const windowUsed =
    epochsLeft === null ? null : Math.min(activityWindow, Math.max(0, activityWindow - epochsLeft));

  // `active: false` is the indexer's explicit verdict and stands on its own.
  // The arithmetic verdict needs the STRICTLY passed expiry (see the boundary
  // note above) and only stands where no explicit flag contradicts it: an
  // `active: true` survivor was already cleared via `expiryStale` above, and
  // the `!== true` guard keeps the hierarchy true by construction.
  const expired = !retired && (record?.active === false || (record?.active !== true && expiryPassed && !expiryStale));

  // The legitimate early warning: a COHERENT low countdown warns even for a
  // DRep the indexer still calls active. A stale-nulled countdown never warns.
  const inactiveSoon = !retired && (expired || (epochsLeft !== null && epochsLeft <= warnAt));

  return {
    epochsLeft,
    windowUsed,
    expiryStale,
    activityWindow,
    warnAt,
    inactiveSoon,
    expired,
    retired,
    rationaleRecent: rationaleRate(ordered.slice(0, Math.max(0, recentWindow))),
    rationaleLongRun: rationaleRate(ordered),
    recentWindow,
    voteCount: ordered.length,
    lastVoteAt,
  };
}

/**
 * Reactive wrapper. Both arguments accept a value, a ref or a getter, so the
 * caller decides what is reactive — typically the record (it arrives async) and
 * the current epoch (it advances under the user).
 */
export function useDelegationHealth(
  record: HealthSource<DelegatedDRepRecord | null | undefined>,
  options: HealthSource<DelegationHealthOptions> = {},
): ComputedRef<DelegationHealth> {
  return computed(() => delegationHealth(read(record), read(options)));
}
