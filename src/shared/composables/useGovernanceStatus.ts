import { computed, unref, type ComputedRef, type Ref } from 'vue';
import { KEYWORD_DREPS, sameDRep } from '@/shared/utils/drepId';
import { toLovelace } from '@/shared/utils/lovelace';
import { isStakeKeyRegistered, type StakeRegistrationSignals } from '@/shared/utils/stakeRegistration';
import {
  delegationHealth,
  type DelegatedDRepRecord,
  type DelegationHealth,
} from '@/shared/composables/useDelegationHealth';

/**
 * The one named state a wallet's governance position is in.
 *
 * Everything the governance home renders hangs off this: the hero, the tone,
 * the copy, and which call to action is offered. Deriving it in one place is
 * the point — the same account can otherwise read as "represented" on one card
 * and "no DRep" on the next, which is exactly the bug this replaces.
 *
 * Pure over its arguments and free of store imports, so an alert evaluator in
 * the background and a view in the options page reach the same verdict.
 *
 * Precedence, most urgent first, because exactly one state may win:
 *
 *   1. `notInGovernance`   the stake key is not registered at all
 *   2. `registeredNoDRep`  registered but undelegated: rewards are LOCKED
 *   3. `drepRetired`       the DRep deregistered; the delegation is dead
 *   4. `selfDRep`          the wallet delegated to its own DRep key
 *   5. `drepInactive`      the DRep stopped counting; the stake is excluded NOW
 *   6. `drepInactiveSoon`  the DRep is running out of activity window
 *   7. `represented`       delegated and healthy
 *
 * Retirement outranks self because a retired registration is dead whoever owns
 * it. Self outranks both inactivity states because the remedy differs — you go
 * and vote, you do not go and find a replacement — and `health` is exposed
 * alongside so a self-DRep view can still show the countdown. Inactive and
 * inactive-soon are separate states because their copy differs in tense: one
 * is a fact about the present, the other a warning about the future, and
 * rendering the warning while the stake is already excluded understates it.
 */
export type GovernanceStatus =
  | 'notInGovernance'
  | 'registeredNoDRep'
  | 'represented'
  | 'drepInactive'
  | 'drepInactiveSoon'
  | 'drepRetired'
  | 'selfDRep';

/**
 * What the stake is actually delegated to. Orthogonal to `status` because the
 * two predefined choices are not represented by anyone: they unlock rewards
 * and take a standing position, so calling them "represented" in copy would be
 * a lie even though they share the state.
 */
export type DelegationKind = 'none' | 'drep' | 'self' | 'abstain' | 'noConfidence';

/**
 * Not `StatusTone` from govLifecycle: that describes a governance ACTION's
 * lifecycle and has no danger level, while locked rewards and a retired DRep
 * are red on the design canvas.
 */
export type GovernanceStatusTone = 'neutral' | 'success' | 'warning' | 'critical';

/** A `drep129` entry (`{ address, cred }`) or either of its id strings. */
export type OwnDRepKey = string | { address?: string | null; cred?: string | null } | null | undefined;

/** The `walletStore.account` fields this reads. Structurally typed on purpose. */
export interface GovernanceAccountSignals extends StakeRegistrationSignals {
  /** Lovelace as a decimal string — pass it through `toLovelace`, never `Number`. */
  withdrawable_amount?: string | null;
}

export interface GovernanceStatusInput {
  account?: GovernanceAccountSignals | null;
  /** The delegated DRep's record, if it has been fetched. Null is "unknown". */
  record?: DelegatedDRepRecord | null;
  /** `walletStore.keys?.drep129` — pass it straight through; empty is fine. */
  ownDRepIds?: readonly OwnDRepKey[] | null;
  /** `networkStore.getCurrentEpoch()`. */
  currentEpoch?: number | null;
  /** `epochParams.dRepInactivityPeriod` (raw: `drep_activity`). Defaults to 20. */
  activityWindow?: number | null;
  /** Warn once this many epochs remain. Defaults to 5, the 15-of-20 point. */
  warnAt?: number;
  /** Vote window for the recent rationale rate. Defaults to 10. */
  recentWindow?: number;
  /**
   * Wall time in unix seconds (`Date.now() / 1000`), enabling the recent-vote
   * veto in `delegationHealth`. Optional: without it the veto is skipped.
   */
  nowSec?: number | null;
}

export interface GovernanceStatusResult {
  status: GovernanceStatus;
  delegation: DelegationKind;
  /** Is the stake key registered on-chain (via `isStakeKeyRegistered`)? */
  registered: boolean;
  /** The delegated DRep id as the account carries it, trimmed; null when none. */
  drepId: string | null;
  /** Does that id belong to this wallet's own DRep key? */
  isSelf: boolean;
  /** Did a DRep record for THIS delegation arrive? Absence is not retirement. */
  recordAvailable: boolean;
  /** CIP-1694: a registered but undelegated key cannot withdraw its rewards. */
  withdrawalsBlocked: boolean;
  /** Exact lovelace held back by that block; 0n when nothing is blocked. */
  lockedRewards: bigint;
  health: DelegationHealth;
  tone: GovernanceStatusTone;
  /** i18n key stem for this state, e.g. `governance.status.represented`. */
  copyKey: string;
  titleKey: string;
  descriptionKey: string;
}

const COPY_NAMESPACE = 'governance.status';

const TONES: Record<string, GovernanceStatusTone> = {
  notInGovernance: 'neutral',
  registeredNoDRep: 'critical',
  represented: 'success',
  abstaining: 'neutral',
  noConfidence: 'neutral',
  drepInactive: 'critical',
  drepInactiveSoon: 'warning',
  drepRetired: 'critical',
  selfDRep: 'success',
};

/** A value, a ref of it, or a getter for it. */
export type StatusSource<T> = T | Ref<T> | (() => T);

function read<T>(source: StatusSource<T>): T {
  return typeof source === 'function' ? (source as () => T)() : (unref(source as T | Ref<T>) as T);
}

function trimmed(value: string | null | undefined): string | null {
  const text = String(value ?? '').trim();
  return text.length > 0 ? text : null;
}

function keywordDelegation(drepId: string): DelegationKind | null {
  if (drepId === KEYWORD_DREPS[0]) return 'abstain';
  if (drepId === KEYWORD_DREPS[1]) return 'noConfidence';
  return null;
}

/** Every id string a `drep129` entry can be matched by, empties dropped. */
function candidateIds(key: OwnDRepKey): string[] {
  if (typeof key === 'string') return [key];
  if (!key) return [];
  return [key.address, key.cred].map(trimmed).filter((id): id is string => id !== null);
}

/**
 * Match on the credential, never on the display string: `sameDRep` normalises
 * CIP-129 bech32, CIP-105 bech32 and bare hex to the same 28-byte credential,
 * so a wallet holding its key in one form still recognises the other.
 */
function matchesOwnKey(drepId: string, ownDRepIds: readonly OwnDRepKey[] | null | undefined): boolean {
  if (!ownDRepIds || ownDRepIds.length === 0) return false;
  return ownDRepIds.some(key => candidateIds(key).some(candidate => sameDRep(drepId, candidate)));
}

/** Derive the wallet's governance state. Pure — safe to call in a render. */
export function governanceStatus(input: GovernanceStatusInput = {}): GovernanceStatusResult {
  const { account, record, ownDRepIds, currentEpoch, activityWindow, warnAt, recentWindow, nowSec } = input;

  const registered = isStakeKeyRegistered(account);
  const drepId = registered ? trimmed(account?.drep_id) : null;
  const keyword = drepId ? keywordDelegation(drepId) : null;
  const isSelf = !!drepId && !keyword && matchesOwnKey(drepId, ownDRepIds);

  // A record only speaks for the DRep currently delegated to. One left over
  // from a previous delegation would otherwise retire the wrong DRep. A record
  // without a `drep_id` is trusted: the caller fetched it by this id.
  const applies =
    !!drepId &&
    !keyword &&
    !!record &&
    (trimmed(record.drep_id) === null || sameDRep(record.drep_id, drepId));
  const applicable = applies ? record : null;

  const health = delegationHealth(applicable, { currentEpoch, activityWindow, warnAt, recentWindow, nowSec });

  let delegation: DelegationKind = 'none';
  if (keyword) delegation = keyword;
  else if (isSelf) delegation = 'self';
  else if (drepId) delegation = 'drep';

  const withdrawalsBlocked = registered && delegation === 'none';

  let status: GovernanceStatus;
  let copyStem: string;
  if (!registered) {
    status = 'notInGovernance';
    copyStem = 'notInGovernance';
  } else if (!drepId) {
    status = 'registeredNoDRep';
    copyStem = 'registeredNoDRep';
  } else if (health.retired) {
    status = 'drepRetired';
    copyStem = 'drepRetired';
  } else if (isSelf) {
    status = 'selfDRep';
    copyStem = 'selfDRep';
  } else if (health.expired) {
    status = 'drepInactive';
    copyStem = 'drepInactive';
  } else if (health.inactiveSoon) {
    status = 'drepInactiveSoon';
    copyStem = 'drepInactiveSoon';
  } else {
    status = 'represented';
    // The predefined choices share the state but never the copy.
    copyStem = keyword === 'abstain' ? 'abstaining' : keyword === 'noConfidence' ? 'noConfidence' : 'represented';
  }

  const copyKey = `${COPY_NAMESPACE}.${copyStem}`;

  return {
    status,
    delegation,
    registered,
    drepId,
    isSelf,
    recordAvailable: applicable !== null,
    withdrawalsBlocked,
    lockedRewards: withdrawalsBlocked ? toLovelace(account?.withdrawable_amount) : 0n,
    health,
    tone: TONES[copyStem] ?? 'neutral',
    copyKey,
    titleKey: `${copyKey}.title`,
    descriptionKey: `${copyKey}.description`,
  };
}

/**
 * Reactive wrapper. Takes the whole input as a value, ref or getter so the
 * caller decides what is reactive — typically all of it, since the account, the
 * DRep record and the epoch each arrive on their own schedule.
 */
export function useGovernanceStatus(
  input: StatusSource<GovernanceStatusInput> = {},
): ComputedRef<GovernanceStatusResult> {
  return computed(() => governanceStatus(read(input)));
}
