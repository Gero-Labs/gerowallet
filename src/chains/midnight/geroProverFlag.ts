/**
 * Whether Gero Prover is offered in this page: the `isGeroProverEnabled` flag
 * (default off, see its declaration in featureFlagsStore.ts).
 *
 * One reader for every page surface, and deliberately strict: anything but an
 * explicit `true` in the flag store's state is off, so a store that has not
 * loaded the flag (or does not carry it at all) reads as off, which is the
 * shipped behaviour. The background has its own reader (midnightHelperOffer.ts).
 */
import { featureFlagsStore } from '@/stores/featureFlagsStore';

export function geroProverOfferedHere(): boolean {
  const flags = (featureFlagsStore as { state?: { flags?: Record<string, unknown> } }).state?.flags;
  return flags?.['isGeroProverEnabled'] === true;
}
