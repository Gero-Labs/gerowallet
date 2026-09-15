// The Governance section of the drawer.
//
// This started as a submenu, and the submenu is the bug it was written for:
// standing on /governance/dreps with the group collapsed, Actions was not gated
// — it was simply not in the DOM, and nothing inside the group could bring it
// back. The pages are their own SECTION now, so every one of them is always a
// row. What is still worth pinning is what survived that change: every link
// points at a route the router really declares (the DRep directory was lost to
// a merge once), and only registration rides the voting sub-flag.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { GOVERNANCE_ITEMS, GOVERNANCE_PREFIX, isGovernanceRoute } from './governanceNav';

/**
 * Every governance path the router declares, read as text. Importing router.ts
 * would drag in ContentLayout and the whole dashboard; the paths are string
 * literals, and reading them is enough to catch a row that points nowhere.
 */
function routerGovernancePaths(): string[] {
  const source = readFileSync(resolve(__dirname, '../router.ts'), 'utf8');
  return [...source.matchAll(/path:\s*'(\/governance[^']*)'/g)].map(match => match[1]);
}

/** Concrete paths a user can actually be standing on, params filled in. */
const LIVE_PATHS = [
  '/governance',
  '/governance/me',
  '/governance/dreps',
  '/governance/dreps/drep1ytjyvm958ywjkp57f8wm3havj72lc653tp7ajttxxt6ftgcmcmdk2',
  '/governance/actions',
  '/governance/actions/9f8e7d6c/0',
  '/governance/register',
];

describe('governance nav section', () => {
  it('carries My governance, DReps, Actions and registration', () => {
    const links = GOVERNANCE_ITEMS.map(item => item.link);
    expect(links).toEqual([
      '/governance/me',
      '/governance/dreps',
      '/governance/actions',
      '/governance/register',
    ]);
  });

  it('points every row at a route the router actually declares', () => {
    const declared = routerGovernancePaths();
    expect(declared.length).toBeGreaterThan(0);
    for (const item of GOVERNANCE_ITEMS) {
      expect(declared, item.link).toContain(item.link);
    }
  });

  it('gives every row an icon', () => {
    // A section of peers, so no row may render as a blank square beside the rest.
    for (const item of GOVERNANCE_ITEMS) {
      expect(item.icon, item.link).toBeTruthy();
    }
  });

  it('gates only registration behind the voting sub-flag', () => {
    // It posts a deposit and a certificate on chain, and the router gates the
    // same route the same way. Nothing else may inherit that narrower gate.
    const flagged = GOVERNANCE_ITEMS.filter(item => item.flag);
    expect(flagged.map(item => item.link)).toEqual(['/governance/register']);
    expect(flagged[0].flag).toBe('voting');
  });

  it('has no duplicate links or labels', () => {
    const links = GOVERNANCE_ITEMS.map(item => item.link);
    const titles = GOVERNANCE_ITEMS.map(item => item.titleKey);
    expect(new Set(links).size).toBe(links.length);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe('isGovernanceRoute', () => {
  it('recognises every live governance path', () => {
    for (const path of LIVE_PATHS) {
      expect(isGovernanceRoute(path), path).toBe(true);
    }
  });

  it('does not treat a lookalike path as governance', () => {
    expect(isGovernanceRoute('/gov')).toBe(false);
    expect(isGovernanceRoute('/dao/governance')).toBe(false);
    expect(isGovernanceRoute('/dao')).toBe(false);
    expect(isGovernanceRoute(null)).toBe(false);
    expect(isGovernanceRoute(undefined)).toBe(false);
  });

  it('exposes the prefix the drawer and the router agree on', () => {
    expect(GOVERNANCE_PREFIX).toBe('/governance');
    for (const path of routerGovernancePaths()) {
      expect(path.startsWith(GOVERNANCE_PREFIX), path).toBe(true);
    }
  });
});
