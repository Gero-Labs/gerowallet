/**
 * Bounds of a phase 1 vault spend. Client release constants: the signing device applies them
 * whatever the proposer's build chose.
 */

/** A native vault refuses to sign a fee above 2 ADA. */
export const NATIVE_FEE_MAX_LOVELACE = 2_000_000n;
/** Above 0.5 ADA the approval sheet warns about the fee. */
export const NATIVE_FEE_WARN_LOVELACE = 500_000n;

/** Shelley slots last one second on every network a vault lives on. */
const SLOTS_PER_HOUR = 3600;
/** A proposal is valid for 48 hours by default. */
export const DEFAULT_VALIDITY_SLOTS = 48 * SLOTS_PER_HOUR;
/** And for 7 days at most: the signing device refuses a later expiry. */
export const MAX_VALIDITY_SLOTS = 7 * 24 * SLOTS_PER_HOUR;
/** A validity start may lie this far ahead of the tip (clock and sync drift), no further. */
export const VALIDITY_START_TOLERANCE_SLOTS = 10 * 60;

/** Every signing file is small JSON; anything larger is refused before it is parsed. */
export const MAX_BUNDLE_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_WITNESS_FILE_BYTES = 64 * 1024;
/** Inputs one bundle may name. A transaction of 16 KiB cannot hold many more. */
export const MAX_BUNDLE_INPUTS = 256;
