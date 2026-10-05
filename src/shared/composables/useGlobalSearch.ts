import { ref, computed, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import WalletStore, { walletStore } from '@/stores/walletStore';
import { stakingStore } from '@/stores/stakingStore';
import { midnightStore } from '@/stores/midnightStore';
import { musicStore } from '@/stores/musicStore';
import { useMarketData, type MarketToken } from '@/modules/market/composables/useMarketData';
import { useNftMarketData } from '@/modules/market/composables/useNftMarketData';
import { useHoldingsValuation } from '@/shared/composables/useHoldingsValuation';
import blockchainApi from '@/api/blockchain-api';
import cashbackApi from '@/api/cashback-api';
import governanceApi from '@/api/governance-api';
import governanceActionsStore from '@/stores/governanceActionsStore';
import networks from '@/utils/networks';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { Blockchain, type Wallet } from '@/models/types';
import { scoreMatch } from '@/shared/utils/searchScore';
import { drepResults, governanceActionResults, governancePageResults } from '@/shared/utils/governanceSearch';
import { actionResults, pageResults, searchGates, settingResults, type SearchGate } from '@/shared/utils/walletSearchIndex';
import { cnightUnit } from '@/shared/utils/cnightAssets';

/** Whether the logged-in wallet holds a positive balance of `unit`. */
function holdsUnit(unit: string): boolean {
  if (!unit) return false;
  const tokens = (walletStore.tokens || {}) as Record<string, { quantity?: number | string }>;
  return Number(tokens[unit]?.quantity ?? 0) > 0;
}
import type { GovProposal } from '@/api/governance.types';

export type SearchResultType =
  | 'token'
  | 'transaction'
  | 'nft'
  | 'pool'
  | 'drep'
  | 'govAction'
  | 'page'
  | 'action'
  | 'retailer'
  | 'contact'
  | 'setting';

export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string;
  icon?: string;
  route?: string;
  // Original object for navigation handlers — a grab-bag by design (token, pool,
  // DRep, contact, action or settings target), consumed untyped by GlobalSearch.vue.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
  _score?: number; // Relevance score for sorting (higher = better match)
}

// Module-level state (singleton pattern — shared across components)
const isOpen = ref(false);
const query = ref('');
const results = ref<SearchResult[]>([]);
const searching = ref(false);

// Cached retailer names for local search (loaded once, avoids API spam)
let retailerCache: { name: string; id: string; icon: string }[] = [];
let retailerCacheLoaded = false;
let searchWatcherRegistered = false;

/** Rows per governance-action page fetched for the search cache. */
const GOV_ACTION_CACHE_PAGE_SIZE = 50;

// Cached governance actions for local search. Same shape of deal as the
// retailers: fetched once when the dialog opens, then filtered in memory.
let govActionCache: GovProposal[] = [];
let govActionCacheNetwork: string | null = null;
let govActionCacheRequest: Promise<void> | null = null;

/**
 * Governance actions on `network` to search over.
 *
 * The store's list wins when the user has already been on the actions board:
 * that is the page they just paged and filtered, so it is the set they mean.
 * Only while it is this network's list, though: a wallet switch does not clear
 * the board, and another network's action would open as "not found". Otherwise
 * this falls back to the cache below, under the same rule.
 */
function govActionPool(network: string | undefined): GovProposal[] {
  const { actions, actionsNetwork } = governanceActionsStore.state;
  if (actions?.length && actionsNetwork === network) return actions;
  return govActionCacheNetwork === network ? govActionCache : [];
}

/**
 * Fill `govActionCache` for `network`, once.
 *
 * Two pages are fetched, not one: `status: 'active'` first, because an open
 * action is the one a user can still act on, plus an unfiltered page so a
 * concluded action stays findable by name. Nexus has no title/search parameter
 * on `/api/governance/proposals`, so the fetched rows ARE the searchable set
 * and the matching itself happens client-side in `governanceActionResults`.
 *
 * Failures are swallowed and leave the cache empty. Governance is one source
 * among several, and an outage here must not cost the user their token,
 * transaction or settings results.
 */
function loadGovActionCache(network: string | undefined): Promise<void> {
  if (!network) return Promise.resolve();
  // A wallet switch invalidates the cache: actions are per-network.
  if (govActionCacheNetwork !== network) {
    govActionCacheNetwork = network;
    govActionCache = [];
    govActionCacheRequest = null;
  }
  if (govActionCacheRequest) return govActionCacheRequest;

  govActionCacheRequest = (async () => {
    const pages = await Promise.allSettled([
      governanceApi.listProposals({ network, status: 'active', page: 1, pageSize: GOV_ACTION_CACHE_PAGE_SIZE }),
      governanceApi.listProposals({ network, page: 1, pageSize: GOV_ACTION_CACHE_PAGE_SIZE }),
    ]);
    const byId = new Map<string, GovProposal>();
    for (const page of pages) {
      if (page.status !== 'fulfilled') continue;
      for (const action of page.value?.items ?? []) {
        if (action?.govActionId) byId.set(action.govActionId, action);
      }
    }
    govActionCache = [...byId.values()];
    // A failed pair leaves the cache empty AND retryable, so the next open tries
    // again rather than reporting "no governance actions" forever.
    if (!govActionCache.length) govActionCacheRequest = null;
  })();

  return govActionCacheRequest;
}

async function loadRetailerCache() {
  if (retailerCacheLoaded) return;
  try {
    const res = await cashbackApi.retailers(null, undefined, 0);
    const items = res?.['items'] || [];
    const iconBase = res?.['retailerIconBasePath'] || '';
    const iconQuery = res?.['iconQueryParam'] || '';
    retailerCache = items.map((r) => ({
      name: r.name,
      id: r.id,
      icon: (iconBase && r.iconPath) ? (iconBase + r.iconPath + iconQuery) : 'mdi-shopping',
    }));
    retailerCacheLoaded = true;
  } catch {
    // Silently fail — will retry next time search opens
  }
}

// Settings navigation — ContentLayout watches this to open SettingsDialog
export const settingsNavRequest = ref<{ tab: string; highlight?: string } | null>(null);

export function useGlobalSearch() {
  const { t } = useTranslation();
  const { allTokens } = useMarketData();
  const { collections: nftCollections } = useNftMarketData();
  // The wallet's own token rows, exactly as the holdings table builds them. The
  // market list alone misses every held token the market feed does not carry.
  const { holdings } = useHoldingsValuation();

  const wallet = computed(() => walletStore.loggedWallet);
  /**
   * What the logged-in wallet can reach. Every source below reads it, so no
   * result for another chain (or another network) can surface; see
   * `searchGates` for the contract.
   */
  const gates = computed(() => searchGates({
    wallet: wallet.value,
    flags: featureFlagsStore,
    hasBackupState: !!walletStore.config && WalletStore.hasBackup(),
    playlistLength: musicStore.musicPlaylist?.length ?? 0,
    holdsCnight: holdsUnit(cnightUnit(wallet.value?.network)),
  }));
  /** `chain:network` of the logged-in wallet, matched against the stores' own stamps. */
  const walletKey = computed(() => `${wallet.value?.chain}:${wallet.value?.network}`);

  function open() {
    isOpen.value = true;
    query.value = '';
    results.value = [];
    // Lazy-load retailer cache on first open (only if chain supports cashback)
    if (!retailerCacheLoaded && gates.value.cashback) loadRetailerCache();
    // Same for governance actions: the list has no server-side search, so the
    // rows have to be here before the user finishes typing.
    if (gates.value.governance) void loadGovActionCache(wallet.value?.network);
  }

  function close() {
    isOpen.value = false;
    query.value = '';
    results.value = [];
  }

  function toggle() {
    if (isOpen.value) close();
    else open();
  }

  /** Shared options for the governance sources in `src/shared/utils/governanceSearch.ts`. */
  const govSearchOptions = () => ({
    t: (key: string) => String(t(key)),
    currencySymbol: networks.resolveCurrencySymbol(wallet.value?.chain, wallet.value?.network),
  });

  // ── In-memory search (instant) ──────────────────────────────────────────────

  function searchLocal(q: string): SearchResult[] {
    const lower = q.toLowerCase();
    const found: SearchResult[] = [];

    // 1. Tokens — the wallet's own holdings first (unlisted ones included), then
    //    every market-listed token. A held token opens on Holdings, any other on
    //    Market. The market list is the CARDANO MAINNET feed whatever the wallet
    //    (a Midnight wallet still loads it, a Bitcoin wallet keeps the last one),
    //    so it is searched only where the Market view exists: Cardano mainnet.
    const tokenPool: { token: MarketToken; owned: boolean }[] = [];
    const ownedUnits = new Set<string>();
    if (gates.value.cardanoFamily) {
      for (const token of holdings.value) {
        // A unit can carry a spendable and a locked (CIP-113) row; one result is enough.
        if (ownedUnits.has(token.unit)) continue;
        ownedUnits.add(token.unit);
        tokenPool.push({ token, owned: true });
      }
    }
    if (gates.value.market) {
      for (const token of allTokens.value) {
        if (!ownedUnits.has(token.unit)) tokenPool.push({ token, owned: false });
      }
    }
    const holdingsLabel = String(t('portfolio.myHoldings'));
    const tokenMatches = tokenPool
      .map(({ token, owned }) => ({
        token,
        owned,
        score: Math.max(
          scoreMatch(token.ticker, lower),
          scoreMatch(token.name, lower),
          lower.length >= 8 ? scoreMatch(token.unit, lower) : 0,
        ),
      }))
      .filter(match => match.score > 0)
      // Stable, so a held token wins a tie against a listed one.
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(({ token, owned, score }) => ({
        type: 'token' as const,
        id: token.unit,
        title: token.ticker || token.name || token.unit.slice(0, 12),
        subtitle: owned ? [token.name, holdingsLabel].filter(Boolean).join(' · ') : token.name || '',
        icon: token.img || '',
        data: { view: owned ? 'holdings' : 'market' },
        _score: score,
      }));
    found.push(...tokenMatches);

    // 2. Transactions — match by tx hash (only for longer queries). Midnight's
    //    history lives in midnightStore, one row per hash+token; every other
    //    chain's in walletStore.
    if (lower.length >= 8) {
      const txRows: { id?: string; type?: string }[] = wallet.value?.chain === Blockchain.MIDNIGHT
        ? midnightStore.transactions.map(tx => ({ id: tx.hash, type: tx.type }))
        : Array.isArray(walletStore.transactions) ? walletStore.transactions : [];
      const seenTx = new Set<string>();
      const txMatches = txRows
        .filter((tx): tx is { id: string; type?: string } => {
          if (!tx.id || seenTx.has(tx.id) || !tx.id.toLowerCase().includes(lower)) return false;
          seenTx.add(tx.id);
          return true;
        })
        .slice(0, 5)
        .map((tx) => ({
          type: 'transaction' as const,
          id: tx.id,
          title: `${tx.id.slice(0, 12)}...${tx.id.slice(-8)}`,
          subtitle: tx.type || String(t('navigation.transactions')),
          icon: 'mdi-swap-horizontal',
          route: `/transactions?tx=${tx.id}`,
          _score: scoreMatch(tx.id, lower),
        }));
      found.push(...txMatches);
    }

    // 3. NFTs — collections by name or policy id, then single NFTs by name. Both
    //    open the collection on the Collectibles view, which only the
    //    Cardano-family portfolio has.
    if (gates.value.cardanoFamily) {
      const nftMatches = nftCollections.value
        .map(c => ({
          c,
          score: Math.max(scoreMatch(c.name, lower), lower.length >= 8 ? scoreMatch(c.policyId, lower) : 0),
        }))
        .filter(match => match.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(({ c, score }) => ({
          type: 'nft' as const,
          id: c.policyId,
          title: c.name,
          subtitle: `${c.quantity} ${t('search.nftCollections')}`,
          icon: c.img || 'mdi-image-multiple',
          data: { policyId: c.policyId },
          _score: score,
        }));
      found.push(...nftMatches);

      type CollectionItem = { unit?: string; name?: string; img?: string };
      const walletCollections = (walletStore.collections || {}) as Record<string, { name?: string; items?: CollectionItem[] }>;
      const nftItemMatches: SearchResult[] = [];
      for (const [policyId, collection] of Object.entries(walletCollections)) {
        for (const item of collection?.items || []) {
          // A one-piece collection usually carries its NFT's name; the collection row covers it.
          if (!item?.unit || !item.name || item.name === collection.name) continue;
          const score = scoreMatch(item.name, lower);
          if (score <= 0) continue;
          nftItemMatches.push({
            type: 'nft',
            id: item.unit,
            title: item.name,
            subtitle: collection.name || `${policyId.slice(0, 12)}...`,
            icon: item.img || 'mdi-image',
            data: { policyId },
            _score: score,
          });
        }
      }
      found.push(...nftItemMatches.sort((a, b) => (b._score || 0) - (a._score || 0)).slice(0, 5));
    }

    // 4. Contacts — from wallet contacts
    const contacts = walletStore.contacts || {};
    const contactEntries = Object.entries(contacts) as [string, { name?: string; img?: string }][];
    const contactMatches = contactEntries
      .filter(([address, contact]) =>
        contact.name?.toLowerCase().includes(lower) ||
        address.toLowerCase().includes(lower)
      )
      .slice(0, 5)
      .map(([address, contact]) => ({
        type: 'contact' as const,
        id: address,
        title: contact.name || address.slice(0, 16) + '...',
        subtitle: address.slice(0, 20) + '...',
        icon: contact.img || 'mdi-account',
        data: contact,
        _score: scoreMatch(contact.name, lower),
      }));
    found.push(...contactMatches);

    // 5. Stake pools — the staking page's in-memory page, only while it was
    //    loaded for this wallet's chain and network: nothing clears it on a
    //    wallet switch, and Cardano and Apex Prime both stake. The async phase
    //    below searches the right chain whatever this holds.
    if (gates.value.staking && stakingStore.poolsFor === walletKey.value) {
      try {
        const pools = stakingStore.pools || [];
        if (pools.length > 0) {
          const poolMatches = pools
            .filter((p) =>
              p.name?.toLowerCase().includes(lower) ||
              p.ticker?.toLowerCase().includes(lower) ||
              (lower.length >= 8 && p.pool_id_bech32?.toLowerCase().includes(lower))
            )
            .slice(0, 5)
            .map((p) => ({
              type: 'pool' as const,
              id: p.pool_id_bech32 || p.poolId,
              title: p.ticker ? `[${p.ticker}] ${p.name}` : p.name || p.pool_id_bech32,
              subtitle: t('search.stakePools'),
              icon: 'mdi-server',
              route: `/staking?pool=${p.pool_id_bech32 || p.poolId}`,
              data: p,
              _score: Math.max(scoreMatch(p.ticker, lower), scoreMatch(p.name, lower)),
            }));
          found.push(...poolMatches);
        }
      } catch {
        // stakingStore not available
      }
    }

    // 6. Governance: actions and the hub's own pages. No governance result may
    //    appear when the chain does not support governance or the master
    //    feature flag is off. DReps come from the async phase only: the
    //    in-memory directory (`governanceStore.dreps`) is filled by the side
    //    panel alone and records no network, so it never belonged here.
    if (gates.value.governance) {
      try {
        found.push(...governanceActionResults(govActionPool(wallet.value?.network), q, govSearchOptions()));
        found.push(...governancePageResults(q, { ...govSearchOptions(), votingEnabled: gates.value.governanceVoting }));
      } catch {
        // governance stores not available
      }
    }

    // 7. The wallet's own pages, quick actions and settings rows, each offered
    //    only where `gates` says its destination exists for this wallet.
    const indexOptions = { t: (key: string) => String(t(key)), can: (gate: SearchGate) => gates.value[gate] };
    found.push(...pageResults(q, indexOptions));
    found.push(...actionResults(q, { ...indexOptions, balancesHidden: !!walletStore.config?.hideBalances }));
    found.push(...settingResults(q, indexOptions));

    // 8. Cashback retailers — only if chain supports cashback
    if (gates.value.cashback && retailerCache.length > 0) {
      const retailerMatches = retailerCache
        .map(r => ({ ...r, _score: scoreMatch(r.name, lower) }))
        .filter(r => r._score > 0)
        .sort((a, b) => b._score - a._score)
        .slice(0, 5)
        .map(r => ({
          type: 'retailer' as const,
          id: r.id,
          title: r.name,
          subtitle: t('search.cashbackStores'),
          icon: r.icon,
          route: `/cashback?store=${r.name}`,
          _score: r._score,
        }));
      found.push(...retailerMatches);
    }

    return found;
  }

  // ── API-based search (async, for data not in memory) ─────────────────────────

  async function searchRemote(q: string): Promise<SearchResult[]> {
    if (q.length < 3) return [];

    const found: SearchResult[] = [];
    // Typed, and not named `wallet`: shadowing the computed above let
    // `wallet.value` compile against the untyped store object and read undefined.
    const logged: Wallet | null = walletStore.loggedWallet;
    if (!logged) return found;

    // Captured once: every request below must ask about the wallet the search started on.
    const chain = logged.chain;
    const network = logged.network;

    // Run API searches in parallel
    const apiSearches = [];

    // Stake pools — only if chain supports staking
    if (gates.value.staking) {
      apiSearches.push(
        blockchainApi.getPoolsPaginated({ search: q, page: 1, per_page: 5 }, chain, network)
          .then((res) => {
            const items = res?.items || [];
            for (const p of items) {
              found.push({
                type: 'pool',
                id: p.pool_id_bech32 || p.poolId,
                title: p.ticker ? `[${p.ticker}] ${p.name}` : p.name || p.pool_id_bech32,
                subtitle: t('search.stakePools'),
                icon: 'mdi-server',
                route: `/staking?pool=${p.pool_id_bech32 || p.poolId}`,
                data: p,
                _score: Math.max(scoreMatch(p.ticker, q.toLowerCase()), scoreMatch(p.name, q.toLowerCase())),
              });
            }
          })
          .catch(() => {})
      );
    }

    // Governance: only if chain supports it AND the master flag is on
    if (gates.value.governance) {
      // DReps: `/api/dreps` filters server-side on `search` (verified in
      // blockchain-api.ts, which also falls back to filtering an unpaginated
      // response itself), so the query goes over the wire rather than locally.
      apiSearches.push(
        blockchainApi.getDRepsPaginated({ search: q, page: 1, per_page: 5 }, chain, network)
        .then((res) => {
          found.push(...drepResults(res?.items, q, govSearchOptions()));
        })
        .catch(() => {})
      );

      // Governance actions: no server-side search exists, so the async phase
      // waits for the cached pages and then filters them in memory. This is what
      // makes an action findable when the dialog was opened and typed into
      // before the fetch landed.
      apiSearches.push(
        loadGovActionCache(network)
          .then(() => {
            found.push(...governanceActionResults(govActionPool(network), q, govSearchOptions()));
          })
          .catch(() => {})
      );
    }

    await Promise.allSettled(apiSearches);
    return found;
  }

  // ── Combined search ──────────────────────────────────────────────────────────

  let searchGeneration = 0;

  async function search(q: string) {
    const gen = ++searchGeneration;

    if (!q || q.length < 2) {
      results.value = [];
      searching.value = false;
      return;
    }

    // Instant: show in-memory results immediately
    const localResults = searchLocal(q);
    results.value = localResults;

    // Async: fetch API results and merge
    if (q.length >= 3) {
      searching.value = true;
      try {
        const remoteResults = await searchRemote(q);
        // Discard stale results if a newer search was triggered
        if (gen !== searchGeneration) return;
        // Merge — deduplicate by id, re-sort by relevance
        const existingIds = new Set(results.value.map(r => r.id));
        const newResults = remoteResults.filter(r => !existingIds.has(r.id));
        if (newResults.length > 0) {
          const merged = [...results.value, ...newResults];
          merged.sort((a, b) => (b._score || 0) - (a._score || 0));
          results.value = merged;
        }
      } catch {
        // API search failed, local results still visible
      } finally {
        if (gen === searchGeneration) {
          searching.value = false;
        }
      }
    }
  }

  // Debounced search on query change — register only once across all composable calls
  if (!searchWatcherRegistered) {
    searchWatcherRegistered = true;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    watch(query, (val) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => search(val), 150);
    });
  }

  // Keyboard shortcut handler
  function handleKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      toggle();
    }
    if (e.key === 'Escape' && isOpen.value) {
      close();
    }
  }

  return {
    isOpen,
    query,
    results,
    searching,
    open,
    close,
    toggle,
    handleKeydown,
  };
}
