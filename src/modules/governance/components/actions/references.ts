/**
 * CIP-100 `references[]` -> numbered, safe links for the action detail page.
 *
 * Two rules, both of which the previous inline version got wrong:
 *
 *  1. The label and the href are resolved TOGETHER, per entry. Zipping a
 *     FILTERED link array back against `references[i]` slides every label onto
 *     the wrong link the moment one entry carries a non-http uri (ipfs://,
 *     mailto:, empty, malformed), which the safe-URL guard drops.
 *  2. `number` is the entry's position in the ORIGINAL array, so a `[2]` marker
 *     in the prose still points at the second reference even when the first was
 *     dropped as unsafe. Renumbering the survivors would silently repoint every
 *     marker after the gap.
 *
 * Reference metadata is authored by whoever submitted the action, so the uri is
 * attacker-controlled: only http(s) survives, and the brand icon is matched on
 * the parsed hostname rather than on a substring.
 */

import { iconForUrl, parseSafeUrl } from '@/shared/utils/externalLink';
import type { GovReference } from '@/api/governance.types';

export interface ReferenceLink {
  href: string;
  icon: string;
  label: string;
  /** 1-based position in the original references array. */
  number: number;
}

export function toReferenceLinks(references: GovReference[] | null | undefined): ReferenceLink[] {
  if (!Array.isArray(references)) return [];
  return references.reduce<ReferenceLink[]>((acc, reference, i) => {
    const url = parseSafeUrl(reference?.uri);
    if (!url) return acc;
    acc.push({
      href: url.href,
      icon: iconForUrl(reference?.uri),
      // An EMPTY-STRING label is real in this data, not merely absent, so the
      // fallback chain stays `||` and must never become `??`.
      label: reference?.label || url.hostname,
      number: i + 1,
    });
    return acc;
  }, []);
}

/**
 * DOM id of the rendered list entry for reference `index`.
 *
 * Deliberately NOT used as an `href="#…"`. The extension runs a hash-mode
 * router, so a bare fragment link does not scroll anywhere — it rewrites the
 * route in the address bar, and reloading that address hits the catch-all and
 * redirects to the wallet home, losing the proposal. The prose marker is a
 * button and the view scrolls this element into view itself.
 */
export function referenceElementId(index: number): string {
  return `gov-ref-${index}`;
}

/**
 * Whether an inline `[n]` marker has an entry to jump to.
 * A marker whose reference was dropped as unsafe, or which has no entry at all,
 * never gets an invented destination — and never renders as a control either.
 */
export function hasReferenceIndex(links: ReferenceLink[]): (index: number) => boolean {
  const available = new Set(links.map(link => link.number));
  return index => available.has(index);
}
