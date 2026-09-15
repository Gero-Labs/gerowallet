/**
 * Per-color balance derivation for Midnight unshielded UTxOs.
 *
 * Every UTxO the wallet stores already carries `tokenType`, so per-color
 * balances are DERIVED, never stored — there is no new state to keep in sync
 * and nothing extra to broadcast across contexts.
 *
 * Native NIGHT is deliberately excluded here. It has its own balance field
 * (`MidnightBalances.nightUnshielded`) maintained by the sync service, and
 * that field has twice been zeroed by regressions; nothing in this module
 * writes to it.
 */
import type { MidnightUnshieldedUtxo } from './midnightTypes';

/**
 * Native NIGHT is the 32-byte-zero token type. gero-sync sometimes emits an
 * empty string instead (older indexer schemas), so both mean "native". The
 * check is deliberately loose: it accepts an all-zero string of ANY length,
 * not just the canonical 64 hex chars.
 *
 * This is the LOOSE predicate. Three call sites import and use it directly:
 * `midnight-sync.service.ts`'s CATCH_UP snapshot re-sum (~line 460),
 * `midnightStore.ts`'s `applyUtxoDeltas` `isNight` closure (~line 957), and
 * `background.ts`'s DApp-facing `getUnshieldedBalances` handler (~line 5311)
 * — the latter switched from its own strict inline copy so that its NIGHT
 * sum and its `midnightTokenBalances()` call partition the UTxO set with no
 * gap (an all-zero color of non-canonical length used to satisfy neither).
 *
 * Two OTHER call sites still keep their own STRICT inline copy —
 * `tt === '' || tt === NIGHT_TOKEN_TYPE_NULL` (exactly 64 zeros) — and do
 * NOT import this function:
 *   - `midnight-sync.service.ts`'s counterparty selection (~line 533)
 *   - `midnight-sync.service.ts`'s `sumOutputsForOwner` (~line 590), which
 *     feeds tx amount + send/receive classification
 *
 * This loose/strict split across four copies is PRE-EXISTING and NOT
 * resolved by this module. Unifying the two remaining strict sites onto
 * `isNativeNight` is a separate change with its own blast radius (it would
 * also start accepting non-canonical-length all-zero strings at those
 * sites, which hasn't been evaluated) — do not assume they agree, and do
 * not "tidy" them together without treating that as its own task.
 */
export function isNativeNight(tokenType: string | undefined | null): boolean {
  const tt = tokenType ?? '';
  return tt === '' || /^0+$/.test(tt);
}

/**
 * Sum unshielded UTxOs per non-native token color.
 *
 * @returns map of token color → balance in base units. Empty when the wallet
 *          holds only NIGHT. Callers must divide by the token's decimals,
 *          which come from metadata and may be unknown.
 */
export function midnightTokenBalances(
  utxos: ReadonlyArray<MidnightUnshieldedUtxo>,
): Record<string, bigint> {
  // tokenType comes straight from an unvalidated third-party indexer, so a
  // color equal to "constructor"/"__proto__"/etc. must not collide with
  // Object.prototype — a null-prototype object avoids both the inherited-value
  // read (which would silently produce a string instead of a bigint) and the
  // silent-no-op write on `__proto__` (which would drop that color entirely).
  const balances: Record<string, bigint> = Object.create(null);
  for (const u of utxos) {
    const tokenType = u.tokenType ?? '';
    if (isNativeNight(tokenType)) continue;
    balances[tokenType] = (balances[tokenType] ?? 0n) + u.value;
  }
  return balances;
}
