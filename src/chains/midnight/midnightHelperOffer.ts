/**
 * Whether Gero Prover is offered, as the background reads it.
 *
 * The `isGeroProverEnabled` flag ships off. In the pages it comes from the flag
 * store; the background reads the mirror the pages keep in the extension-origin
 * private store (featureFlagMirror.ts), which no content script can write.
 *
 * The flag only ever narrows: the helper proves a transaction when the user's
 * stored choice (`proofServer.localEngine`, a trusted field) says so AND the
 * flag is on. Off, or unreadable, the choice reads as the Docker proof server,
 * exactly as before the helper existed. Nothing is sent to the helper, and no
 * check is skipped, because a flag said so.
 */
import { readFeatureFlagMirror } from '@/shared/utils/featureFlagMirror';

export const GERO_PROVER_FLAG = 'isGeroProverEnabled';

export async function geroProverOffered(): Promise<boolean> {
  return (await readFeatureFlagMirror())[GERO_PROVER_FLAG] === true;
}

/**
 * The same, for a stored preference: the mirror is read only when the user
 * chose the helper, so nothing is read (and nothing changes) for anyone else.
 */
export async function geroProverOfferedFor(ps: { mode: string; localEngine?: string }): Promise<boolean> {
  return ps.mode === 'local' && ps.localEngine === 'helper' && await geroProverOffered();
}
