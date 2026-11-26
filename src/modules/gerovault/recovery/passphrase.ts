/**
 * The export screen's passphrase rules (spec 6.8): a generated passphrase shown as four groups of
 * four and confirmed by retyping one group chosen at random, or the user's own of at least 16 code
 * points with one line of advice below 24. The library's own rules decide what a passphrase is
 * (`recoveryFormat.ts`); this file only shapes them for the screen.
 */
import {
  RECOVERY_PASSPHRASE_MIN_CODE_POINTS,
  normalizeRecoveryPassphrase,
  recoveryPassphraseProblem,
} from '@/shared/gerovault';

export const PASSPHRASE_GROUP_COUNT = 4;
/** Below this many code points an own passphrase gets one line of advice; there is no strength meter. */
export const OWN_PASSPHRASE_ADVICE_BELOW = 24;

/** The four groups of a generated passphrase (`XXXX-XXXX-XXXX-XXXX`). */
export function passphraseGroups(generated: string): readonly string[] {
  return generated.split('-');
}

/** A group index drawn uniformly with the platform's random generator. */
export function randomGroupIndex(count = PASSPHRASE_GROUP_COUNT): number {
  const bytes = crypto.getRandomValues(new Uint8Array(1));
  // 256 is a multiple of 4, so the low two bits are uniform for the default count.
  const index = bytes[0] % count;
  bytes.fill(0);
  return index;
}

/**
 * Whether what the user typed is the group asked for. The same folding as the library's probe for a
 * generated passphrase: spaces and hyphens ignored, a to z read as A to Z, O as 0, I and L as 1.
 */
export function groupMatches(typed: string, group: string): boolean {
  const folded = typed
    .replace(/[\s-]/g, '')
    .replace(/[a-z]/g, c => c.toUpperCase())
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  return folded.length > 0 && folded === group;
}

/**
 * - `TOO_SHORT`: fewer than 16 code points once normalised.
 * - `CONTROL_CHARACTER`, `NOT_WELL_FORMED`: what the writer refuses.
 * - `MISMATCH`: the two entries are not the same passphrase.
 */
export type OwnPassphraseProblem = 'TOO_SHORT' | 'CONTROL_CHARACTER' | 'NOT_WELL_FORMED' | 'MISMATCH';

export interface OwnPassphraseCheck {
  readonly problem?: OwnPassphraseProblem;
  /** Accepted, but shorter than 24 code points: show the one line of advice. */
  readonly advice: boolean;
}

/** Checks the user's own passphrase and its repetition. An empty repetition is not yet a mismatch. */
export function checkOwnPassphrase(passphrase: string, repeat: string): OwnPassphraseCheck {
  const problem = recoveryPassphraseProblem(passphrase);
  if (problem === 'NOT_TEXT' || problem === 'TOO_SHORT') return { problem: 'TOO_SHORT', advice: false };
  if (problem) return { problem, advice: false };
  const length = Array.from(normalizeRecoveryPassphrase(passphrase)).length;
  const advice = length < OWN_PASSPHRASE_ADVICE_BELOW;
  if (repeat.length > 0 && normalizeRecoveryPassphrase(repeat) !== normalizeRecoveryPassphrase(passphrase)) {
    return { problem: 'MISMATCH', advice };
  }
  return { advice };
}

/** Whether the own passphrase can be used: no problem and the repetition given. */
export function ownPassphraseReady(passphrase: string, repeat: string): boolean {
  return repeat.length > 0 && checkOwnPassphrase(passphrase, repeat).problem === undefined;
}

export { RECOVERY_PASSPHRASE_MIN_CODE_POINTS };
