import Vue, { nextTick, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GovProposal } from '@/api/governance.types';

vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/walletStore', () => ({
  default: { hasBackup: () => false },
  walletStore: Vue.observable({
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
  },
}));
vi.mock('@/modules/market/composables/useMarketData', () => ({ useMarketData: () => ({ allTokens: ref([]) }) }));
vi.mock('@/modules/market/composables/useNftMarketData', () => ({ useNftMarketData: () => ({ collections: ref([]) }) }));
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
