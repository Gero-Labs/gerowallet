// The sheet that takes an NFT off the market: the worker builds and verifies the cancel of the
// wallet's own listing, the sheet shows what comes back (the NFT and the deposit) and what it
// costs, then signs and submits it. The prepared-tx flow is replaced by refs and spies the test
// owns (useNftMarketFlow and usePreparedTxFlow have their own specs); what is checked here is
// what the sheet asks of it, in which state, and what it shows. The copy is the real English
// table, so a mistyped key shows up as a raw key in the assertions.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import type { Ref } from 'vue';
import { createTestVuetify } from '@test/helpers/vuetify';
import type { OwnListing } from '@/chrome/nftMarket/ownListings';
import { Blockchain, Network } from '@/models/types';

const TX_CBOR = '84a400';
const TX_ID = 'ab'.repeat(32);
const POLICY = 'cd'.repeat(28);
const UNIT = `${POLICY}4e4654`;
const LISTING_REF = `${'11'.repeat(32)}#0`;
const ADA = 1_000_000n;

const EXISTING: OwnListing = {
  ref: LISTING_REF,
  unit: UNIT,
  datum: { owner: 'aa'.repeat(28), sellerAddress: 'addr_test1seller', price: 120n * ADA, royalties: [], buyer: null },
  depositLovelace: '1550000',
  deploymentVersion: 1,
};

/** What the worker verified for the cancel. */
const SUMMARY = {
  txId: TX_ID,
  ref: LISTING_REF,
  unit: UNIT,
  returnAddress: 'addr_test1return',
  depositLovelace: '1550000',
  networkFeeLovelace: '312345',
};

type FlowStage = 'idle' | 'preparing' | 'review' | 'signing' | 'submitting' | 'done';
const flow = vi.hoisted(
  () =>
    ({}) as {
      stage: Ref<FlowStage>;
      prepared: Ref<{ txCbor: string; txId: string; summary: Record<string, unknown> } | null>;
      failure: Ref<{ code: string } | null>;
      submittedTxId: Ref<string | null>;
      prepare: Mock<(payload: Record<string, unknown>) => Promise<boolean>>;
      signAndSubmit: Mock<(credentials?: { password?: string }) => Promise<boolean>>;
      reset: Mock<() => void>;
      keystone: { keystoneShow: Ref<boolean> };
      action: string | undefined;
    },
);
const walletState = vi.hoisted(() => ({
  loggedWallet: { id: 1, chain: 'Cardano', network: 'Preprod', type: 'Normal' } as Record<string, unknown>,
  keys: { payment: [], change: [], stake: [] },
  utxos: [],
}));
const allowedHardware = vi.hoisted(() => ({ types: [] as string[] }));

vi.mock('@/shared/composables/useNftMarketFlow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/composables/useNftMarketFlow')>();
  const { computed, ref } = await import('vue');
  flow.stage = ref('idle');
  flow.prepared = ref(null);
  flow.failure = ref(null);
  flow.submittedTxId = ref(null);
  flow.keystone = { keystoneShow: ref(false) };
  flow.prepare = vi.fn<(payload: Record<string, unknown>) => Promise<boolean>>();
  flow.signAndSubmit = vi.fn<(credentials?: { password?: string }) => Promise<boolean>>();
  flow.reset = vi.fn<() => void>(() => {
    flow.stage.value = 'idle';
    flow.prepared.value = null;
    flow.failure.value = null;
    flow.submittedTxId.value = null;
  });
  return {
    ...actual,
    useNftMarketFlow: (action: 'cancel') => {
      flow.action = action;
      const described = computed(() => (flow.failure.value ? actual.describeNftMarketFailure(action, flow.failure.value) : null));
      return {
        stage: flow.stage,
        prepared: flow.prepared,
        failure: flow.failure,
        submittedTxId: flow.submittedTxId,
        prepare: flow.prepare,
        signAndSubmit: flow.signAndSubmit,
        reset: flow.reset,
        failureKind: computed(() => described.value?.kind ?? null),
        failureMessage: computed(() => described.value?.message ?? null),
        keystone: {
          keystoneShow: flow.keystone.keystoneShow,
          keystoneType: ref('crypto-psbt'),
          keystoneCbor: ref('aa'),
          onKeystoneScan: vi.fn(),
          cancelKeystone: vi.fn(),
          failKeystone: vi.fn(),
        },
      };
    },
  };
});
vi.mock('@/shared/composables/useCollectibleCollections', () => ({
  resolveNftUnit: (unit: string) => ({ unit, name: 'Equine Pioneer 04601', img: 'https://img.example/1.png', fingerprint: 'asset1x' }),
}));
vi.mock('@/stores/walletStore', async () => {
  const { reactive } = await import('vue');
  return { walletStore: reactive(walletState) };
});
vi.mock('@/shared/composables/useExplorer', () => ({
  useExplorer: () => ({ explorerUrl: (_: string, id: string) => (id ? `https://explorer.example/${id}` : '') }),
}));
vi.mock('@/utils/nftMarketDeployments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/nftMarketDeployments')>();
  return { ...actual, isNftMarketHardware: (type: string | null | undefined) => actual.isNftMarketHardware(type, allowedHardware.types) };
});
// BaseDialog is a v-dialog (teleported); a plain wrapper keeps the content in the test's DOM.
vi.mock('@/shared/dialogs/BaseDialog.vue', () => ({
  default: {
    props: ['isOpen', 'title', 'subtitle', 'persistent'],
    emits: ['close'],
    template: `<div v-if="isOpen" data-test="dialog" :data-persistent="String(persistent)">
      <h2 data-test="dialog-title">{{ title }}</h2>
      <p data-test="dialog-subtitle">{{ subtitle }}</p>
      <button data-test="dialog-close" @click="$emit('close')">x</button>
      <slot />
    </div>`,
  },
}));
vi.mock('@/shared/components/PassKeyPasswordField.vue', () => ({
  default: {
    props: ['modelValue'],
    emits: ['update:modelValue', 'enter'],
    template: `<input data-test="password" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
  },
}));
vi.mock('@/shared/components/PassKeyAuthButton.vue', async () => {
  const { h } = await import('vue');
  return {
    default: {
      emits: ['success', 'error'],
      setup: (_: unknown, { emit }: { emit: (event: 'success', bytes: Uint8Array) => void }) => () =>
        h('button', { 'data-test': 'passkey', onClick: () => emit('success', new Uint8Array([1, 2, 3])) }),
    },
  };
});
vi.mock('@/shared/dialogs/KeystoneSignDialog.vue', () => ({
  default: { props: ['isOpen', 'keystoneType', 'keystoneCbor'], template: '<div data-test="keystone-dialog" />' },
}));

import UnlistNftDialog from './UnlistNftDialog.vue';
import { walletStore } from '@/stores/walletStore';

enableAutoUnmount(afterEach);

const store = walletStore as unknown as typeof walletState;

function prepareSucceeds(summary: Record<string, unknown> = SUMMARY) {
  flow.prepare.mockImplementation(async () => {
    flow.failure.value = null;
    flow.prepared.value = { txCbor: TX_CBOR, txId: TX_ID, summary };
    flow.stage.value = 'review';
    return true;
  });
}

function prepareFails(code: string) {
  flow.prepare.mockImplementation(async () => {
    flow.prepared.value = null;
    flow.failure.value = { code };
    flow.stage.value = 'idle';
    return false;
  });
}

function signingSucceeds() {
  flow.signAndSubmit.mockImplementation(async () => {
    flow.submittedTxId.value = TX_ID;
    flow.stage.value = 'done';
    return true;
  });
}

function render(props: { isOpen?: boolean; existing?: OwnListing } = {}) {
  return mount(UnlistNftDialog, {
    attachTo: document.body,
    props: { isOpen: true, existing: EXISTING, ...props },
    global: { plugins: [createTestVuetify()] },
  });
}

type Wrapper = ReturnType<typeof render>;
const body = (wrapper: Wrapper) => wrapper.get('[data-testid="unlist-nft"]');
const byId = (wrapper: Wrapper, id: string) => wrapper.get(`[data-testid="unlist-nft-${id}"]`);
const has = (wrapper: Wrapper, id: string) => wrapper.find(`[data-testid="unlist-nft-${id}"]`).exists();

describe('UnlistNftDialog', () => {
  beforeEach(() => {
    flow.reset();
    flow.keystone.keystoneShow.value = false;
    flow.action = undefined;
    flow.prepare.mockReset();
    flow.signAndSubmit.mockReset();
    flow.reset.mockClear();
    store.loggedWallet = { id: 1, chain: Blockchain.CARDANO, network: Network.PREPROD, type: 'Normal' };
    allowedHardware.types = [];
    prepareSucceeds();
    signingSucceeds();
  });
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('asks the worker to cancel that listing when it opens, naming nothing but the listing', async () => {
    const wrapper = render();
    await flushPromises();

    expect(flow.action).toBe('cancel');
    expect(flow.prepare).toHaveBeenCalledTimes(1);
    expect(flow.prepare).toHaveBeenCalledWith({ ref: LISTING_REF });
    expect(wrapper.get('[data-test="dialog-title"]').text()).toBe('Unlist');
  });

  it('waits while the worker builds, and nothing may close the sheet', async () => {
    flow.prepare.mockImplementation(() => {
      flow.stage.value = 'preparing';
      return new Promise(() => {});
    });
    const wrapper = render();
    await flushPromises();

    expect(has(wrapper, 'preparing')).toBe(true);
    expect(has(wrapper, 'confirm')).toBe(false);
    expect(wrapper.get('[data-test="dialog-subtitle"]').text()).toBe('Take your NFT off the market. It goes back to your wallet along with your deposit.');
    expect(wrapper.get('[data-test="dialog"]').attributes('data-persistent')).toBe('true');
  });

  it('shows the NFT and the deposit coming back, and the network fee', async () => {
    const wrapper = render();
    await flushPromises();

    const review = byId(wrapper, 'review');
    expect(review.text()).toContain('You get back');
    expect(wrapper.get('[data-testid="listing-nft-name"]').text()).toBe('Equine Pioneer 04601');
    expect(review.get('[data-testid="unlist-nft-nft"]').text()).toBe('NFTEquine Pioneer 04601');
    expect(review.get('[data-testid="unlist-nft-deposit"]').text()).toBe('Your deposit, returned to you1.55 ADA');
    expect(review.get('[data-testid="unlist-nft-network-fee"]').text()).toBe('Network Fee0.312345 ADA');
    expect(review.text()).toContain('The deposit is locked with your NFT. It comes back to you when it sells or when you unlist it.');
    expect(has(wrapper, 'confirm')).toBe(true);
  });

  it('shows the worker\'s verified deposit, not the one the store holds', async () => {
    prepareSucceeds({ ...SUMMARY, depositLovelace: '1620000' });
    const wrapper = render();
    await flushPromises();
    expect(byId(wrapper, 'deposit').text()).toBe('Your deposit, returned to you1.62 ADA');
  });

  it('shows that Gero lends the collateral when the summary says so', async () => {
    prepareSucceeds({ ...SUMMARY, sponsoredCollateralRef: `${'ee'.repeat(32)}#0` });
    const wrapper = render();
    await flushPromises();
    expect(byId(wrapper, 'sponsored').text()).toBe('Collateral provided by Gero');
  });

  it('shows no collateral line when Gero lends none', async () => {
    const wrapper = render();
    await flushPromises();
    expect(has(wrapper, 'sponsored')).toBe(false);
  });

  it('signs with the typed password only once there is one, and says the NFT is on its way back', async () => {
    const wrapper = render();
    await flushPromises();

    expect(byId(wrapper, 'confirm').attributes('disabled')).toBeDefined();
    await wrapper.get('[data-test="password"]').setValue('hunter2');
    await flushPromises();
    await byId(wrapper, 'confirm').trigger('click');
    await flushPromises();

    expect(flow.signAndSubmit).toHaveBeenCalledWith({ password: 'hunter2' });
    expect(byId(wrapper, 'done').text()).toContain('Your NFT and deposit are on their way back to your wallet.');
    expect(byId(wrapper, 'done').text()).toContain(TX_ID);
    await byId(wrapper, 'done-button').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('a wrong password stays on the review and says so', async () => {
    flow.signAndSubmit.mockImplementation(async () => {
      flow.failure.value = { code: 'WRONG_PASSWORD' };
      flow.stage.value = 'review';
      return false;
    });
    const wrapper = render();
    await flushPromises();
    await wrapper.get('[data-test="password"]').setValue('nope');
    await byId(wrapper, 'confirm').trigger('click');
    await flushPromises();

    expect(byId(wrapper, 'error').text()).toBe('Incorrect password. Please try again.');
    expect(has(wrapper, 'confirm')).toBe(true);
  });

  it('a PassKey wallet signs with its key and shows no password field', async () => {
    store.loggedWallet = { id: 1, chain: Blockchain.CARDANO, network: Network.PREPROD, type: 'Normal', encryptionMethod: 'prf' };
    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="password"]').exists()).toBe(false);
    await wrapper.get('[data-test="passkey"]').trigger('click');
    await flushPromises();
    expect(flow.signAndSubmit).toHaveBeenCalledTimes(1);
  });

  describe('a failure', () => {
    it('says the listing changed and offers a refresh, which asks the worker again', async () => {
      prepareFails('LISTING_NOT_FOUND');
      const wrapper = render();
      await flushPromises();

      expect(byId(wrapper, 'error').text()).toContain('This listing changed.');
      expect(has(wrapper, 'retry')).toBe(false);
      expect(has(wrapper, 'confirm')).toBe(false);

      prepareSucceeds();
      await byId(wrapper, 'refresh').trigger('click');
      await flushPromises();
      expect(flow.prepare).toHaveBeenCalledTimes(2);
      expect(has(wrapper, 'confirm')).toBe(true);
    });

    it('a failure building again can fix offers Try again', async () => {
      prepareFails('BUILD_FAILED');
      const wrapper = render();
      await flushPromises();

      expect(byId(wrapper, 'error').text()).toBe('We could not prepare this transaction. Try again.');
      expect(has(wrapper, 'refresh')).toBe(false);
      prepareSucceeds();
      await byId(wrapper, 'retry').trigger('click');
      await flushPromises();
      expect(flow.prepare).toHaveBeenCalledTimes(2);
      expect(flow.prepare).toHaveBeenLastCalledWith({ ref: LISTING_REF });
      expect(has(wrapper, 'confirm')).toBe(true);
    });

    it('a refusal that would fail the same way offers only Close', async () => {
      prepareFails('VERIFY_FAILED');
      const wrapper = render();
      await flushPromises();

      expect(byId(wrapper, 'error').text()).toBe('The wallet could not confirm this transaction.');
      expect(has(wrapper, 'retry')).toBe(false);
      expect(has(wrapper, 'refresh')).toBe(false);
      await byId(wrapper, 'close').trigger('click');
      expect(wrapper.emitted('close')).toHaveLength(1);
    });

    it('a submit that may have gone through never offers to build it again', async () => {
      flow.signAndSubmit.mockImplementation(async () => {
        flow.prepared.value = null;
        flow.failure.value = { code: 'SUBMIT_FAILED' };
        flow.stage.value = 'idle';
        return false;
      });
      const wrapper = render();
      await flushPromises();
      await wrapper.get('[data-test="password"]').setValue('hunter2');
      await byId(wrapper, 'confirm').trigger('click');
      await flushPromises();

      expect(byId(wrapper, 'error').text()).toBe('This may have been sent. Check your activity before you try again.');
      expect(has(wrapper, 'retry')).toBe(false);
      expect(has(wrapper, 'refresh')).toBe(false);
    });

    it('never shows a string from the worker or Nexus, only the copy for its code', async () => {
      prepareFails('SOMETHING_NEW_FROM_NEXUS');
      const wrapper = render();
      await flushPromises();
      expect(byId(wrapper, 'error').text()).toBe('We could not prepare this transaction. Try again.');
      expect(wrapper.text()).not.toContain('SOMETHING_NEW');
    });
  });

  describe('where it can run', () => {
    it('does nothing for a hardware wallet no device has signed a market transaction with', async () => {
      store.loggedWallet = { id: 1, chain: Blockchain.CARDANO, network: Network.PREPROD, type: 'Ledger' };
      const wrapper = render();
      await flushPromises();

      expect(has(wrapper, 'hardware')).toBe(true);
      expect(body(wrapper).text()).toContain('Coming soon for hardware wallets');
      expect(flow.prepare).not.toHaveBeenCalled();
    });

    it('lets a hardware wallet through once its type is listed', async () => {
      allowedHardware.types = ['Ledger'];
      store.loggedWallet = { id: 1, chain: Blockchain.CARDANO, network: Network.PREPROD, type: 'Ledger' };
      const wrapper = render();
      await flushPromises();
      expect(has(wrapper, 'hardware')).toBe(false);
      expect(flow.prepare).toHaveBeenCalledTimes(1);
    });

    it('closes when the wallet is switched: the listing was the last wallet\'s', async () => {
      const wrapper = render();
      await flushPromises();
      store.loggedWallet = { id: 2, chain: Blockchain.CARDANO, network: Network.PREPROD, type: 'Normal' };
      await flushPromises();
      expect(wrapper.emitted('close')).toBeTruthy();
    });
  });

  it('builds again, from a clean flow, each time it opens', async () => {
    const wrapper = render({ isOpen: false });
    expect(flow.prepare).not.toHaveBeenCalled();
    await wrapper.setProps({ isOpen: true });
    await flushPromises();
    await wrapper.setProps({ isOpen: false });
    await wrapper.setProps({ isOpen: true });
    await flushPromises();

    expect(flow.prepare).toHaveBeenCalledTimes(2);
    expect(flow.reset).toHaveBeenCalled();
  });
});
