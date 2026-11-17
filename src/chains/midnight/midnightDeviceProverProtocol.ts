/**
 * Wire protocol between the background and the offscreen prover document
 * (midnightDeviceProver.ts ↔ src/offscreen/midnightProverOffscreen.ts ↔
 * midnightDeviceProverWorker.ts).
 *
 * The background talks to the prover over ONE long-lived port the offscreen
 * document opens, never over `runtime.sendMessage`: a broadcast would hand
 * the proof preimage (which carries the DUST secret, and with the shielded
 * flag the coin secret key) to every listening extension page. Port messages
 * are JSON, so bytes travel as base64 and bigints as decimal strings.
 *
 * Dependency-free on purpose: imported by the background, the offscreen page
 * and the worker.
 */

export const MIDNIGHT_PROVER_PORT = 'gero-midnight-prover';

/** The offscreen document, relative to the extension root. */
export const MIDNIGHT_PROVER_DOCUMENT = 'offscreen/midnight-prover.html';

export type MidnightProverRequest =
  | {
    type: 'prove';
    id: number;
    keyLocation: string;
    /** base64 of the serialized proof preimage. */
    preimage: string;
    /** Decimal string of the ledger's `overwriteBindingInput`, when it passed one. */
    overwriteBindingInput?: string;
    /** Allow the Zswap circuits for this request (the shielded flag). */
    shielded: boolean;
  }
  | { type: 'check'; id: number; keyLocation: string; preimage: string; shielded: boolean }
  /** Stop the worker and give its memory back. */
  | { type: 'release' };

export type MidnightProverReply =
  | { type: 'result'; id: number; ok: true; proof?: string; check?: (string | null)[]; proveMs?: number }
  | { type: 'result'; id: number; ok: false; error: string }
  /** Sent while a proof runs, so the background's service worker counts as busy. */
  | { type: 'busy' };

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** `check` results are `(bigint | undefined)[]`; JSON carries them as strings and nulls. */
export function encodeCheckResult(result: readonly (bigint | undefined)[]): (string | null)[] {
  return result.map((value) => (value === undefined ? null : value.toString()));
}

export function decodeCheckResult(result: readonly (string | null)[]): (bigint | undefined)[] {
  return result.map((value) => (value === null ? undefined : BigInt(value)));
}
