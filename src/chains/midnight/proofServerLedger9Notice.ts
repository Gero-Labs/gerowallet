/**
 * One-time notice: "Update your local proof server to 9.0.x" (issue 1475).
 *
 * Midnight mainnet and preprod moved from ledger 8 to ledger 9, and a ledger 8
 * proof server (8.1.0) can't prove for them. Users in local mode see the
 * notice, with the ledger 9 command, in Settings → Proof server and in the
 * send dialog, until they dismiss it or a check finds their local server on
 * the right release (useProofServerSettings). Never shown in Gero Cloud or
 * zkPaaS mode, nor on a chain still on ledger 8.
 *
 * The dismissal lives in the extension origin's localStorage, like
 * proofServerRestartNotice.ts: a per-profile convenience that content scripts
 * can't reach, and that shows the notice again if storage is unavailable.
 */

import { ref } from 'vue';
import type { MidnightLedger } from './midnightLedger';

export const PROOF_SERVER_LEDGER9_NOTICE_KEY = 'gero.proofServerLedger9Notice.done';

/** True once dismissed. Unreadable storage counts as not dismissed. */
function readDone(): boolean {
  try {
    return localStorage.getItem(PROOF_SERVER_LEDGER9_NOTICE_KEY) !== null;
  } catch {
    return false;
  }
}

/** Shared by every mounted notice, so dismissing one hides the others. */
const done = ref(readDone());

export function isProofServerLedger9NoticeDone(): boolean {
  return done.value;
}

export function markProofServerLedger9NoticeDone(now: number = Date.now()): void {
  done.value = true;
  try {
    localStorage.setItem(PROOF_SERVER_LEDGER9_NOTICE_KEY, String(now));
  } catch {
    // Storage unavailable: hidden for this page only, shown again next time.
  }
}

export function proofServerLedger9NoticeWanted(input: {
  mode: 'remote' | 'local' | 'zkpaas';
  ledger: MidnightLedger;
  done: boolean;
}): boolean {
  return !input.done && input.mode === 'local' && input.ledger === 9;
}

/** Test hook: re-read the stored dismissal. */
export function resetProofServerLedger9NoticeForTests(): void {
  done.value = readDone();
}
