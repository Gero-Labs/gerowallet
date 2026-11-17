// The panel's bottom tabs per chain: Solana, like Midnight, has Home and Activity only.
import { computed } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';

const chain = vi.hoisted(() => ({ isMidnight: false, isSolana: false }));
vi.mock('vue-router', () => ({ useRoute: () => ({ path: '/' }) }));
vi.mock('@/stores/featureFlagsStore', () => ({ featureFlagsStore: { isCopilotEnabled: () => true } }));
vi.mock('./useChainContext', () => ({
  useChainContext: () => ({
    isMidnight: computed(() => chain.isMidnight),
    isSolana: computed(() => chain.isSolana),
    networkInfo: computed(() => ({ stakingSupport: !chain.isSolana, swapSupport: !chain.isSolana })),
  }),
}));

import { useMiniNavigation } from './useMiniNavigation';

const names = () => useMiniNavigation().navTabs.value.map((tab) => tab.name);

describe('useMiniNavigation', () => {
  afterEach(() => {
    chain.isSolana = false;
  });

  it('gives a Solana wallet Home and Activity only', () => {
    chain.isSolana = true;
    expect(names()).toEqual(['home', 'activity']);
  });

  it('keeps the Cardano tabs for Cardano', () => {
    expect(names()).toEqual(['home', 'staking', 'swap', 'market', 'activity', 'feed']);
  });
});
