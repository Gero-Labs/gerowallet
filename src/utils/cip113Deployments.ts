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

// CIP-113 REGISTRY node policies, per network (issue 1267). A UTxO at the PLB address can
// hold any token: paying into a script runs no validator, so anyone can send a token to
// (PLB script, a user's stake key). Only a policy listed in the deployment's registry is a
// CIP-113 token; the rest are shown as ordinary unverified tokens, never with the CIP-113
// badge.
//
// What the value is: the registry is one script per deployment whose mint and spend share a
// hash, so its node NFT policy id IS that script hash. Insert mints one node NFT per
// registered policy, named after the policy id (`tn == node.key`, lib/linked_list.ak), and
// nodes are never removed (RegistryRedeemer is only RegistryInit and RegistryInsert,
// lib/types.ak), both in cardano-foundation/cip113-programmable-tokens @
// `6b75ba3286b4692ca23059ff51285db357fb09c6`. So the assets minted under this policy, read
// through Nexus, are exactly the registered policies.
//
// Same review bar as the PLB hashes above: a wrong value here fails CLOSED (no policy reads as
// registered, so nothing gets the CIP-113 badge), but a different deployment's registry would
// vouch for its tokens. List the registry of every deployment the PLB list keeps.
//
// Provenance: `registry.scriptHash` of each network's record in
// cardano-foundation/cip113-programmable-tokens-platform @
// `ab75bd5d16f4c7d5e5a5ced54ec3bf3d5ff775ce`,
// src/programmable-tokens-offchain-java/src/main/resources/protocol-bootstraps-<network>.json,
// whose `txHash` is the bootstrap tx recorded above and whose `programmableLogicBase` is the
// PLB hash above.

/** Mainnet registry. Record for bootstrap tx `bfefbd22…cdb72` (PLB `d91d08e3…fa838`). */
export const CIP113_REGISTRY_MAINNET: readonly string[] = [
  '484e733d122af44e6101988bcc47ed261a7af5c43c797e89d60e3075',
];

/** Preprod registry. Record for bootstrap tx `f4118e53…5c896` (PLB `be59f775…511e3`). */
export const CIP113_REGISTRY_PREPROD: readonly string[] = [
  '3083d387537f9318b6ff5aeab7de5f5629d26495319b8fafd409222a',
];

/** Preview registry. Record for bootstrap tx `8e9668a6…d00f9` (PLB `35622813…16c16`). */
export const CIP113_REGISTRY_PREVIEW: readonly string[] = [
  'e5b339ef5b16d6c460759aca1d60e5e045a6f01da4a11b4ee0fec09a',
];

// CIP-113 `programmable_logic_global` (PLG) stake-script hashes, per network. Every CIP-113
// transfer withdraws 0 from this script, whoever builds it. Two uses:
//  - the dApp-facing signing guard refuses a transaction that withdraws one of these while
//    needing one of the wallet's keys, which covers a programmable UTxO not yet synced into
//    the refusal index. A wrong value here can only cause extra refusals.
//  - Gero's own Send checks the withdrawal set of the transfer Nexus built.
//
// Provenance: the first credential of each deployment's protocol-params datum (the UTxO
// holding the params NFT, at the bootstrap tx recorded above, output 0), and the reference
// script at the deployment's reference-script output 1. Checked on chain through Koios on
// 2026-10-29. Same review bar as the PLB hashes.

/** Mainnet PLG. Params datum at `bfefbd22…cdb72#0`; script created in tx `a488bac5…`. */
export const CIP113_GLOBAL_MAINNET: readonly string[] = [
  '46b61f0584f21481b22ea18f945e48ac4148f50fc3ade494a7762440',
];

/** Preprod PLG. Params datum at `f4118e53…5c896#0`; reference script `e24679be…6b59#1`. */
export const CIP113_GLOBAL_PREPROD: readonly string[] = [
  'b4e81fa9a3291025cd279067daf4e43578d4c3f759e5490958f58cf6',
];

/** Preview PLG. Params datum at `8e9668a6…d00f9#0`; reference script `f543e7b8…b6dd#1`. */
export const CIP113_GLOBAL_PREVIEW: readonly string[] = [
  '3b212b37b1a1fb334539c42e7473376a7fc15b60c26ae0fd4d06279e',
];

// The core CIP-113 `transfer` stake-script hashes, per network: the third credential of the
// same params datum, the reference script at output 2. Only Send reads these, so only the
// networks Send supports list one. Checked on chain through Koios on 2026-10-29.

/** Mainnet: none, so Send is unsupported there (decision 11). */
export const CIP113_TRANSFER_MAINNET: readonly string[] = [];

/** Preprod core transfer. Reference script `e24679be…6b59#2`. */
export const CIP113_TRANSFER_PREPROD: readonly string[] = [
  '5ff03dd084ec86a164dbf9bfe890605fe9fcba8d6657328eab8bb350',
];

/** Preview core transfer. Reference script `f543e7b8…b6dd#2`. */
export const CIP113_TRANSFER_PREVIEW: readonly string[] = [
  '5fe7c82a32a69e5839e9da77e1e9992c1e55f7d372c3d58d8f744ef7',
];

/**
 * Networks where Gero's own Send may build a CIP-113 transfer. A separate allowlist for the
 * same reason as CIP113_ALLOWED_NETWORKS below: recording a transfer hash must not by itself
 * bring Send up on a network. Mainnet needs its own review and test send first (decision 11).
 */
export const CIP113_SEND_ALLOWED_NETWORKS: readonly string[] = [Network.PREPROD, Network.PREVIEW];

/**
 * Hardware wallets (`WalletType` values: 'Ledger', 'Trezor', 'Keystone') that Gero's own Send
 * may ask to sign a CIP-113 transfer. EMPTY until each device has signed a real transfer on
 * preprod: the signers map required signers by key hash and ask for the stake key only for
 * the wallet's own withdrawals and certificates, but a passing spec is not a device run.
 * The worker's prepare and the Send button both read this list, so empty is exactly the
 * software-only behaviour. Any other value in it is ignored.
 */
export const CIP113_SEND_HARDWARE_WALLET_TYPES: readonly string[] = [];

const HARDWARE_WALLET_TYPES: readonly string[] = ['Ledger', 'Trezor', 'Keystone'];

/** Whether Send may ask this hardware wallet type to sign. False for every software type. */
export function isCip113SendHardware(
  walletType: string | null | undefined,
  allowed: readonly string[] = CIP113_SEND_HARDWARE_WALLET_TYPES,
): boolean {
  return typeof walletType === 'string' && HARDWARE_WALLET_TYPES.includes(walletType) && allowed.includes(walletType);
}

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
