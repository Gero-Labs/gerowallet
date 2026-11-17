// Broadcast announcements: is this document for this install? (pure)
//
// The audience is inside the signed bytes, so the server cannot widen it: a document signed for
// iOS, for another network or for a newer version is ignored here whatever the feed says.

import type { AnnouncementDocument } from './announcementRules';

export interface InstallInfo {
  /** This extension's version, e.g. `2.9.0`. */
  version: string;
  /** Wire network ids of the installed Cardano wallets: `cardano-mainnet`, `cardano-preprod`, `cardano-preview`. */
  networks: readonly string[];
}

/** Dotted numeric compare; a missing part is 0, so `2.9` equals `2.9.0`. Negative, zero or positive. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((p) => Number.parseInt(p, 10) || 0);
  const pb = b.split('.').map((p) => Number.parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** `Mainnet` / `Preprod` / `Preview` of a Cardano wallet as the wire id an audience names. */
export function wireNetwork(chain: string, network: string): string | null {
  return chain === 'Cardano' && ['Mainnet', 'Preprod', 'Preview'].includes(network) ? `cardano-${network.toLowerCase()}` : null;
}

export function isForThisInstall(doc: AnnouncementDocument, install: InstallInfo): boolean {
  if (!doc.platforms.includes('extension')) return false;
  const min = doc.minVersion['extension'];
  if (min !== undefined && compareVersions(install.version, min) < 0) return false;
  // No network named: for everyone. Otherwise only for an install that has a wallet on one of them.
  return doc.networks.length === 0 || doc.networks.some((n) => install.networks.includes(n));
}
