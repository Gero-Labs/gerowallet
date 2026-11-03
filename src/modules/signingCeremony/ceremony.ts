/**
 * Helpers for the root holders' signing page (SigningCeremony.vue).
 *
 * A root holder signs a delegation or revocation statement (signedResponseRoots.ts)
 * with the stake key of a hidden hardware-wallet account. Before the result leaves
 * the page it is checked exactly as every wallet will check it, against the key the
 * device reported, so a signature the wallet would refuse (a hashed payload, another
 * text) is never handed to the backend.
 */
import { PINNED_ROOT_KEYS, bytesToHex, daySeconds, hexToBytes, rootSigning } from '@/shared/utils/signedResponseRoots';
import type { SignedStatement } from '@/api/signingKeys';

/** The UTC day `ms` falls on, `YYYY-MM-DD`. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The UTC day `days` after `day`, or undefined for a day that does not exist. */
export function addDays(day: string, days: number): string | undefined {
  const start = daySeconds(day);
  if (start === undefined || !Number.isInteger(days)) return undefined;
  return utcDay((start + days * 24 * 3600) * 1000);
}

/** Comma- or space-separated items, trimmed, without empties. */
export function splitList(text: string): string[] {
  return text.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
}

/** The raw Ed25519 public key in a CIP-8 COSE_Key (label -2), or undefined. */
export async function coseKeyPublicKey(coseKeyHex: string): Promise<Uint8Array | undefined> {
  const bytes = hexToBytes(coseKeyHex);
  if (!bytes || bytes.length === 0) return undefined;
  const MS = await import('@emurgo/cardano-message-signing-browser');
  let key: InstanceType<typeof MS.COSEKey> | undefined;
  try {
    key = MS.COSEKey.from_bytes(bytes);
    const x = key.header(MS.Label.new_int(MS.Int.new_negative(MS.BigNum.from_str('2'))))?.as_bytes();
    return x?.length === 32 ? x : undefined;
  } catch {
    return undefined;
  } finally {
    key?.free();
  }
}

export type CeremonyCheck =
  | { ok: true; rootPublicKeyHex: string; pinned: boolean; entry: SignedStatement }
  | { ok: false; reason: 'no-public-key' | 'not-verified' };

/**
 * Checks a signature the device just returned: it must verify, as the wallet
 * verifies it, over exactly `statement` with the key the device reported.
 */
export async function checkCeremonySignature(
  statement: string,
  coseSign1Hex: string,
  coseKeyHex: string,
  pinned: readonly string[] = PINNED_ROOT_KEYS,
): Promise<CeremonyCheck> {
  const publicKey = await coseKeyPublicKey(coseKeyHex);
  if (!publicKey) return { ok: false, reason: 'no-public-key' };
  if (!(await rootSigning(statement, coseSign1Hex, [publicKey]))) return { ok: false, reason: 'not-verified' };
  const rootPublicKeyHex = bytesToHex(publicKey);
  return {
    ok: true,
    rootPublicKeyHex,
    pinned: pinned.map((key) => key.toLowerCase()).includes(rootPublicKeyHex),
    entry: { statement, coseSign1: coseSign1Hex.toLowerCase() },
  };
}

/** UTF-8 hex of `text`, the form signData takes. */
export function textToHex(text: string): string {
  return bytesToHex(new TextEncoder().encode(text));
}
