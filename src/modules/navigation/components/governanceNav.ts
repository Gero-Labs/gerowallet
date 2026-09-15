/**
 * The drawer's Governance section.
 *
 * It was a single expandable row with a submenu, and the submenu is what caused
 * the bug this module was first written for: standing on `/governance/dreps`
 * with the group collapsed, Actions was not gated — it simply was not in the
 * DOM, and no navigation inside the group could bring it back. Deriving the
 * open state fixed that; making the pages a SECTION of their own removes the
 * question. Every governance page is now a row like any other, always visible,
 * one click from anywhere.
 *
 * The list lives outside the SFC because two invariants ride on it and both are
 * cheap to break in a merge:
 *
 *  - Every link must be a route the router actually declares. The DRep
 *    directory was lost to a merge once already, and a nav row pointing at
 *    nothing looks identical to one that is merely unreachable.
 *  - Only registration rides the voting sub-flag. It posts a deposit and a
 *    certificate on chain, so it is gated on top of the master governance gate
 *    — and the router gates the same route the same way. A row visible here
 *    that the router redirects away from is worse than no row at all.
 */

import assts from '@/utils/assets';

/** Every route in this section shares this prefix. */
export const GOVERNANCE_PREFIX = '/governance';

/** A row in the Governance section. `flag` narrows the section's gate, never widens it. */
export interface GovernanceNavItem {
  /** i18n key for the label. */
  titleKey: string;
  link: string;
  /** An `mdi-` name, or an imported SVG the drawer masks to the chain accent. */
  icon: string;
  /**
   * 'voting' rides the governance VOTING sub-flag on top of the master gate,
   * mirroring the router's extra `governanceRegister` maintenance case.
   */
  flag?: 'voting';
}

/**
 * The section, in order.
 *
 * Icons: `assts.governance` stays with My governance, the page it has always
 * meant. `assts.dao` sits on DReps — it depicts a collective, which is what a
 * body of representatives is. (It no longer competes with a Gero DAO row: that
 * row and its `/dao` route were retired.)
 */
export const GOVERNANCE_ITEMS: readonly GovernanceNavItem[] = Object.freeze([
  { titleKey: 'navigation.governanceMe', link: '/governance/me', icon: assts.governance },
  { titleKey: 'governance.dReps', link: '/governance/dreps', icon: assts.dao },
  { titleKey: 'common.actions', link: '/governance/actions', icon: 'mdi-gavel' },
  {
    titleKey: 'navigation.becomeDRep',
    link: '/governance/register',
    icon: 'mdi-shield-account-outline',
    flag: 'voting',
  },
]);

/** True on any governance route: the hub, a DRep profile, an action detail. */
export function isGovernanceRoute(path: string | null | undefined): boolean {
  return typeof path === 'string' && path.startsWith(GOVERNANCE_PREFIX);
}
