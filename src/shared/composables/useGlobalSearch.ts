import { ref, computed, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import { stakingStore } from '@/stores/stakingStore';
import { governanceStore } from '@/stores/governanceStore';
import { useMarketData, type MarketToken } from '@/modules/market/composables/useMarketData';
import { useNftMarketData } from '@/modules/market/composables/useNftMarketData';
import blockchainApi from '@/api/blockchain-api';
import cashbackApi from '@/api/cashback-api';
import networks from '@/utils/networks';

export type SearchResultType = 'token' | 'transaction' | 'nft' | 'pool' | 'drep' | 'retailer' | 'contact' | 'setting';

export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string;
  icon?: string;
  route?: string;
  data?: any; // Original object for navigation handlers
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

async function loadRetailerCache() {
  if (retailerCacheLoaded) return;
  try {
    const res = await cashbackApi.retailers(null, undefined, 0);
    const items = res?.items || [];
    const iconBase = res?.retailerIconBasePath || '';
    const iconQuery = res?.iconQueryParam || '';
    retailerCache = items.map((r: any) => ({
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

// Searchable settings index with optional feature requirement
// `requires`: if set, the setting only appears when the chain supports that feature
// `titleKey`/`subtitleKey`: i18n keys resolved at search time for locale-aware display
type SettingsEntry = { keywords: string[]; tab: string; titleKey: string; subtitleKey: string; icon: string; requires?: 'cashback' | 'governance' };

const SETTINGS_INDEX: SettingsEntry[] = [
  // Profile
  { keywords: ['wallet name', 'rename wallet', 'edit name', 'wallet-name', 'umbenennen'], tab: 'profile', titleKey: 'settings.walletName', subtitleKey: 'settings.profile', icon: 'mdi-pencil' },
  { keywords: ['profile picture', 'avatar', 'wallet picture', 'photo', 'profilbild'], tab: 'profile', titleKey: 'settings.walletProfilePicture', subtitleKey: 'settings.profile', icon: 'mdi-account-circle' },
  { keywords: ['currency', 'usd', 'eur', 'dollar', 'euro', 'currency preference', 'währung'], tab: 'profile', titleKey: 'settings.currencyPreference', subtitleKey: 'settings.profile', icon: 'mdi-currency-usd' },
  { keywords: ['language', 'german', 'english', 'deutsch', 'display language', 'sprache', 'anzeigesprache'], tab: 'profile', titleKey: 'settings.displayLanguage', subtitleKey: 'settings.profile', icon: 'mdi-translate' },
  { keywords: ['region'], tab: 'profile', titleKey: 'settings.region', subtitleKey: 'settings.profile', icon: 'mdi-map-marker' },
  { keywords: ['welcome guide', 'onboarding', 'tutorial', 'anleitung'], tab: 'profile', titleKey: 'settings.welcomeGuide', subtitleKey: 'settings.profile', icon: 'mdi-book-open-variant' },
  // Collateral
  { keywords: ['collateral', 'set collateral', '5 ada', 'kollateral', 'sicherheit'], tab: 'collateral', titleKey: 'settings.collateral', subtitleKey: 'settings.collateral', icon: 'mdi-shield-lock' },
  // Contacts
  { keywords: ['contacts', 'address book', 'add contact', 'saved addresses', 'kontakte', 'adressbuch'], tab: 'contacts', titleKey: 'settings.contacts', subtitleKey: 'settings.contacts', icon: 'mdi-contacts' },
  // Connected DApps
  { keywords: ['dapps', 'connected dapps', 'connected sites', 'remove dapp', 'disconnect dapp', 'verbundene dapps'], tab: 'connectedDapps', titleKey: 'settings.connectedDApps', subtitleKey: 'settings.connectedDApps', icon: 'mdi-application-brackets' },
  // Security
  { keywords: ['public key', 'extended public key', 'ed25519', 'xpub', 'öffentlicher schlüssel'], tab: 'security', titleKey: 'settings.extendedPublicKey', subtitleKey: 'settings.security', icon: 'mdi-key' },
  { keywords: ['recovery phrase', 'seed phrase', 'mnemonic', 'backup', 'back up', 'wiederherstellungsphrase', 'sicherung'], tab: 'security', titleKey: 'settings.recoveryPhrase', subtitleKey: 'settings.security', icon: 'mdi-shield-key' },
  { keywords: ['spending password', 'change password', 'spending security', 'ausgabenpasswort', 'passwort ändern'], tab: 'security', titleKey: 'settings.spendingSecuritySettings', subtitleKey: 'settings.security', icon: 'mdi-lock' },
  { keywords: ['lock settings', 'auto lock', 'auto-lock', 'unlock method', 'pin', 'pattern', 'sperreinstellungen', 'entsperrmethode'], tab: 'security', titleKey: 'security.lockSettings', subtitleKey: 'settings.security', icon: 'mdi-lock-clock' },
  { keywords: ['passkey', 'biometric', 'webauthn', 'fingerprint', 'face id', 'biometrisch', 'fingerabdruck'], tab: 'security', titleKey: 'security.lockSettings', subtitleKey: 'settings.security', icon: 'mdi-fingerprint' },
  { keywords: ['website protection', 'malicious', 'cardano shield', 'phishing', 'webseiten-schutz', 'bösartig'], tab: 'security', titleKey: 'settings.websiteProtection', subtitleKey: 'settings.security', icon: 'mdi-shield-check' },
  { keywords: ['two factor', '2fa', 'two-factor', 'authenticator', 'zwei-faktor', 'authentifizierung'], tab: 'security', titleKey: 'security.twoFactorAuth', subtitleKey: 'settings.security', icon: 'mdi-two-factor-authentication' },
  // Advanced
  { keywords: ['shop earn', 'cashback popups', 'bring', 'shop and earn', 'einkaufen', 'cashback'], tab: 'advanced', titleKey: 'settings.shopEarnPopups', subtitleKey: 'settings.advanced', icon: 'mdi-shopping', requires: 'cashback' },
  { keywords: ['auto submit', 'tx auto submit', 'transaction auto', 'automatisch senden'], tab: 'advanced', titleKey: 'settings.txAutoSubmit', subtitleKey: 'settings.advanced', icon: 'mdi-send-check' },
  { keywords: ['popup', 'sidepanel', 'side panel', 'display mode', 'prompt', 'anzeigemodus'], tab: 'advanced', titleKey: 'settings.promptDisplayMode', subtitleKey: 'settings.advanced', icon: 'mdi-monitor' },
  { keywords: ['resync', 're-sync', 'sync wallet', 'refresh', 'synchronisieren', 'aktualisieren'], tab: 'advanced', titleKey: 'settings.reSyncWallet', subtitleKey: 'settings.advanced', icon: 'mdi-sync' },
  { keywords: ['delete wallet', 'remove wallet', 'danger', 'wallet löschen', 'entfernen'], tab: 'advanced', titleKey: 'settings.deleteWallet', subtitleKey: 'settings.advanced', icon: 'mdi-delete' },
];

export function useGlobalSearch() {
  const { t } = useTranslation();
  const { allTokens } = useMarketData();
  const { collections: nftCollections } = useNftMarketData();

  // Resolve feature support for the active wallet's chain/network
  const wallet = computed(() => walletStore.loggedWallet);
  const hasCashback = computed(() => networks.resolveCashbackSupport(wallet.value?.chain, wallet.value?.network));
  const hasGovernance = computed(() => networks.resolveGovernanceSupport(wallet.value?.chain, wallet.value?.network));
  const hasStaking = computed(() => networks.resolveStakingSupport(wallet.value?.chain, wallet.value?.network));

  function open() {
    isOpen.value = true;
    query.value = '';
    results.value = [];
    // Lazy-load retailer cache on first open (only if chain supports cashback)
    if (!retailerCacheLoaded && hasCashback.value) loadRetailerCache();
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

  // ── DRep display name helper ─────────────────────────────────────────────
  function getDRepName(d: any): string {
    const givenName = d.metadata?.meta_json?.body?.givenName;
    if (givenName) {
      return givenName['@value'] || givenName;
    }
    return d.name || '';
  }

  // ── Scoring helper ────────────────────────────────────────────────────────
  // Returns a relevance score: exact match > starts-with > contains
  function scoreMatch(text: string | undefined, query: string): number {
    if (!text) return 0;
    const t = text.toLowerCase();
    if (t === query) return 100;           // exact match
    if (t.startsWith(query)) return 80;    // starts with query
    const words = t.split(/[\s\-_]+/);
    if (words.some(w => w === query)) return 70;  // exact word match
    if (words.some(w => w.startsWith(query))) return 60; // word starts with
    if (t.includes(query)) return 30;      // substring
    return 0;
  }

  // ── In-memory search (instant) ──────────────────────────────────────────────

  function searchLocal(q: string): SearchResult[] {
    const lower = q.toLowerCase();
    const found: SearchResult[] = [];

    // 1. Tokens — from market data (all tokens, not just owned)
    const tokenMatches = allTokens.value
      .filter((t: MarketToken) =>
        t.ticker?.toLowerCase().includes(lower) ||
        t.name?.toLowerCase().includes(lower) ||
        (lower.length >= 8 && t.unit?.toLowerCase().includes(lower))
      )
      .slice(0, 8)
      .map((t: MarketToken) => ({
        type: 'token' as const,
        id: t.unit,
        title: t.ticker || t.name || t.unit.slice(0, 12),
        subtitle: t.name || '',
        icon: t.img || '',
        data: t,
        _score: Math.max(scoreMatch(t.ticker, lower), scoreMatch(t.name, lower)),
      }));
    found.push(...tokenMatches);

    // 2. Transactions — match by tx hash (only for longer queries)
    if (lower.length >= 8) {
      const txs = walletStore.transactions || [];
      const txArr = Array.isArray(txs) ? txs : [];
      const txMatches = txArr
        .filter((tx: any) => tx.id?.toLowerCase().includes(lower))
        .slice(0, 5)
        .map((tx: any) => ({
          type: 'transaction' as const,
          id: tx.id,
          title: `${tx.id.slice(0, 12)}...${tx.id.slice(-8)}`,
          subtitle: tx.type || 'Transaction',
          icon: 'mdi-swap-horizontal',
          route: `/transactions?tx=${tx.id}`,
          _score: scoreMatch(tx.id, lower),
        }));
      found.push(...txMatches);
    }

    // 3. NFT Collections — from wallet collections enriched with market data
    const nftMatches = nftCollections.value
      .filter(c =>
        c.name?.toLowerCase().includes(lower) ||
        (lower.length >= 8 && c.policyId?.toLowerCase().includes(lower))
      )
      .slice(0, 5)
      .map(c => ({
        type: 'nft' as const,
        id: c.policyId,
        title: c.name,
        subtitle: `${c.quantity} ${t('search.nftCollections')}`,
        icon: c.img || 'mdi-image-multiple',
        data: c,
        _score: scoreMatch(c.name, lower),
      }));
    found.push(...nftMatches);

    // 4. Contacts — from wallet contacts
    const contacts = walletStore.contacts || {};
    const contactEntries = Object.entries(contacts) as [string, any][];
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

    // 5. Stake pools — from in-memory store (only if chain supports staking)
    if (hasStaking.value) {
      try {
        const pools = stakingStore.pools || [];
        if (pools.length > 0) {
          const poolMatches = pools
            .filter((p: any) =>
              p.name?.toLowerCase().includes(lower) ||
              p.ticker?.toLowerCase().includes(lower) ||
              (lower.length >= 8 && p.pool_id_bech32?.toLowerCase().includes(lower))
            )
            .slice(0, 5)
            .map((p: any) => ({
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

    // 6. DReps — from in-memory store (only if chain supports governance)
    if (hasGovernance.value) {
      try {
        const dreps = governanceStore.dreps || [];
        if (dreps.length > 0) {
          const drepMatches = dreps
            .filter((d: any) => {
              const name = getDRepName(d);
              return name?.toLowerCase().includes(lower) ||
                (lower.length >= 8 && d.drep_id?.toLowerCase().includes(lower));
            })
            .slice(0, 5)
            .map((d: any) => {
              const name = getDRepName(d);
              return {
                type: 'drep' as const,
                id: d.drep_id,
                title: name || d.drep_id?.slice(0, 20) + '...',
                subtitle: t('search.dreps'),
                icon: 'mdi-vote',
                route: `/governance?drep=${d.drep_id}`,
                data: d,
                _score: scoreMatch(name, lower),
              };
            });
          found.push(...drepMatches);
        }
      } catch {
        // governanceStore not available
      }
    }

    // 7. Settings — match against keywords index, filtered by chain feature support
    const featureSupported = (req?: string) => {
      if (!req) return true;
      if (req === 'cashback') return hasCashback.value;
      if (req === 'governance') return hasGovernance.value;
      return true;
    };
    const settingMatches = SETTINGS_INDEX
      .filter(s => featureSupported(s.requires))
      .map(s => {
        const title = String(t(s.titleKey));
        const subtitle = String(t(s.subtitleKey));
        // Score: exact keyword match = 100, keyword starts with = 90, keyword contains = 50, title match = 40
        let best = 0;
        for (const kw of s.keywords) {
          if (kw === lower) { best = Math.max(best, 100); break; }
          if (kw.startsWith(lower)) best = Math.max(best, 90);
          else if (kw.includes(lower)) best = Math.max(best, 50);
        }
        // Also match against the resolved (possibly translated) title
        best = Math.max(best, scoreMatch(title, lower));
        return { ...s, title, subtitle, _score: best };
      })
      .filter(s => s._score > 0)
      .sort((a, b) => b._score - a._score)
      .slice(0, 5)
      .map(s => ({
        type: 'setting' as const,
        id: `setting-${s.tab}-${s.titleKey}`,
        title: s.title,
        subtitle: `${String(t('common.settings'))} → ${s.subtitle}`,
        icon: s.icon,
        data: { tab: s.tab, highlight: s.title },
        _score: s._score,
      }));
    found.push(...settingMatches);

    // 8. Cashback retailers — only if chain supports cashback
    if (hasCashback.value && retailerCache.length > 0) {
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
    const wallet = walletStore.loggedWallet;
    if (!wallet) return found;

    const chain = wallet.chain;
    const network = wallet.network;

    // Run API searches in parallel
    const apiSearches = [];

    // Stake pools — only if chain supports staking
    if (hasStaking.value) {
      apiSearches.push(
        blockchainApi.getPoolsPaginated({ search: q, page: 1, per_page: 5 }, chain, network)
          .then((res: any) => {
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

    // DReps — only if chain supports governance
    if (hasGovernance.value) {
      apiSearches.push(
        blockchainApi.getDRepsPaginated({ search: q, page: 1, per_page: 5 }, chain, network)
        .then((res: any) => {
          const items = res?.items || [];
          for (const d of items) {
            const name = getDRepName(d);
            found.push({
              type: 'drep',
              id: d.drep_id,
              title: name || d.drep_id?.slice(0, 20) + '...',
              subtitle: t('search.dreps'),
              icon: 'mdi-vote',
              route: `/governance?drep=${d.drep_id}`,
              data: d,
              _score: scoreMatch(name, q.toLowerCase()),
            });
          }
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
