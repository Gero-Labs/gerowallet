import { parseGovActionId, type GovActionId } from '@/shared/utils/govActionId';
import { drepDisplayName } from '@/shared/utils/drepView';
import { formatCompact } from '@/shared/utils/format';
import { toLovelace } from '@/shared/utils/lovelace';
import { scoreMatch } from '@/shared/utils/searchScore';
import type { GovProposal } from '@/api/governance.types';
// TYPE-ONLY on purpose. A value import here would pull the whole search
// composable (and its store/API graph) into every consumer of these mappers,
// and back into itself, since `useGlobalSearch` imports this module.
import type { SearchResult } from '@/shared/composables/useGlobalSearch';

/**
 * The three governance sources behind the global search bar: pages, governance
 * actions and DReps.
 *
 * Pure mappers, deliberately. Fetching, caching, debouncing and feature-flag
 * gating stay in `useGlobalSearch`; what lives here is only "given these rows
 * and this query, which results and in what order". That keeps the ranking
 * testable without a Vue instance, a store or a network.
 */

/** Translator, narrowed to what these mappers use. */
export type Translate = (key: string) => string;

/**
 * Minimum query length before a raw identifier is matched.
 *
 * Same threshold the token / transaction / pool / DRep sources already use: a
 * two-character query would otherwise match a hex fragment in almost every
 * id on the page and bury the name matches the user actually meant.
 */
export const MIN_ID_FRAGMENT = 8;

/** Rows returned per governance source, matching the other sources' cap. */
export const MAX_PER_SOURCE = 5;

/** The subset of a `/api/dreps` row these mappers read. Loose, because the endpoint is untyped upstream. */
export interface DRepSearchRow {
  drep_id?: string | null;
  /** Some rows carry a bare `name` instead of CIP-119 metadata. */
  name?: string | null;
  /** Voting power in lovelace, as a decimal string. */
  amount?: string | null;
  [key: string]: unknown;
}

interface GovernancePage {
  /** Extra terms beyond the translated title, EN and DE both, as SETTINGS_INDEX does. */
  keywords: string[];
  titleKey: string;
  route: string;
  icon: string;
  /**
   * Registration posts a deposit and a certificate on chain, so it rides the
   * voting sub-flag on top of the master governance gate. Mirrors the router's
   * extra `governanceRegister` maintenance case and the nav drawer's child gate.
   */
  requiresVoting?: boolean;
}

/**
 * The governance hub's own pages. Titles reuse the keys the navigation drawer
 * renders, so a page never appears in search under a name it does not carry in
 * the sidebar.
 */
const GOVERNANCE_PAGES: GovernancePage[] = [
  {
    keywords: ['my governance', 'my vote', 'my votes', 'delegation', 'meine governance', 'delegierung'],
    titleKey: 'navigation.governanceMe',
    route: '/governance/me',
    icon: 'mdi-account-check',
  },
  {
    keywords: ['dreps', 'drep', 'delegate', 'representative', 'directory', 'delegieren', 'vertreter', 'verzeichnis'],
    titleKey: 'governance.dReps',
    route: '/governance/dreps',
    icon: 'mdi-account-group',
  },
  {
    keywords: ['governance actions', 'gov actions', 'proposals', 'vote', 'governance-aktionen', 'vorschlage', 'vorschläge', 'abstimmen'],
    titleKey: 'governance.actionsTitle',
    route: '/governance/actions',
    icon: 'mdi-gavel',
  },
  {
    keywords: ['become a drep', 'register as a drep', 'drep registration', 'drep werden', 'drep registrierung'],
    titleKey: 'navigation.becomeDRep',
    route: '/governance/register',
    icon: 'mdi-account-plus',
    requiresVoting: true,
  },
];

/** `governance.actionType.*` if the type is one we translate, else the raw upstream value. */
export function actionTypeLabel(type: string | null | undefined, t: Translate): string {
  if (!type) return '';
  const key = `governance.actionType.${String(type).toLowerCase()}`;
  const translated = String(t(key));
  return translated === key ? String(type) : translated;
}

/** `governance.status.*` if the status is one we translate, else the raw upstream value. */
export function actionStatusLabel(status: string | null | undefined, t: Translate): string {
  if (!status) return '';
  const key = `governance.status.${String(status).toLowerCase()}`;
  const translated = String(t(key));
  return translated === key ? String(status) : translated;
}

function truncateId(id: string | null | undefined): string {
  const value = String(id ?? '');
  return value.length > 20 ? `${value.slice(0, 20)}...` : value;
}

/** `<first 12 hex>...#<index>`: the stand-in title for an action with no anchor title. */
function actionIdLabel(parsed: GovActionId): string {
  return `${parsed.txHash.slice(0, 12)}...#${parsed.index}`;
}

function byScoreDesc(a: SearchResult, b: SearchResult): number {
  return (b._score || 0) - (a._score || 0);
}

/**
 * Governance hub pages matching `query`.
 *
 * Scored on the same curve as the settings index (exact keyword 100,
 * keyword-prefix 90, keyword-substring 50) so a page and a setting typed for
 * with the same intent rank against each other honestly.
 */
export function governancePageResults(
  query: string,
  options: { t: Translate; votingEnabled: boolean },
): SearchResult[] {
  const lower = query.trim().toLowerCase();
  if (!lower) return [];
  const { t, votingEnabled } = options;
  const subtitle = String(t('navigation.governance'));

  return GOVERNANCE_PAGES.filter(page => !page.requiresVoting || votingEnabled)
    .map(page => {
      const title = String(t(page.titleKey));
      let best = 0;
      for (const keyword of page.keywords) {
        if (keyword === lower) { best = 100; break; }
        if (keyword.startsWith(lower)) best = Math.max(best, 90);
        else if (keyword.includes(lower)) best = Math.max(best, 50);
      }
      best = Math.max(best, scoreMatch(title, lower));
      return { page, title, score: best };
    })
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PER_SOURCE)
    .map(entry => ({
      type: 'page' as const,
      id: `page-${entry.page.route}`,
      title: entry.title,
      subtitle,
      icon: entry.page.icon,
      route: entry.page.route,
      _score: entry.score,
    }));
}

/**
 * Governance actions matching `query`, by anchor title or by id fragment.
 *
 * Filtering is CLIENT-SIDE over rows the caller already holds: Nexus's
 * `/api/governance/proposals` takes `type`, `status`, `page` and `pageSize`
 * only (see `ListProposalsParams`); there is no title or search parameter to
 * push this down to. So the reachable set is whatever page the caller fetched,
 * and an action outside it cannot be found here. Widen the fetch, not this
 * function, if that ever stops being enough.
 *
 * An action whose id will not parse is skipped rather than listed: the detail
 * route is built from the parsed `{txHash, index}`, so a row that cannot be
 * opened must not appear as though it could.
 */
export function governanceActionResults(
  actions: readonly GovProposal[] | null | undefined,
  query: string,
  options: { t: Translate },
): SearchResult[] {
  const lower = query.trim().toLowerCase();
  if (!lower || !actions?.length) return [];
  const { t } = options;
  const matchIds = lower.length >= MIN_ID_FRAGMENT;
  const found: SearchResult[] = [];

  for (const action of actions) {
    const parsed = parseGovActionId(action.govActionId) ?? parseGovActionId(action.govActionIdCip129);
    if (!parsed) continue;

    const title = action.title?.trim() || '';
    const idScore = matchIds
      ? Math.max(
        scoreMatch(action.govActionId, lower),
        scoreMatch(action.govActionIdCip129, lower),
        scoreMatch(action.txHash, lower),
      )
      : 0;
    const score = Math.max(scoreMatch(title, lower), idScore);
    if (score <= 0) continue;

    const typeLabel = actionTypeLabel(action.type, t);
    const statusLabel = actionStatusLabel(action.status, t);
    found.push({
      type: 'govAction',
      id: action.govActionId || `${parsed.txHash}#${parsed.index}`,
      title: title || actionIdLabel(parsed),
      subtitle: [typeLabel, statusLabel].filter(Boolean).join(' · '),
      icon: 'mdi-gavel',
      route: `/governance/actions/${parsed.txHash}/${parsed.index}`,
      data: action,
      _score: score,
    });
  }

  return found.sort(byScoreDesc).slice(0, MAX_PER_SOURCE);
}

/**
 * DReps matching `query`, by published name or by `drep1…` id fragment.
 *
 * Rows come either from the in-memory directory page or from
 * `getDRepsPaginated({ search })`, which filters server-side. Both are mapped
 * here so the two phases of a search cannot disagree about a DRep's name,
 * power or destination.
 */
export function drepResults(
  rows: readonly DRepSearchRow[] | null | undefined,
  query: string,
  options: { t: Translate; currencySymbol?: string },
): SearchResult[] {
  const lower = query.trim().toLowerCase();
  if (!lower || !rows?.length) return [];
  const { t, currencySymbol = '' } = options;
  const matchIds = lower.length >= MIN_ID_FRAGMENT;
  const kindLabel = String(t('search.dreps'));
  const powerLabel = String(t('governance.votingPower'));
  const found: SearchResult[] = [];

  for (const row of rows) {
    const drepId = String(row.drep_id ?? '');
    if (!drepId) continue;

    const name = drepDisplayName(row) || (typeof row.name === 'string' ? row.name.trim() : '');
    const score = Math.max(scoreMatch(name, lower), matchIds ? scoreMatch(drepId, lower) : 0);
    if (score <= 0) continue;

    found.push({
      type: 'drep',
      id: drepId,
      title: name || truncateId(drepId),
      subtitle: drepPowerSubtitle(row.amount, kindLabel, powerLabel, currencySymbol),
      icon: 'mdi-vote',
      route: `/governance/dreps/${encodeURIComponent(drepId)}`,
      data: row,
      _score: score,
    });
  }

  return found.sort(byScoreDesc).slice(0, MAX_PER_SOURCE);
}

/**
 * "DReps · Voting Power 1.20M ₳", or just the kind when the row carries no
 * power. Absent stake is left OUT rather than printed as 0: a DRep the
 * directory did not send an `amount` for has not been measured at zero.
 */
function drepPowerSubtitle(
  amount: string | null | undefined,
  kindLabel: string,
  powerLabel: string,
  currencySymbol: string,
): string {
  if (amount === null || amount === undefined || amount === '') return kindLabel;
  const lovelace = toLovelace(amount);
  if (lovelace <= 0n) return kindLabel;
  const ada = formatCompact(Number(lovelace / 1_000_000n));
  return `${kindLabel} · ${powerLabel} ${ada}${currencySymbol ? ` ${currencySymbol}` : ''}`;
}
