// Launchpads whose tokens the market list shows next to the DEX-listed ones.
//
// Each launchpad reaches the wallet in two ways, and both must classify the same:
//   - its own feed (`/api/v1/market/<id>` on the market host) carries the
//     pre-graduation bonding-curve tokens, with `source` and `dex` set to the marker;
//   - tokens that graduated to a DEX pool sit in the bulk price list with
//     `source: "<MARKER>_GRADUATE"` and `verified: false`.
// Hence the prefix match on `source`: an exact match would miss the graduates,
// which the verified-only filter would then strip as ordinary unverified tokens.

export type Launchpad = 'snekfun' | 'solada';

export interface LaunchpadDescriptor {
  id: Launchpad;
  /** Upper-case value the market engine writes to `source` (as a prefix) and `dex`. */
  marker: string;
  /** i18n key: the filter label and the badge title. */
  labelKey: string;
  /** Badge and filter icon (mdi). */
  icon: string;
}

export const LAUNCHPADS: Readonly<Record<Launchpad, LaunchpadDescriptor>> = Object.freeze({
  snekfun: { id: 'snekfun', marker: 'SNEKFUN', labelKey: 'market.snekfun', icon: 'mdi-snake' },
  solada: { id: 'solada', marker: 'SOLADA', labelKey: 'market.solada', icon: 'mdi-rocket-launch-outline' },
});

const ORDER: readonly LaunchpadDescriptor[] = [LAUNCHPADS.snekfun, LAUNCHPADS.solada];

/** Which launchpad a market row comes from, or null for an ordinary DEX-listed token. */
export function launchpadOf(source?: string | null, dex?: string | null): Launchpad | null {
  const src = String(source ?? '');
  for (const lp of ORDER) {
    if (src.startsWith(lp.marker) || dex === lp.marker) return lp.id;
  }
  return null;
}
