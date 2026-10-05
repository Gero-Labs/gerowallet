import { Network } from '@/models/types';

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

export const CIP113_BASE_MAINNET: readonly string[] = [
  'd91d08e381f8ef95ffbb3f8048f020d7361ded8f3abfdf66c25fa838'
];

export const CIP113_BASE_PREPROD: readonly string[] = [
  'be59f7750a5d947bb649e70d574d066791ec34a1dfee2a087c8511e3'
];

export const CIP113_BASE_PREVIEW: readonly string[] = [
  '35622813d81ba2d6e068c7d52f6fdad5aa2a5d84b212ec3e28716c16',
];

/**
 * Networks where CIP-113 may run at all — a SECOND per-network gate, independent of both
 * the hash lists above and the `isCip113Enabled` flag.
 *
 * Why this exists rather than relying on an empty array: `isCip113Enabled` is a single
 * GLOBAL boolean with no network in it, so once it is on, adding a hash to one of the
 * arrays above is by itself enough to bring that network live on the next build. That
 * collapses two intended approvals into one edit, by someone whose intent was only "record
 * the deployment that now exists". Keeping the allowlist separate means enabling a network
 * is always a deliberate two-line change here, reviewed together.
 *
 * Mainnet, preprod and preview are all allowlisted and all carry a deployment, so on every
 * Cardano network the `isCip113Enabled` flag is now the only thing standing between a
 * build and live CIP-113 discovery. Turning that flag on enables mainnet too.
 */
export const CIP113_ALLOWED_NETWORKS: readonly string[] = [Network.MAINNET, Network.PREPROD, Network.PREVIEW];
