/**
 * TypeScript mirrors of Nexus's Cardano governance DTOs.
 *
 * Two conventions to keep straight:
 *  - These come from NEXUS via the gero-backend proxy and are camelCase.
 *  - gero-backend's own /api/dreps (blockchain-api.ts) is snake_case.
 *
 * Every `BigInteger` field arrives as a JSON number and is converted to a
 * decimal STRING by `parseBigJson` before it reaches this layer, so those
 * fields are typed `string`. Pass them through `toLovelace()` — never
 * `Number()`. Fields Nexus types as `Double` (the `*Pct` family) are genuinely
 * safe as `number`.
 */

/** Nexus's generic page envelope. Note: `total` is nullable — some list modes do not count. */
export interface GovPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number | null;
}

/** The seven CIP-1694 governance action types, as Nexus spells them. */
export type GovActionType =
  | 'ParameterChange'
  | 'HardForkInitiation'
  | 'TreasuryWithdrawals'
  | 'NoConfidence'
  | 'NewCommittee'
  | 'NewConstitution'
  | 'InfoAction';

export type GovActionStatus = 'active' | 'ratified' | 'enacted' | 'expired' | 'dropped';

export type VoterRole = 'DRep' | 'SPO' | 'ConstitutionalCommittee';

export type VoteChoice = 'Yes' | 'No' | 'Abstain';

/** A row in the governance action list. */
export interface GovProposal {
  govActionId: string;
  govActionIdCip129: string;
  txHash: string;
  index: number;
  slot: number | null;
  type: GovActionType | string;
  status: GovActionStatus | string;
  /** Lovelace as a decimal string. */
  deposit: string | null;
  returnAddress: string | null;
  anchorUrl: string | null;
  anchorHash: string | null;
  title: string | null;
  submittedEpoch: number | null;
  expiresEpoch: number | null;
}

/** A CIP-100 `references[]` entry. */
export interface GovReference {
  '@type'?: string;
  label?: string;
  uri?: string;
}

/** The full action, including resolved off-chain metadata. */
export interface GovProposalDetail extends GovProposal {
  /** Decoded on-chain payload — shape varies by action type. */
  govAction: unknown | null;
  /** The raw anchor document as fetched. */
  rawMetadata: unknown | null;
  /** NOTE: `abstract` is reserved in Java, so Nexus names this `abstractText`. */
  abstractText: string | null;
  motivation: string | null;
  rationale: string | null;
  references: GovReference[] | null;
  authors: string[] | null;
  /**
   * Whether the fetched anchor document's blake2b-256 matched `anchorHash`.
   * `null` means the check did not run (not fetched, or not attempted) — that is
   * NOT the same as `false`, and the UI must distinguish them.
   */
  hashValid: boolean | null;
}

/**
 * One cast vote: a voter's STANDING position on an action.
 *
 * The upstream feed collapses re-votes, so there is exactly one row per voter
 * (verified against mainnet: 52 rows / 52 distinct voter ids on
 * `gov_action105mjyzm…`). There is no vote history to order.
 *
 * Everything below `txHash` is OPTIONAL on purpose. Koios carries all of it,
 * and the dev shim now projects it, but gero-backend's production projection is
 * not confirmed to. Absent must mean "the affordance is not rendered" — never a
 * blank cell, a dash, or an epoch-0 date.
 */
export interface GovVote {
  voterRole: VoterRole | string;
  voterHash: string | null;
  drepId: string | null;
  vote: VoteChoice | string;
  txHash: string | null;
  /** Block time of the standing vote, unix SECONDS. */
  votedAt?: number | null;
  /** Anchor URL of the voter's published rationale, if they published one. */
  rationaleUrl?: string | null;
  rationaleHash?: string | null;
  /** True when the voter is a script rather than a key. Null means unknown. */
  hasScript?: boolean | null;
  /**
   * The voter's bech32 id whatever their role — `drepId` is DRep-only, so
   * without this an SPO or committee row falls back to raw hex while a DRep row
   * shows bech32, on the same list.
   */
  voterId?: string | null;
  /**
   * For a CONSTITUTIONAL COMMITTEE row: the member's COLD credential, which is
   * the value `CommitteeMember.hash` carries.
   *
   * The join key, and the only one there is. `voterHash` on these rows is the
   * HOT credential the member signed with, and CIP-1694 keeps the two apart by
   * design — the cold key holds the mandate and authorises a hot key that can be
   * rotated without touching it. Measured on mainnet: 288 committee vote rows
   * across 75 actions, ZERO of them matching any `members[].hash`. So a
   * committee row cannot be named from its own hash, however it is transformed.
   *
   * OPTIONAL because the projection resolves it server-side (Gero-Labs/nexus#898)
   * and omits it when it cannot: a hot key with no authorization certificate, a
   * vote predating every known authorization of it, or two cold credentials
   * tying as most-recent authorizer. Absent is not an empty name — it means this
   * row falls back to its hash, which is the honest render.
   */
  committeeColdHash?: string | null;
}

/**
 * Stake-weighted tally, sourced from Koios's proposal_voting_summary.
 *
 * Several fields are always null upstream — `abstainVotePower`, `ccThreshold`,
 * `spoAbstainVotePower`, `spoNotVotedPower` and `notVotedPower` — so the UI must
 * treat absence as "not available", never as zero. Verify against a captured
 * fixture before relying on any one of them.
 */
export interface GovVotingSummary {
  epochNo: number | null;

  // DRep
  yesVotePower: string | null;
  noVotePower: string | null;
  abstainVotePower: string | null;
  yesPct: number | null;
  noPct: number | null;
  yesVotesCast: number | null;
  noVotesCast: number | null;
  abstainVotesCast: number | null;
  alwaysNoConfidenceVotePower: string | null;
  alwaysAbstainVotePower: string | null;

  // Constitutional committee
  ccYesVotes: number | null;
  ccNoVotes: number | null;
  ccAbstainVotes: number | null;
  ccThreshold: number | null;
  ccYesPct: number | null;
  ccNoPct: number | null;

  // SPO
  spoYesVotesCast: number | null;
  spoNoVotesCast: number | null;
  spoAbstainVotesCast: number | null;
  spoYesVotePower: string | null;
  spoNoVotePower: string | null;
  spoAbstainVotePower: string | null;
  spoNotVotedPower: string | null;
  spoYesPct: number | null;
  spoNoPct: number | null;

  notVotedPower: string | null;
}

/**
 * One seat on the constitutional committee.
 *
 * Two facts about `hash`, both verified against mainnet through the gero-backend
 * proxy on 2026-08-24, and both load-bearing for the votes list:
 *
 *  1. It is the member's COLD credential (`1980dbf1…`, `credType: SCRIPTHASH`).
 *     A committee VOTE carries the HOT one (`voterHash: 2ea7a78e…`,
 *     `voterId: cc_hot1…`), and the two are different key hashes — the eight
 *     current members and the committee rows on
 *     `529dccaa…#0` overlap on exactly ZERO hashes. So a vote row only resolves
 *     to a member once upstream publishes the hot credential (or the name) on a
 *     surface that carries it. Until then the row renders its truncated hash,
 *     which is the honest answer; nothing may guess a name by position.
 *  2. The set is the CURRENT committee. A member whose term expired before the
 *     action may legitimately have voted and be absent here.
 */
export interface CommitteeMember {
  hash: string;
  credType: string | null;
  startEpoch: number | null;
  expiredEpoch: number | null;
  /**
   * The member's published name ("Tingvard"). OPTIONAL because the projection
   * in front of the wallet today does not send it — the live response carries
   * only the four fields above — while the newer Nexus does. Absent is not an
   * empty name: it means the row falls back to its hash.
   */
  displayName?: string | null;
}

export interface Committee {
  thresholdNumerator: number | null;
  thresholdDenominator: number | null;
  members: CommitteeMember[];
}

export interface Constitution {
  activeEpoch: number | null;
  anchorUrl: string | null;
  anchorHash: string | null;
  script: string | null;
}
