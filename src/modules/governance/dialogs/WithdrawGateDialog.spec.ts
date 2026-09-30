import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type Wrapper } from '@vue/test-utils';
import Vue, { ref, type CreateElement } from 'vue';
import { Cardano } from '@cardano-sdk/core';
import { Blockchain, Network, WalletType } from '@/models/types';
import { walletStore } from '@/stores/walletStore';
import { Messaging } from '@/chrome/messaging';
import { buildCardanoTransaction } from '@/shared/utils/builder';

const components = vi.hoisted(() => ({
  dialog: {
    render(this: Vue, h: CreateElement) { return h('div', this.$slots['default']); },
  },
  button: {
    render(this: Vue, h: CreateElement) { return h('button', { on: this.$listeners }, this.$slots['default']); },
  },
  error: {
    props: ['message'],
    render(this: Vue & { message: string }, h: CreateElement) { return h('div', String(this.message)); },
  },
  empty: { render(h: CreateElement) { return h('div'); } },
}));
vi.mock('@/shared/dialogs/BaseDialog.vue', () => ({ default: components.dialog }));
vi.mock('@/shared/dialogs/KeystoneSignDialog.vue', () => ({ default: components.empty }));
vi.mock('@/shared/components/TransactionAuthSection.vue', () => ({ default: components.empty }));
vi.mock('@/shared/components/GButton/GButton.vue', () => ({ default: components.button }));
vi.mock('@/shared/components/feedback/ErrorState.vue', () => ({ default: components.error }));
vi.mock('vue-router/composables', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/walletStore', () => ({ walletStore: Vue.observable({ loggedWallet: null, account: null, keys: null, utxos: [] }) }));
vi.mock('@/stores/networkStore', () => ({ networkStore: Vue.observable({ epochParams: { stakeKeyDeposit: '2000000' }, tip: { slot: 100 } }) }));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: vi.fn() } }));
vi.mock('@/shared/utils/builder', () => ({ buildCardanoTransaction: vi.fn() }));
vi.mock('@/utils/networks', () => ({ default: { resolveCurrencySymbol: () => 'tADA' } }));
vi.mock('@/shared/utils/filters', () => ({ default: { toCurrency: (value: unknown) => String(value) } }));

let signingTx: { value: Cardano.Tx | undefined };
vi.mock('@/shared/composables/useTransactionSigning', () => ({
  useTransactionSigning: ({ tx }: { tx: typeof signingTx }) => {
    signingTx = tx;
    const loading = ref(false);
    return {
      loading, spendingPassword: ref(''), isSubmit: ref(false), isBT: ref(false),
      valid: ref(false), passwordRules: [], isPrfWallet: ref(false), isBTSupported: ref(false),
      resetState: () => { loading.value = false; }, handleSign: vi.fn(),
    };
  },
}));

// @ts-ignore — vite resolves Vue SFCs; the repository has no *.vue shim.
import WithdrawGateDialog from './WithdrawGateDialog.vue';

let wrapper: Wrapper<Vue>;
const send = vi.mocked(Messaging.sendToBackgroundFromOptions);
const build = vi.mocked(buildCardanoTransaction);

function mountGate() {
  wrapper = mount(WithdrawGateDialog, { propsData: { isOpen: true }, mocks: { $t: (key: string) => key }, stubs: { 'v-icon': true } });
}

async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  await Vue.nextTick();
}

async function withdraw() {
  await wrapper.findAll('button').at(1).trigger('click');
  await flush();
}

function tx(): Cardano.Tx {
  return { body: { fee: 178000n } } as unknown as Cardano.Tx;
}

describe('withdrawal gate registration preflight', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    Object.assign(walletStore, {
      loggedWallet: { id: 1, stakeAddress: 'stake_test1test', network: Network.PREPROD, chain: Blockchain.CARDANO, type: WalletType.Normal },
      account: { controlled_amount: '20000000', withdrawable_amount: '1000000' },
      keys: { stake: [{ cred: '00'.repeat(28) }], payment: [{ address: 'addr_test1test' }] },
    });
    send.mockResolvedValue({ data: { active: true, pool_id: null, drep_id: null, withdrawable_amount: '3000000' } });
    build.mockResolvedValue(tx());
  });
  afterEach(() => {
    wrapper?.destroy();
    vi.restoreAllMocks();
  });

  it('uses fresh registration and rewards instead of a thin cache, without another deposit', async () => {
    mountGate();
    await withdraw();
    expect(build).toHaveBeenCalledWith(expect.objectContaining({
      certificates: [expect.objectContaining({ __typename: Cardano.CertificateType.VoteDelegation })],
      withdrawals: [{ stakeAddress: 'stake_test1test', quantity: 3000000n }],
      implicitCoin: 0n,
    }));
    expect(signingTx.value).toBeDefined();
  });

  it('funds registration only for an explicitly unregistered stake key', async () => {
    send.mockResolvedValue({ data: { active: false, pool_id: null, drep_id: null, withdrawable_amount: '0' } });
    mountGate();
    await withdraw();
    expect(build).toHaveBeenCalledWith(expect.objectContaining({
      certificates: [expect.objectContaining({ __typename: Cardano.CertificateType.Registration }), expect.objectContaining({ __typename: Cardano.CertificateType.VoteDelegation })],
      implicitCoin: 2000000n, withdrawals: [],
    }));
  });

  it.each([{ data: { controlled_amount: '20000000' } }, { error: 'staking.registrationLookupFailed' }, { data: [] }])('blocks construction when lookup cannot establish registration: %j', async response => {
    send.mockResolvedValue(response);
    mountGate();
    await withdraw();
    expect(build).not.toHaveBeenCalled();
    expect(signingTx.value).toBeUndefined();
    expect(wrapper.text()).toContain('errors.buildTransactionFailed');
  });

  it('discards the transaction when the active wallet changes during construction', async () => {
    build.mockImplementation(async () => {
      walletStore.loggedWallet = { ...walletStore.loggedWallet, id: 2 };
      return tx();
    });
    mountGate();
    await withdraw();
    expect(signingTx.value).toBeUndefined();
    expect(wrapper.text()).toContain('staking.walletChanged');
  });

  it('discards a build that finishes after the dialog closes', async () => {
    let resolveBuild!: (value: Cardano.Tx) => void;
    build.mockReturnValueOnce(new Promise(resolve => { resolveBuild = resolve; }));
    mountGate();
    await withdraw();
    expect(build).toHaveBeenCalledTimes(1);
    await wrapper.setProps({ isOpen: false });
    resolveBuild(tx());
    await flush();
    expect(signingTx.value).toBeUndefined();
  });
});
