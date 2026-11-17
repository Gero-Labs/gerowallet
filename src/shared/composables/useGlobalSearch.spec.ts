import * as Vue from 'vue';
import { nextTick, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GovProposal } from '@/api/governance.types';
import { Blockchain, Network } from '@/models/types';

// The market flag and the wallet's own NFT collections, which the tests below change.
const market = vi.hoisted(() => ({ enabled: false, held: [] as { policyId: string; name: string; quantity: number }[] }));

vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/walletStore', () => ({
  default: { hasBackup: () => false },
  walletStore: Vue.reactive({
    loggedWallet: { chain: 'Cardano', network: 'Mainnet', type: 'Normal' },
    transactions: [],
    collections: {},
    contacts: {},
    config: {},
  }),
}));
vi.mock('@/stores/stakingStore', () => ({ stakingStore: { pools: [], poolsFor: null } }));
vi.mock('@/stores/midnightStore', () => ({ midnightStore: { transactions: [] } }));
vi.mock('@/stores/musicStore', () => ({ musicStore: { musicPlaylist: undefined } }));
vi.mock('@/stores/governanceActionsStore', () => ({ default: { state: { actions: [], actionsNetwork: null } } }));
vi.mock('@/stores/featureFlagsStore', () => ({
  featureFlagsStore: {
    isGovernanceEnabled: () => true,
    isGovernanceVotingEnabled: () => false,
    isBitcoinEnabled: () => false,
    isRealFiEnabled: () => false,
    isGeroCardEnabled: () => false,
    isGoMiningEnabled: () => false,
    isBlogEnabled: () => false,
    isCopilotEnabled: () => false,
    isPoolOperatorEnabled: () => false,
    isCrossDeviceSigningEnabled: () => false,
    isLiveChatEnabled: () => false,
    isNftMarketEnabled: () => market.enabled,
  },
}));
vi.mock('@/modules/market/composables/useMarketData', () => ({ useMarketData: () => ({ allTokens: ref([]) }) }));
vi.mock('@/modules/market/composables/useNftMarketData', () => ({ useNftMarketData: () => ({ collections: ref(market.held) }) }));
vi.mock('@/shared/composables/useHoldingsValuation', () => ({ useHoldingsValuation: () => ({ holdings: ref([]) }) }));
vi.mock('@/api/blockchain-api', () => ({
  default: {
    getPoolsPaginated: vi.fn(async () => ({ items: [] })),
    getDRepsPaginated: vi.fn(async () => ({ items: [] })),
  },
}));
vi.mock('@/api/cashback-api', () => ({ default: { retailers: vi.fn(async () => ({ items: [] })) } }));
vi.mock('@/api/governance-api', () => ({ default: { listProposals: vi.fn() } }));

import governanceApi from '@/api/governance-api';
import { walletStore } from '@/stores/walletStore';
import { useGlobalSearch } from './useGlobalSearch';

const TX_HASH = 'a'.repeat(64);

const proposal: GovProposal = {
  govActionId: `${TX_HASH}#0`,
  govActionIdCip129: 'gov_action1example',
  txHash: TX_HASH,
  index: 0,
  slot: null,
  type: 'InfoAction',
  status: 'active',
  deposit: null,
  returnAddress: null,
  anchorUrl: null,
  anchorHash: null,
  title: 'Constitution update',
  submittedEpoch: null,
  expiresEpoch: null,
};

describe('useGlobalSearch', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('finds a governance action whose page lands after the user typed', async () => {
    // Nexus has no proposal search, so actions come from pages fetched on open.
    // When typing beats that fetch, only the async phase can deliver the result.
    let deliver: (page: { items: GovProposal[] }) => void = () => {};
    const pending = new Promise<{ items: GovProposal[] }>(resolve => { deliver = resolve; });
    vi.mocked(governanceApi.listProposals).mockReturnValue(pending as never);

    const search = useGlobalSearch();
    search.open();
    search.query.value = 'constitution';
    await nextTick();
    await vi.advanceTimersByTimeAsync(150); // the query debounce

    expect(search.results.value.some(result => result.type === 'govAction')).toBe(false);

    deliver({ items: [proposal] });
    await vi.waitFor(() => {
      expect(search.results.value).toContainEqual(expect.objectContaining({
        type: 'govAction',
        title: 'Constitution update',
        route: `/governance/actions/${TX_HASH}/0`,
      }));
    });
    search.close();
  });
});

describe('useGlobalSearch: a collection the wallet does not hold', () => {
  const POLICY = 'cd'.repeat(28);
  const UNIT = `${POLICY}4e4654`;

  async function searchFor(text: string) {
    const search = useGlobalSearch();
    search.open();
    search.query.value = text;
    await nextTick();
    await vi.advanceTimersByTimeAsync(150); // the query debounce
    const found = search.results.value.filter(result => result.type === 'nft');
    search.close();
    return found;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(governanceApi.listProposals).mockResolvedValue({ items: [] } as never);
    market.enabled = true;
    market.held.length = 0; // in place: the search keeps the list it was first given
    walletStore.loggedWallet = { chain: Blockchain.CARDANO, network: Network.PREPROD, type: 'Normal' } as never;
  });
  afterEach(() => {
    vi.useRealTimers();
    market.enabled = false;
    walletStore.loggedWallet = { chain: 'Cardano', network: 'Mainnet', type: 'Normal' } as never;
  });

  it('offers the listings of a collection whose policy ID was pasted', async () => {
    expect(await searchFor(POLICY)).toEqual([expect.objectContaining({
      type: 'nft',
      id: POLICY,
      title: 'nftMarket.browse.notHeldTitle',
      data: { policyId: POLICY },
    })]);
  });

  it('offers the same for a pasted NFT unit: its collection', async () => {
    expect(await searchFor(UNIT)).toEqual([expect.objectContaining({ data: { policyId: POLICY } })]);
  });

  it('adds nothing for a collection the wallet holds: its own row opens it, listings included', async () => {
    market.held.push({ policyId: POLICY, name: 'Cool Cats', quantity: 2 });
    expect(await searchFor(POLICY)).toEqual([expect.objectContaining({ title: 'Cool Cats', data: { policyId: POLICY } })]);
  });

  it('adds nothing while the market cannot be browsed', async () => {
    market.enabled = false;
    expect(await searchFor(POLICY)).toEqual([]);
    market.enabled = true;
    walletStore.loggedWallet = { chain: Blockchain.CARDANO, network: Network.MAINNET, type: 'Normal' } as never;
    expect(await searchFor(POLICY)).toEqual([]);
  });

  it('adds nothing for text that names no collection', async () => {
    expect(await searchFor('cool cats')).toEqual([]);
  });
});
