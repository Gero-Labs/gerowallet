/**
 * One-time notice: "Restart your local proof server".
 *
 * Older builds suggested starting the local proof server in verbose mode,
 * which writes request contents, including private transaction inputs, to
 * the container log. The suggested command no longer has the flag
 * (midnightProofServerCommand); this notice tells the users who may have run
 * the old one to restart the server and remove the old container.
 *
 * Shown to anyone who has the proof server mode set to "local", has saved a
 * local proof server URL, or has "Prove for your phone" turned on. Never to
 * someone who only used Gero Cloud or Arkhia. It stays until the user
 * presses Done; the dismissal lives in the extension origin's localStorage
 * (not chrome.storage.local, which content scripts can rewrite), so it
 * survives a browser restart.
 */

import {
  DEFAULT_LOCAL_PROOF_SERVER_URL,
  DEFAULT_LOCAL_PROOF_SERVER_URL_LEDGER9,
} from './midnightConfig';

export const PROOF_SERVER_RESTART_NOTICE_KEY = 'gero.proofServerRestartNotice.done';

/** The parts of the proof server preference the audience check reads. */
export interface ProofServerPreferenceSnapshot {
  mode: 'remote' | 'local' | 'zkpaas';
  localUrl: string;
  localUrlLedger9: string;
}

/**
 * Whether this device may have run the old command: local mode, a saved local
 * URL (either ledger), or Cross-Device Proving switched on.
 */
export function mayHaveRunLocalProofServer(
  proofServer: ProofServerPreferenceSnapshot,
  serveProofs: boolean,
): boolean {
  if (proofServer.mode === 'local') return true;
  if (proofServer.localUrl !== DEFAULT_LOCAL_PROOF_SERVER_URL) return true;
  if (proofServer.localUrlLedger9 !== DEFAULT_LOCAL_PROOF_SERVER_URL_LEDGER9) return true;
  return serveProofs;
}

export function proofServerRestartNoticeWanted(input: {
  proofServer: ProofServerPreferenceSnapshot;
  serveProofs: boolean;
  done: boolean;
}): boolean {
  return !input.done && mayHaveRunLocalProofServer(input.proofServer, input.serveProofs);
}

/** True once the user pressed Done. Unreadable storage counts as not done. */
export function isProofServerRestartNoticeDone(): boolean {
  try {
    return localStorage.getItem(PROOF_SERVER_RESTART_NOTICE_KEY) !== null;
  } catch {
    return false;
  }
}

export function markProofServerRestartNoticeDone(now: number = Date.now()): void {
  try {
    localStorage.setItem(PROOF_SERVER_RESTART_NOTICE_KEY, String(now));
  } catch {
    // Storage unavailable: the notice shows again next time, which is the safe side.
  }
}
