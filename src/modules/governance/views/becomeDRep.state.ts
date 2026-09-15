/**
 * Flow-state rules for the Become a DRep view.
 *
 * These live outside the SFC so they can be tested directly: both encode a rule
 * that, if it gets it wrong, produces a permanent, deposit-bearing on-chain
 * mistake rather than a cosmetic one.
 */

/**
 * The subset of gero-backend's `/api/dreps/{id}` row this view reads. Kept
 * structural on purpose: `blockchain-api.getDRepById` returns `any` and every
 * field on that row has been seen absent. The full shape is documented as
 * `DelegatedDRepRecord` in `useDelegationHealth.ts`.
 */
export interface DRepRegistryRecord {
  /** `false` means retired (a deregistration certificate). See below. */
  registered?: boolean | null;
}

/**
 * Whether this wallet's DRep is currently registered, and so should be offered
 * the retire path instead of the registration flow.
 *
 * The polarity is `!== false`, not `=== true`, and the difference matters in
 * both directions:
 *
 *   - A RETIRED DRep still has a row, with `registered: false`. Treating the
 *     mere existence of the row as registration (`!!record`) strands that user
 *     on the retire panel forever, unable to register again.
 *   - The field is OPTIONAL. `=== true` would treat a row whose `registered`
 *     the backend never projected as "not registered", offering an already
 *     registered DRep a second registration: a deposit-bearing signature on a
 *     transaction the chain rejects, and a confusing dead end. Given this
 *     projection has dropped fields before, that is the more dangerous
 *     failure of the two.
 *
 * So only an explicit `false` counts as retirement, which is exactly the rule
 * `useDelegationHealth` states: "`registered: false` is retirement".
 */
export function isRegisteredDRep(record: DRepRegistryRecord | null | undefined): boolean {
  return !!record && record.registered !== false;
}

/**
 * Identity of the anchor a built registration transaction carries.
 *
 * The on-chain anchor is the PAIR (url, dataHash), so a transaction is only
 * reusable while BOTH still match what the form holds. Watching the document
 * hash alone lets an edited URL slip through: build against URL A, go back,
 * change the URL to B, return to the review step, and the transaction still
 * anchored at A is what gets signed onto a permanent registration.
 *
 * Compare the identity rather than the individual fields so there is one thing
 * to watch and one thing to compare.
 */
export function anchorIdentity(url: string, dataHash: string): string {
  return `${url.trim()}|${dataHash.trim().toLowerCase()}`;
}
