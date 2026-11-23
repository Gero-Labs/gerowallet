import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { computed, ref } from 'vue';
import type { Cardano } from '@cardano-sdk/core';
import type { GovProposal } from '@/api/governance.types';
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import CastVoteDialog from './CastVoteDialog.vue';

const { prepare, cast, handleSign } = vi.hoisted(() => ({ prepare: vi.fn(), cast: vi.fn(), handleSign: vi.fn() }));
vi.mock('@/modules/governance/composables/useHolderAnswers', () => ({
  useHolderAnswers: () => ({ canAnswer: computed(() => true), prepareAnswers: prepare }),
}));
vi.mock('@/shared/composables/useVoting', () => ({
  useVoting: () => ({ capability: computed(() => ({ canVote: false })), castVotes: cast }),
}));
vi.mock('@/stores/walletStore', async () => ({
  walletStore: (await import('vue')).reactive({ loggedWallet: { id: 1, type: 'Normal', chain: 'Cardano', network: 'Preprod' },
    transactions: [], keys: { drep129: [] } }),
}));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/shared/composables/useTransactionSigning', () => ({
  useTransactionSigning: () => ({
    resetState: vi.fn(), handleSign, loading: ref(false), isPrfWallet: ref(false), isSubmit: ref(false),
    spendingPassword: ref(''), valid: ref(true), isBT: ref(false),
  }),
}));

const hash = 'ab'.repeat(32);
const actions = [0, 1].map(index => ({ txHash: hash, index, govActionId: `${hash}#${index}`,
  status: 'active', type: 'InfoAction', title: `Action ${index}` } as GovProposal));
function open() {
  return mount(CastVoteDialog, { props: { isOpen: true, mode: 'answer', actions }, global: {
    config: { globalProperties: mockGlobalProperties({ $t: (s: string) => s }) },
    stubs: {
      BaseDialog: { template: '<section><slot /></section>' },
      GButton: { props: ['disabled'], template: '<button :disabled="disabled"><slot /></button>' },
      TransactionAuthSection: true, KeystoneSignDialog: true, 'v-icon': true,
      'v-card-text': { template: '<div><slot /></div>' }, 'v-form': { template: '<form><slot /></form>' },
    },
  } });
}
describe('holder answer review', () => {
  it('requires an explicit choice for each action and shows the fee before authorizing', async () => {
    prepare.mockResolvedValue({ body: { fee: 184321n } });
    const page = open();
    const review = page.get('.cast-vote__cta button');
    expect(review.attributes('disabled')).toBeDefined();
    const groups = page.findAll('[role="group"]');
    await groups[0].findAll('button')[0].trigger('click');
    expect(review.attributes('disabled')).toBeDefined();
    await groups[1].findAll('button')[2].trigger('click');
    await review.trigger('click');
    await flushPromises();
    expect(prepare).toHaveBeenCalledWith([
      { govActionId: `${hash}#0`, choice: 'Yes' }, { govActionId: `${hash}#1`, choice: 'Abstain' },
    ], expect.any(Function));
    expect(page.text()).toContain('governance.holderDisclosure');
    expect(page.text()).not.toContain('governance.votingPower');
    expect(page.text()).toContain('0.184321');
    expect(page.findAll('.cast-vote__summary-row')).toHaveLength(2);
    expect(handleSign).not.toHaveBeenCalled();
    await page.get('.cast-vote__auth button').trigger('click');
    expect(handleSign).toHaveBeenCalledOnce();
    expect(cast).not.toHaveBeenCalled();
    page.unmount();
  });

  it('discards an old review result after closing and reopening', async () => {
    let resolve!: (tx: Partial<Cardano.Tx>) => void;
    prepare.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const page = open();
    for (const group of page.findAll('[role="group"]')) await group.get('button').trigger('click');
    await page.get('.cast-vote__cta button').trigger('click');
    await page.setProps({ isOpen: false });
    await page.setProps({ isOpen: true });
    resolve({});
    await flushPromises();
    expect(page.find('.cast-vote__auth').exists()).toBe(false);
    expect(page.get('.cast-vote__cta button').attributes('disabled')).toBeDefined();
    page.unmount();
  });
});
