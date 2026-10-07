import { Network } from '@/models/types';

// CIP-113 `programmable_logic_base` script hashes, per network.
//
// Every CIP-113 UTxO on a network sits at this payment credential, with the owner in the
// address's stake slot. There is no on-chain verification and no server allowlist, so a
// wrong hash here makes Gero render UTxOs the user does not own as their own holdings,
// badged CIP-113 — treat a PR touching this file like a change to the scam blacklist.
//
// One array per network. An EMPTY array means CIP-113 is unsupported on that network and
// discovery fails closed.
//
// THESE DEPLOYMENTS ARE PERMANENT. CIP-113 is live on all three networks and is not going
// to be re-bootstrapped: the current deployments were built with upgradability, and any
// contract change is made by upgrading them in place. An upgrade is not expected to change
// these hashes; if one ever does, handle it as a rotation under the rules below.
//
// If a hash ever does change:
//  - Mainnet (hard rule): RETAIN the superseded hash next to its replacement until its
//    holdings drain. Removing it would hide every user's existing holdings at once and
//    leave their lovelace inside the balance as apparently spendable ADA (see the last
//    point below), so max-send and swap sizing would build transactions that fail. APPEND
//    the new hash (classifyUtxoAddress already takes a set) and remove the old one only once
//    nothing meaningful is left at it.
//  - Preview and preprod: upgrading in place is preferred there too, but not a hard rule.
//    The earlier testnet bootstraps listed below predate the current contracts and were
//    REMOVED rather than retained; surfacing holdings the wallet cannot reason about is
//    worse than not showing them on a testnet. Removed (and deliberately excluded) hashes
//    are recorded below each list so nobody re-adds one by mistake.
//
// What removal means for a UTxO still sitting at a removed script, which
// classifyUtxoAddress then calls 'foreign':
//  - it is not displayed;
//  - it is not in the signing refusal index;
//  - it never reaches coin selection (a base address with a script payment credential is
//    never 'spendable');
//  - its lovelace is NOT subtracted as locked. The provider's stake-level
//    `controlled_amount` includes it, so the balance figure that max-send, swap sizing and
//    the portfolio read as spendable overstates what coin selection can actually use, by
//    exactly that amount. Accepted on preview and preprod only; it is why mainnet must
//    retain a superseded hash instead.
//
// Format: blake2b-224, 56 lowercase hex characters, no 0x prefix. `networks.ts`
// re-validates that shape at module scope as defence against a mistyped literal here.
//
// Provenance of the current deployments (all three bootstrapped 2026-10-02, with
// upgradability):
//  - source: cardano-foundation/cip113-programmable-tokens @
//    `6b75ba3286b4692ca23059ff51285db357fb09c6`, the "Fixes Verified Commit" of the
//    published upgradability audit
//    (documentation/audit/cip-113-programmable-tokens-upgradability-audit-report.pdf)
//  - compiler: Aiken `v1.1.23+8949565`
//  - verification: the uplc.link record per network below rebuilds the script from that
//    commit and compares it with the bytes deployed on-chain.
//
// KEEP THE PROVENANCE IN STEP WITH THE VALUE. A hash swapped without updating its bootstrap
// tx and verification link leaves this file asserting provenance for a deployment it no
// longer lists, and the provenance is the only check there is.

/**
 * Mainnet. Bootstrap tx `bfefbd222e40d88f5d4454e92b24062533070f41a3e25c0a23383264650cdb72`,
 * verified at https://uplc.link/verify?txHash=bfefbd222e40d88f5d4454e92b24062533070f41a3e25c0a23383264650cdb72
 *
 * No earlier mainnet deployment exists, and none is planned: changes ship as upgrades. If
 * this hash is ever superseded anyway, keep it here next to its replacement until its
 * holdings drain (see above).
 */
export const CIP113_BASE_MAINNET: readonly string[] = [
  'd91d08e381f8ef95ffbb3f8048f020d7361ded8f3abfdf66c25fa838',
];

/**
 * Preprod. Bootstrap tx `f4118e53fc0fac1dddf96c6dcc3b4670265f25558d9943feb4ee564488f5c896`,
 * verified at https://preprod.uplc.link/verify?txHash=f4118e53fc0fac1dddf96c6dcc3b4670265f25558d9943feb4ee564488f5c896
 *
 * Removed, do not re-add: `a48744c1584c58c2995cba1fa26b37f3999ee8cedac0ef241662f53d` (the
 * reference platform's earlier preprod bootstrap).
 */
export const CIP113_BASE_PREPROD: readonly string[] = [
  'be59f7750a5d947bb649e70d574d066791ec34a1dfee2a087c8511e3',
];

/**
 * Preview. Bootstrap tx `8e9668a6432ea4567bb1deba919c0f76adcce8373d6d89d1a06faee2c83d00f9`,
 * verified at https://preview.uplc.link/verify?txHash=8e9668a6432ea4567bb1deba919c0f76adcce8373d6d89d1a06faee2c83d00f9
 *
 * Removed or excluded, do not re-add:
 *  - `698c48a630206282690774aebcfa9410895c09f85bc103b19f9888dc` — the 2026-08-26
 *    re-bootstrap (creation tx
 *    `a432339cbd7318222c8c51ed4fb52ee4c68f676037622aa7361dd45d897324a4`), which this entry
 *    replaced
 *  - `33ceea92481cd6cc5b9ad1750302642042bb8ea5d028b830ad86fc31` — the 2026-08-13 bootstrap
 *  - `8adfe689f4049706f893745f9e8af24cc2cade650de9bac05e3d403f` — the bootstrap before that
 *  - `f2182b00a37bd746e20575c9af01ab31312213514cd31e872e0a2a3e` — never shipped: the value
 *    CIP-113's own "Preview testnet parameters" section documents, excluded because it
 *    does not match the contracts Gero supports; do not add it on that basis
 */
export const CIP113_BASE_PREVIEW: readonly string[] = [
  '35622813d81ba2d6e068c7d52f6fdad5aa2a5d84b212ec3e28716c16',
];

/**
 * Networks where CIP-113 may run at all. Together with the hash lists above this is the
 * whole gate: two build-time constants, both of which must pass.
 *
 * Why this exists rather than relying on an empty array: otherwise adding a hash to one of
 * the lists would by itself bring that network live on the next build. That collapses two
 * intended approvals into one edit, by someone whose intent was only "record the
 * deployment that now exists". Keeping the allowlist separate means enabling a network is
 * always a deliberate two-line change here, reviewed together.
 *
 * LIVE ON ALL THREE NETWORKS: mainnet, preprod and preview are all allowlisted and all
 * carry a deployment, so CIP-113 is live on each of them.
 *
 * What going live changes on mainnet beyond the display: `WalletBg.subscriptionCredentials()`
 * sends gero-sync an empty credential list, so UTxOs are resolved by stake address instead
 * of being pre-filtered by payment key, and `classifyUtxoAddress` filters client-side.
 */
export const CIP113_ALLOWED_NETWORKS: readonly string[] = [Network.MAINNET, Network.PREPROD, Network.PREVIEW];
