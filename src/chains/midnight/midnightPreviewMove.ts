import { bech32m } from 'bech32';
import { Blockchain, Network } from '@/models/types';

/**
 * Moving Midnight Stagenet wallets to Preview (issue 1453).
 *
 * Stagenet is retired and Preview replaced it as Midnight's public ledger 9
 * test network. The GeroWalletDatabase v18 upgrade (gero-db.ts) rewrites every
 * Midnight Stagenet wallet record with {@link previewMoveOf}: `network` becomes
 * Preview and the bech32m addresses stored in its `publicKey` are re-encoded
 * for Preview. Nothing secret is needed: an address's payload is a public key
 * or its hash, the same on every network, and only the HRP
 * (`mn_addr_stagenet` → `mn_addr_preview`) names the network. So the moved
 * record equals what the phrase derives on Preview, and `canReplaceWalletKey`
 * accepts the next re-derivation as the same account.
 *
 * The record keeps a {@link PreviewMoveStamp} until the wallet next logs in,
 * when midnightPreviewMoveCleanup.ts drops what the old chain left on this
 * device. Pure: no Dexie, no SDK, so gero-db can import it anywhere.
 */

/** The `network` value of a Midnight Stagenet wallet record. Never offered for new wallets. */
export const RETIRED_STAGENET = 'Stagenet';

/** Bech32 strings longer than 90 characters (shielded addresses) need an explicit limit. */
const BECH32_LIMIT = 1023;

/** `mn_<kind>_stagenet`: the HRP of every non-mainnet Midnight address on Stagenet. */
const STAGENET_HRP = /^mn_([a-z][a-z0-9-]*)_stagenet$/;

/** The `publicKey` fields that hold this wallet's own Midnight addresses. */
const ADDRESS_FIELDS = ['unshielded', 'shielded', 'dust'] as const;

/**
 * Left on a moved record until its next login: the Stagenet unshielded address
 * names the local caches to drop (midnightStore's per-wallet scope is keyed by it).
 */
export interface PreviewMoveStamp {
  stagenetUnshielded: string;
}

/**
 * The Preview spelling of a Stagenet bech32m address (`mn_addr_stagenet1…` →
 * `mn_addr_preview1…`), payload unchanged, or null when `address` is not a
 * valid Stagenet address. Idempotent: a Preview address is not a Stagenet one.
 */
export function stagenetToPreviewAddress(address: string): string | null {
  if (typeof address !== 'string' || !address) return null;
  let decoded: { prefix: string; words: number[] };
  try {
    decoded = bech32m.decode(address, BECH32_LIMIT);
  } catch {
    return null;
  }
  const kind = STAGENET_HRP.exec(decoded.prefix)?.[1];
  if (!kind) return null;
  return bech32m.encode(`mn_${kind}_preview`, decoded.words, BECH32_LIMIT);
}

/**
 * A Stagenet record's `publicKey` (its addresses JSON) with every Stagenet
 * address re-encoded for Preview. Every other field (the Cardano twin, the
 * signing key hex, the address hex) is network-independent and kept as is, in
 * the same order. Returns null when the blob is not a JSON object, which the
 * caller leaves untouched (an unreadable key never matches another account,
 * so the next re-derivation may replace it).
 */
export function previewPublicKey(publicKey: string | undefined): string | null {
  if (typeof publicKey !== 'string' || !publicKey) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(publicKey);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const moved: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
  for (const field of ADDRESS_FIELDS) {
    const value = moved[field];
    if (typeof value !== 'string') continue;
    const preview = stagenetToPreviewAddress(value);
    if (preview) moved[field] = preview;
  }
  return JSON.stringify(moved);
}

/** The fields a wallet record has that this move reads. */
export interface PreviewMoveSource {
  chain?: string;
  network?: string;
  publicKey?: string;
}

/** What {@link previewMoveOf} writes onto a moved record. */
export interface PreviewMoveUpdate {
  network: string;
  publicKey?: string;
  previewMovePending: PreviewMoveStamp;
}

/**
 * The update that moves `record` from Stagenet to Preview, or null when it is
 * not a Midnight Stagenet wallet (Cardano Preview wallets, other chains, and
 * records already moved are left alone, so running it twice changes nothing).
 */
export function previewMoveOf(record: PreviewMoveSource | null | undefined): PreviewMoveUpdate | null {
  if (!record || record.chain !== Blockchain.MIDNIGHT || record.network !== RETIRED_STAGENET) return null;
  let stagenetUnshielded = '';
  try {
    const unshielded = (JSON.parse(record.publicKey ?? '') as { unshielded?: unknown })?.unshielded;
    if (typeof unshielded === 'string') stagenetUnshielded = unshielded;
  } catch { /* unreadable blob: nothing scoped to drop */ }
  const publicKey = previewPublicKey(record.publicKey);
  return {
    network: Network.PREVIEW,
    ...(publicKey !== null ? { publicKey } : {}),
    previewMovePending: { stagenetUnshielded },
  };
}

/**
 * A contact's address on Preview: a Stagenet address names the same key on
 * Preview, so a saved Stagenet recipient becomes their Preview address.
 * Anything else (another network's address, a name) is returned unchanged.
 */
export function previewContactAddress(address: string): string {
  return stagenetToPreviewAddress(address) ?? address;
}

/**
 * Per-wallet `config` key of the one-time notice that this wallet moved from
 * Stagenet to Preview (MidnightPreviewMoveNotice.vue): `true` from the login
 * that completes the move until the user dismisses it, then `false`.
 */
export const PREVIEW_MOVE_NOTICE_CONFIG_KEY = 'midnightPreviewMoveNotice';
