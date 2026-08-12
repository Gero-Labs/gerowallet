/**
 * Is this Cardano stake key registered on-chain?
 *
 * The synced account payload does NOT carry `active`, even though
 * `Account` (src/stores/walletStore.ts) declares it as required — see
 * `docs/gero-sync-account-active-contract.md`. Reading `account.active`
 * directly therefore evaluates `!undefined` as `true` for every wallet, which
 * breaks unstaking outright and makes governance and pool delegation build a
 * combined `VoteRegistrationDelegation` certificate that Ledger refuses to sign
 * and the node rejects.
 *
 * This predicate resolves the flag against the corroborating fields the payload
 * DOES carry. It is deliberately not "trust `active` whenever present": nexus's
 * primary provider used to derive `active` from pool delegation alone, so a
 * vote-delegated-only wallet arrives as a present-but-wrong `false`. Trusting
 * that would discard the `drep_id` evidence that proves the opposite.
 *
 * | `active` | `pool_id` / `drep_id` | Result         | Why                                          |
 * |----------|-----------------------|----------------|----------------------------------------------|
 * | `true`   | any                   | registered     | No producer emits a false positive           |
 * | `false`  | either set            | **registered** | Delegation implies registration; flag is stale |
 * | `false`  | neither set           | not registered | Agrees                                       |
 * | absent   | either set            | registered     | Inference only                                |
 * | absent   | neither set           | not registered | Inference only                                |
 *
 * Known limitation: a stake key that is registered but delegated to neither a
 * pool nor a DRep reads as unregistered. No client-side signal can distinguish
 * that from a never-registered key — supplying it is exactly what the producer
 * fix exists to do. Once both producers ship `active` with registration-truth
 * semantics, this collapses back to `account.active` and the file goes away.
 */
export interface StakeRegistrationSignals {
  /** Absent in practice today. Boolean when a producer actually sends it. */
  active?: boolean | null;
  /** Set once the key is delegated to a stake pool. */
  pool_id?: string | null;
  /** Set once the key is delegated to a DRep. */
  drep_id?: string | null;
}

/**
 * Structurally typed so this stays importable from the background bundle
 * without dragging in the Vue-observable wallet store.
 */
export function isStakeKeyRegistered(account?: StakeRegistrationSignals | null): boolean {
  if (!account) return false;
  // A delegation certificate cannot exist without a registered stake key, so
  // either id being present outranks a false/absent `active`.
  return account.active === true || !!account.pool_id || !!account.drep_id;
}
