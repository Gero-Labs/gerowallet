// CIP-113 `programmable_logic_base` script hashes, per network.
//
// Every CIP-113 UTxO on a network sits at this payment credential, with the owner in the
// address's stake slot. There is no on-chain verification and no server allowlist, so a
// wrong hash here makes Gero render UTxOs the user does not own as their own holdings,
// badged CIP-113 — treat a PR touching this file like a change to the scam blacklist.
//
// One array per network, newest deployment first. A re-bootstrap changes the hash while
// existing holdings stay at the old script, so superseded entries are kept until nobody
// holds tokens under them. An EMPTY array means CIP-113 is unsupported on that network
// and discovery fails closed.
//
// Format: blake2b-224, 56 lowercase hex characters, no 0x prefix. `networks.ts`
// re-validates that shape at module scope as defence against a mistyped literal here.

/**
 * Mainnet — MUST stay empty. This array is the only thing keeping CIP-113 off mainnet, so
 * adding a hash here enables the feature there. No mainnet deployment exists, CIP-113 is
 * `Proposed` rather than Active, and the reference implementation's audit is unpublished.
 * Never copy a testnet value here.
 */
export const CIP113_BASE_MAINNET: readonly string[] = [];

/**
 * Preprod — intentionally empty. The reference deployment there predates the current
 * contracts and is not confirmed on-chain. Fills in as the contracts move along.
 */
export const CIP113_BASE_PREPROD: readonly string[] = [];

/**
 * Preview — the 2026-08-26 re-bootstrap (creation tx
 * `a432339cbd7318222c8c51ed4fb52ee4c68f676037622aa7361dd45d897324a4`), confirmed against
 * live UTxOs, and the only one supported.
 *
 * Earlier bootstraps still hold live UTxOs but do not match the current contracts, so they
 * stay out: surfacing balances the wallet cannot reason about is worse than not showing
 * them. That covers `33ceea92481cd6cc5b9ad1750302642042bb8ea5d028b830ad86fc31` (the
 * 2026-08-13 bootstrap this entry replaced, which stopped receiving UTxOs before this one
 * started) and `f2182b00a37bd746e20575c9af01ab31312213514cd31e872e0a2a3e`, which CIP-113's
 * own "Preview testnet parameters" section documents — do not add either back on that
 * basis.
 *
 * KEEP THIS COMMENT IN STEP WITH THE VALUE. A hash swapped without updating the date and
 * creation tx below leaves the file asserting provenance for a deployment it no longer
 * lists, and the provenance is the only check there is.
 */
export const CIP113_BASE_PREVIEW: readonly string[] = [
  '698c48a630206282690774aebcfa9410895c09f85bc103b19f9888dc',
];
