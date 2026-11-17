import { mockGlobalProperties } from '@test/helpers/globalProperties';
// The single-action Vote button on an action's detail page. Every software HD wallet
// derives a DRep key, so the key alone must not enable it: the node rejects votes from a
// DRep that is not registered on chain ("Some voters in the transaction are unknown").
// The button waits for the on-chain registration lookup (#1091).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { WalletType } from '@/models/types';
import { resetDrepRegistration } from '@/shared/composables/useVoting';

vi.mock('@/shared/composables/useTranslation', async () => ({ useTranslation: (await import('@test/helpers/translations')).useMockTranslation }));

const CRED = '463796d2a39623a5441e9eab1594c2d21f96d2a544f49f82bc023bff';

const { mockWalletStore, mockGetDRepById } = vi.hoisted(() => ({
  mockWalletStore: {} as Record<string, unknown>,
  mockGetDRepById: vi.fn(),
}));

vi.mock('@/stores/walletStore', async () => {
  const { reactive } = await import('vue');
  return { walletStore: reactive(mockWalletStore) };
});
vi.mock('@/stores/networkStore', () => ({ networkStore: { epochParams: null, tip: null } }));
vi.mock('@/stores/featureFlagsStore', () => ({ featureFlagsStore: { isGovernanceVotingEnabled: () => true } }));
vi.mock('@/shared/utils/builder', () => ({ buildCardanoTransaction: vi.fn() }));
vi.mock('@/api/blockchain-api', () => ({ default: { getDRepById: mockGetDRepById } }));
vi.mock('@/shared/components/GButton/GButton.vue', () => ({
  default: {
    name: 'GButton',
    props: ['disabled', 'tier'],
    emits: ['click'],
    template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
  },
}));

// @ts-ignore — tsconfig ships no `*.vue` shim; vite resolves this fine.
import VoteCta from './VoteCta.vue';
import { walletStore } from '@/stores/walletStore';

enableAutoUnmount(afterEach);

const ACTION = { txHash: 'a'.repeat(64), index: 0, status: 'Active' };

function setWallet(drep129: unknown[]) {
  Object.assign(walletStore, {
    loggedWallet: { type: WalletType.Normal, chain: 'cardano', network: 'preprod' },
    transactions: [],
    utxos: [],
    keys: { payment: [], change: [], stake: [], drep105: [], drep129, ccCold: [], ccHot: [], script: [] },
  });
}

async function mountCta() {
  const wrapper = mount(VoteCta, {
    props: { action: ACTION as never },
    global: { config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) } },
  });
  await flushPromises();
  return wrapper;
}

describe('VoteCta registration gate (#1091)', () => {
  beforeEach(() => {
    resetDrepRegistration();
    mockGetDRepById.mockReset();
    setWallet([{ address: CRED, cred: CRED, path: "m/1852'/1815'/0'/3/0" }]);
  });

  it('a derived DRep key with no on-chain record leaves the button disabled with the register hint', async () => {
    mockGetDRepById.mockResolvedValue(null);
    const wrapper = await mountCta();
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('governance.drepRequiredToVote');
  });

  it('a retired DRep (registered: false) leaves the button disabled', async () => {
    mockGetDRepById.mockResolvedValue({ registered: false });
    const wrapper = await mountCta();
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('governance.drepRequiredToVote');
  });

  it('a failed lookup leaves the button disabled', async () => {
    mockGetDRepById.mockRejectedValue(new Error('offline'));
    const wrapper = await mountCta();
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
  });

  it('a registered DRep can vote, inactive or not', async () => {
    mockGetDRepById.mockResolvedValue({ registered: true, active: false });
    const wrapper = await mountCta();
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined();
    expect(wrapper.text()).not.toContain('governance.drepRequiredToVote');
    expect(mockGetDRepById).toHaveBeenCalledWith(CRED, 'cardano', 'preprod');
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('vote')).toHaveLength(1);
  });

  it('a wallet with no DRep key never looks anything up', async () => {
    setWallet([]);
    const wrapper = await mountCta();
    expect(mockGetDRepById).not.toHaveBeenCalled();
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('governance.drepRequiredToVote');
  });
});
