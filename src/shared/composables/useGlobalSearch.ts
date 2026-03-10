import { ref, watch } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { stakingStore } from '@/stores/stakingStore';
import { governanceStore } from '@/stores/governanceStore';
import { useMarketData, type MarketToken } from '@/modules/market/composables/useMarketData';
import { useNftMarketData } from '@/modules/market/composables/useNftMarketData';
import blockchainApi from '@/api/blockchain-api';
import cashbackApi from '@/api/cashback-api';

export type SearchResultType = 'token' | 'transaction' | 'nft' | 'pool' | 'drep' | 'retailer' | 'contact' | 'setting';

export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string;
  icon?: string;
  route?: string;
  data?: any; // Original object for navigation handlers
}

// Module-level state (singleton pattern — shared across components)
const isOpen = ref(false);
const query = ref('');
const results = ref<SearchResult[]>([]);
const searching = ref(false);

// Settings navigation — ContentLayout watches this to open SettingsDialog
export const settingsNavRequest = ref<{ tab: string; highlight?: string } | null>(null);

// Searchable settings index: [keywords, tab value, display title, icon]
const SETTINGS_INDEX: { keywords: string[]; tab: string; title: string; subtitle: string; icon: string }[] = [
  // Profile
  { keywords: ['wallet name', 'rename wallet', 'edit name'], tab: 'profile', title: 'Wallet Name', subtitle: 'Profile', icon: 'mdi-pencil' },
  { keywords: ['profile picture', 'avatar', 'wallet picture', 'photo'], tab: 'profile', title: 'Wallet Profile Picture', subtitle: 'Profile', icon: 'mdi-account-circle' },
  { keywords: ['currency', 'usd', 'eur', 'dollar', 'euro', 'currency preference'], tab: 'profile', title: 'Currency Preference', subtitle: 'Profile', icon: 'mdi-currency-usd' },
  { keywords: ['language', 'german', 'english', 'deutsch', 'display language', 'sprache'], tab: 'profile', title: 'Display Language', subtitle: 'Profile', icon: 'mdi-translate' },
  { keywords: ['region'], tab: 'profile', title: 'Region', subtitle: 'Profile', icon: 'mdi-map-marker' },
  { keywords: ['welcome guide', 'onboarding', 'tutorial'], tab: 'profile', title: 'Welcome Guide', subtitle: 'Profile', icon: 'mdi-book-open-variant' },
  // Collateral
  { keywords: ['collateral', 'set collateral', '5 ada'], tab: 'collateral', title: 'Collateral', subtitle: 'Collateral', icon: 'mdi-shield-lock' },
  // Contacts
  { keywords: ['contacts', 'address book', 'add contact', 'saved addresses'], tab: 'contacts', title: 'Contacts', subtitle: 'Contacts', icon: 'mdi-contacts' },
  // Connected DApps
  { keywords: ['dapps', 'connected dapps', 'connected sites', 'remove dapp', 'disconnect dapp'], tab: 'connectedDapps', title: 'Connected DApps', subtitle: 'Connected DApps', icon: 'mdi-application-brackets' },
  // Security
  { keywords: ['public key', 'extended public key', 'ed25519', 'xpub'], tab: 'security', title: 'Extended Public Key', subtitle: 'Security', icon: 'mdi-key' },
  { keywords: ['recovery phrase', 'seed phrase', 'mnemonic', 'backup', 'back up'], tab: 'security', title: 'Recovery Phrase', subtitle: 'Security', icon: 'mdi-shield-key' },
  { keywords: ['spending password', 'change password', 'spending security'], tab: 'security', title: 'Spending Security', subtitle: 'Security', icon: 'mdi-lock' },
  { keywords: ['lock settings', 'auto lock', 'auto-lock', 'unlock method', 'pin', 'pattern'], tab: 'security', title: 'Lock Settings', subtitle: 'Security', icon: 'mdi-lock-clock' },
  { keywords: ['passkey', 'biometric', 'webauthn', 'fingerprint', 'face id'], tab: 'security', title: 'PassKey', subtitle: 'Security', icon: 'mdi-fingerprint' },
  { keywords: ['website protection', 'malicious', 'cardano shield', 'phishing'], tab: 'security', title: 'Website Protection', subtitle: 'Security', icon: 'mdi-shield-check' },
  { keywords: ['two factor', '2fa', 'two-factor', 'authenticator'], tab: 'security', title: 'Two-Factor Authentication', subtitle: 'Security', icon: 'mdi-two-factor-authentication' },
  // Advanced
  { keywords: ['shop earn', 'cashback popups', 'bring', 'shop and earn'], tab: 'advanced', title: 'Shop & Earn Popups', subtitle: 'Advanced', icon: 'mdi-shopping' },
  { keywords: ['auto submit', 'tx auto submit', 'transaction auto'], tab: 'advanced', title: 'TX Auto Submit', subtitle: 'Advanced', icon: 'mdi-send-check' },
  { keywords: ['popup', 'sidepanel', 'side panel', 'display mode', 'prompt'], tab: 'advanced', title: 'Prompt Display Mode', subtitle: 'Advanced', icon: 'mdi-monitor' },
  { keywords: ['resync', 're-sync', 'sync wallet', 'refresh'], tab: 'advanced', title: 'Re-Sync Wallet', subtitle: 'Advanced', icon: 'mdi-sync' },
  { keywords: ['delete wallet', 'remove wallet', 'danger'], tab: 'advanced', title: 'Delete Wallet', subtitle: 'Advanced', icon: 'mdi-delete' },
];

export function useGlobalSearch() {
  const { allTokens } = useMarketData();
  const { collections: nftCollections } = useNftMarketData();

  function open() {
    isOpen.value = true;
    query.value = '';
    results.value = [];
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
        subtitle: `${c.quantity} NFT${c.quantity !== 1 ? 's' : ''}`,
        icon: c.img || 'mdi-image-multiple',
        data: c,
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
      }));
    found.push(...contactMatches);

    // 5. Stake pools — from in-memory store (may be empty if not loaded)
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
            subtitle: 'Stake Pool',
            icon: 'mdi-server',
            route: `/staking?pool=${p.pool_id_bech32 || p.poolId}`,
            data: p,
          }));
        found.push(...poolMatches);
      }
    } catch {
      // stakingStore not available
    }

    // 6. DReps — from in-memory store (may be empty if not loaded)
    try {
      const dreps = governanceStore.dreps || [];
      if (dreps.length > 0) {
        const drepMatches = dreps
          .filter((d: any) =>
            d.name?.toLowerCase().includes(lower) ||
            (lower.length >= 8 && d.drep_id?.toLowerCase().includes(lower))
          )
          .slice(0, 5)
          .map((d: any) => ({
            type: 'drep' as const,
            id: d.drep_id,
            title: d.name || d.drep_id?.slice(0, 20) + '...',
            subtitle: 'DRep',
            icon: 'mdi-vote',
            route: `/governance?drep=${d.drep_id}`,
            data: d,
          }));
        found.push(...drepMatches);
      }
    } catch {
      // governanceStore not available
    }

    // 7. Settings — match against keywords index
    const settingMatches = SETTINGS_INDEX
      .filter(s => s.keywords.some(kw => kw.includes(lower)) || s.title.toLowerCase().includes(lower))
      .slice(0, 5)
      .map(s => ({
        type: 'setting' as const,
        id: `setting-${s.tab}-${s.title}`,
        title: s.title,
        subtitle: `Settings → ${s.subtitle}`,
        icon: s.icon,
        data: { tab: s.tab, highlight: s.title },
      }));
    found.push(...settingMatches);

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

    // Stake pools (if not already loaded in memory)
    if (!stakingStore.pools?.length) {
      apiSearches.push(
        blockchainApi.getPoolsPaginated({ search: q, page: 1, pageSize: 5 }, chain, network)
          .then((res: any) => {
            const items = res?.items || [];
            for (const p of items) {
              found.push({
                type: 'pool',
                id: p.pool_id_bech32 || p.poolId,
                title: p.ticker ? `[${p.ticker}] ${p.name}` : p.name || p.pool_id_bech32,
                subtitle: 'Stake Pool',
                icon: 'mdi-server',
                route: `/staking?pool=${p.pool_id_bech32 || p.poolId}`,
                data: p,
              });
            }
          })
          .catch(() => {})
      );
    }

    // DReps (if not already loaded in memory)
    if (!governanceStore.dreps?.length) {
      apiSearches.push(
        blockchainApi.getDRepsPaginated({ search: q, page: 1, pageSize: 5 }, chain, network)
          .then((res: any) => {
            const items = res?.items || [];
            for (const d of items) {
              found.push({
                type: 'drep',
                id: d.drep_id,
                title: d.name || d.drep_id?.slice(0, 20) + '...',
                subtitle: 'DRep',
                icon: 'mdi-vote',
                route: `/governance?drep=${d.drep_id}`,
                data: d,
              });
            }
          })
          .catch(() => {})
      );
    }

    // Cashback retailers
    apiSearches.push(
      cashbackApi.retailers(null, q)
        .then((res: any) => {
          const items = res?.items || [];
          const iconBase = res?.retailerIconBasePath || '';
          const iconQuery = res?.iconQueryParam || '';
          for (const r of items.slice(0, 5)) {
            found.push({
              type: 'retailer',
              id: r.id,
              title: r.name,
              subtitle: 'Cashback Store',
              icon: iconBase + r.iconPath + iconQuery || 'mdi-shopping',
              route: `/cashback?store=${r.name}`,
              data: r,
            });
          }
        })
        .catch(() => {})
    );

    await Promise.allSettled(apiSearches);
    return found;
  }

  // ── Combined search ──────────────────────────────────────────────────────────

  async function search(q: string) {
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
        // Merge — deduplicate by id
        const existingIds = new Set(results.value.map(r => r.id));
        const newResults = remoteResults.filter(r => !existingIds.has(r.id));
        if (newResults.length > 0) {
          results.value = [...results.value, ...newResults];
        }
      } catch {
        // API search failed, local results still visible
      } finally {
        searching.value = false;
      }
    }
  }

  // Debounced search on query change
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  watch(query, (val) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    // Local results: fast (100ms), API results: slower (300ms handled inside search)
    debounceTimer = setTimeout(() => search(val), 150);
  });

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
