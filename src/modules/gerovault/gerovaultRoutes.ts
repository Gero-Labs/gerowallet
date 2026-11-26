/**
 * Route names of GeroVault (multisig vaults), kept apart from the perpetuals
 * "Vaults" in the side panel. The records themselves live in the options router;
 * these names are what its flag and chain gates and the vault shell's tabs read.
 */

/** The vault screen's tabs, in display order. */
export const GEROVAULT_TABS = ['proposals', 'policy', 'history', 'settings'] as const;
export type GerovaultTab = (typeof GEROVAULT_TABS)[number];

/** Route name of each tab, a child of `/vaults/:vaultId`. */
export const GEROVAULT_TAB_ROUTES: Readonly<Record<GerovaultTab, string>> = {
  proposals: 'gerovaultProposals',
  policy: 'gerovaultPolicy',
  history: 'gerovaultHistory',
  settings: 'gerovaultSettings',
};

export const GEROVAULT_OVERVIEW_ROUTE = 'gerovault';
export const GEROVAULT_CREATE_ROUTE = 'gerovaultCreate';
/** `/vaults/:vaultId` itself, which redirects to the first tab. */
export const GEROVAULT_VAULT_ROUTE = 'gerovaultVault';

/** Every GeroVault route name: all of them share one gate. */
export const GEROVAULT_ROUTE_NAMES: readonly string[] = [
  GEROVAULT_OVERVIEW_ROUTE,
  GEROVAULT_CREATE_ROUTE,
  GEROVAULT_VAULT_ROUTE,
  ...Object.values(GEROVAULT_TAB_ROUTES),
];

/** The tab a GeroVault tab route shows, or null for any other route. */
export function gerovaultTabOf(name: string | null | undefined): GerovaultTab | null {
  return GEROVAULT_TABS.find(tab => GEROVAULT_TAB_ROUTES[tab] === name) ?? null;
}
