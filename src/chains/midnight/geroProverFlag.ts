/**
 * The proving flags as the pages read them. Whether Gero Prover is offered in
 * this page: the `isGeroProverEnabled` flag (default off, see its declaration
 * in featureFlagsStore.ts).
 *
 * One reader for every page surface, and deliberately strict: anything but an
 * explicit `true` in the flag store's state is off, so a store that has not
 * loaded the flag (or does not carry it at all) reads as off, which is the
 * shipped behaviour. The background has its own reader (midnightProvingFlags.ts).
 */
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { threadedProvingPlan } from './midnightZkirThreads';

function flagOn(name: string): boolean {
  const flags = (featureFlagsStore as { state?: { flags?: Record<string, unknown> } }).state?.flags;
  return flags?.[name] === true;
}

export function geroProverOfferedHere(): boolean {
  return flagOn('isGeroProverEnabled');
}

/**
 * Whether the browser prover may use several processor threads, and "In this
 * browser" is offered under This computer: `isMidnightThreadedProvingEnabled`
 * (default off). Read the same strict way.
 */
export function threadedProvingOfferedHere(): boolean {
  return flagOn('isMidnightThreadedProvingEnabled');
}

/**
 * The line under "Proving on this device" while the browser prover works on
 * several threads ("8 processor threads"), already translated. Undefined when
 * it proves on one, and the timeline then keeps its usual hint.
 */
export function browserThreadsLabel(t: (key: string, params?: Record<string, unknown>) => string): string | undefined {
  if (!threadedProvingOfferedHere()) return undefined;
  const { threads } = threadedProvingPlan(globalThis.navigator?.hardwareConcurrency);
  return threads > 1 ? t('midnight.send.provingThreadsHint', { n: threads }) : undefined;
}

/**
 * Which ways of proving on this computer, beyond the Docker server, are on
 * offer: the options `walletProverFor` takes. Every page surface passes this,
 * so they cannot disagree about who proves a send.
 */
export function localProvingOffersHere(): { helper: boolean; browser: boolean } {
  return { helper: geroProverOfferedHere(), browser: threadedProvingOfferedHere() };
}
