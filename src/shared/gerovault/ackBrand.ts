/**
 * The brand of a manifest acknowledgement: only `checkManifestBeforeAck` creates one, and the
 * funding gate takes nothing else, so a caller cannot hand it a copy or a hand-made result. The
 * brand lives in memory: after a restart the stored manifest is checked again.
 */
import type { ManifestAck } from './manifestCheck';

const ACKS = new WeakSet<object>();

/** Freezes and brands an acknowledgement. For `manifestCheck.ts` only. */
export function brandAck(ack: ManifestAck): ManifestAck {
  const frozen = Object.freeze(ack);
  ACKS.add(frozen);
  return frozen;
}

/** Whether `value` is an acknowledgement `checkManifestBeforeAck` created (not a copy, not a hand-made one). */
export function isManifestAck(value: unknown): value is ManifestAck {
  return typeof value === 'object' && value !== null && ACKS.has(value);
}
