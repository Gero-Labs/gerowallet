/**
 * The proving flags as the background reads them: whether Gero Prover (the
 * desktop helper) is offered, and whether the browser prover may use its
 * multi-threaded build.
 *
 * `isMidnightThreadedProvingEnabled` ships off. It chooses between two builds
 * of the same prover, both verified against pins and both in the extension
 * package (midnightZkirThreads.ts), so it is a speed setting, not a trust
 * decision: off, unreadable or unsupported all mean the standard build.
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
export const THREADED_PROVING_FLAG = 'isMidnightThreadedProvingEnabled';

/** The browser prover may use its multi-threaded build. */
export async function threadedProvingOffered(): Promise<boolean> {
  return (await readFeatureFlagMirror())[THREADED_PROVING_FLAG] === true;
}

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

/**
 * The options `walletProverFor` takes, for a stored preference: which of the
 * user's choices under "This computer" are on offer. Reads the mirror only
 * for the choice that needs it.
 */
export async function localProvingOffersFor(ps: { mode: string; localEngine?: string }): Promise<{ helper: boolean; browser: boolean }> {
  return {
    helper: await geroProverOfferedFor(ps),
    browser: ps.mode === 'local' && ps.localEngine === 'browser' && await threadedProvingOffered(),
  };
}
