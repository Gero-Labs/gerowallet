// The sheet that buys one NFT from Gero's market: the worker builds the purchase and verifies it
// (NFT_MARKET_PREPARE_BUY), the sheet shows what the worker verified (price, the seller's deposit
// that goes back to the seller, the network fee, the top-up and the total the wallet will lose),
// then signs and submits that exact transaction. The prepared-tx flow is replaced by refs and
// spies the test owns (useNftMarketFlow and usePreparedTxFlow have their own specs); what is
// checked here is what the sheet asks of it, in which state, and what it shows. The copy is the
// real English table, so a mistyped key shows up as a raw key in the assertions.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import type { Ref } from 'vue';
import { createTestVuetify } from '@test/helpers/vuetify';
import { Blockchain, Network } from '@/models/types';
import { listingRow, refOf } from '../utils/__fixtures__/listingFixtures';

const TX_CBOR = '84a400';
const TX_ID = 'ab'.repeat(32);
const ADA = 1_000_000n;

const LISTING = listingRow({ index: 7, priceAda: 120, assetName: 'Equine' });
const LISTING_REF = refOf(LISTING);
const REAL_POLICY = 'aa'.repeat(28);

/** What the worker verified for the buy. */
const SUMMARY = {
  txId: TX_ID,
  ref: LISTING_REF,
  unit: LISTING.unit,
  priceLovelace: (120n * ADA).toString(),
  feeLovelace: '1500000',
  royaltiesLovelace: '0',
  depositLovelace: '1550000',
  networkFeeLovelace: '312345',
  minUtxoTopUpLovelace: '0',
  totalOutflowLovelace: (120n * ADA + 312345n).toString(),
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
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('vue-router', () => ({ useRouter: () => router }));

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
    useNftMarketFlow: (action: 'buy') => {
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

import BuyNftDialog from './BuyNftDialog.vue';
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

function render(props: Record<string, unknown> = {}) {
  return mount(BuyNftDialog, {
    attachTo: document.body,
    props: { isOpen: true, listing: LISTING, ...props },
    global: { plugins: [createTestVuetify()], stubs: { ExplorerLink: true, CopyButton: true } },
  });
}

type Wrapper = ReturnType<typeof render>;
const byId = (wrapper: Wrapper, id: string) => wrapper.get(`[data-testid="buy-nft-${id}"]`);
const has = (wrapper: Wrapper, id: string) => wrapper.find(`[data-testid="buy-nft-${id}"]`).exists();

describe('BuyNftDialog', () => {
  beforeEach(() => {
    flow.reset();
    flow.keystone.keystoneShow.value = false;
    flow.action = undefined;
    flow.prepare.mockReset();
    flow.signAndSubmit.mockReset();
    flow.reset.mockClear();
    router.push.mockClear();
    store.loggedWallet = { id: 1, chain: Blockchain.CARDANO, network: Network.PREPROD, type: 'Normal' };
    allowedHardware.types = [];
    prepareSucceeds();
    signingSucceeds();
  });
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('asks the worker to buy that listing when it opens, naming nothing but the listing', async () => {
    const wrapper = render();
    await flushPromises();

    expect(flow.action).toBe('buy');
    expect(flow.prepare).toHaveBeenCalledTimes(1);
    expect(flow.prepare).toHaveBeenCalledWith({ ref: LISTING_REF });
    expect(wrapper.get('[data-test="dialog-title"]').text()).toBe('Buy this NFT');
  });

  describe('what the buyer is looking at', () => {
    it('shows the NFT\'s name and picture, and its whole policy ID, before the worker has answered', async () => {
      flow.prepare.mockImplementation(() => {
        flow.stage.value = 'preparing';
        return new Promise(() => {});
      });
      const wrapper = render();
      await flushPromises();

      expect(has(wrapper, 'preparing')).toBe(true);
      expect(wrapper.get('[data-testid="listing-nft-name"]').text()).toBe('Equine Pioneer 04601');
      expect(wrapper.findComponent({ name: 'VImg' }).props('src')).toBe('https://img.example/1.png');
      expect(byId(wrapper, 'policy').text()).toBe(`Policy ID${LISTING.policyId}`);
      expect(wrapper.get('[data-test="dialog-subtitle"]').text()).toBe('Review what you pay. The NFT goes to your wallet once the transaction is confirmed.');
      expect(wrapper.get('[data-test="dialog"]').attributes('data-persistent')).toBe('true');
    });

    it('takes the name and picture the collection page resolved, when it gives them', async () => {
      const wrapper = render({ name: 'Equine Pioneer #7', image: 'https://img.example/7.png' });
      await flushPromises();
      expect(wrapper.get('[data-testid="listing-nft-name"]').text()).toBe('Equine Pioneer #7');
      expect(wrapper.findComponent({ name: 'VImg' }).props('src')).toBe('https://img.example/7.png');
    });
  });

  describe('what the buyer pays, as the worker verified it', () => {
    it('shows the price, the network fee, the top-up and the total, each exactly as the summary has them', async () => {
      prepareSucceeds({ ...SUMMARY, minUtxoTopUpLovelace: '155080', networkFeeLovelace: '312345', totalOutflowLovelace: (120n * ADA + 312345n + 155080n).toString() });
      const wrapper = render();
      await flushPromises();

      const review = byId(wrapper, 'review');
      expect(review.text()).toContain('Your purchase');
      expect(byId(wrapper, 'price').text()).toBe('Price120 tADA');
      expect(byId(wrapper, 'network-fee').text()).toBe('Network Fee0.312345 tADA');
      expect(byId(wrapper, 'top-up').text()).toBe('Top-up to the network minimum0.15508 tADA');
      expect(byId(wrapper, 'total').text()).toBe('You pay in total120.467425 tADA');
    });

    it('takes the total from the summary and adds nothing up itself', async () => {
      // A total that is not price + fee + top-up: the worker's figure is what is shown.
      prepareSucceeds({ ...SUMMARY, totalOutflowLovelace: '987654321' });
      const wrapper = render();
      await flushPromises();
      expect(byId(wrapper, 'total').text()).toBe('You pay in total987.654321 tADA');
    });

    it('shows the price the worker verified, not the one the list showed', async () => {
      prepareSucceeds({ ...SUMMARY, priceLovelace: (150n * ADA).toString(), totalOutflowLovelace: (150n * ADA + 312345n).toString() });
      const wrapper = render();
      await flushPromises();
      expect(byId(wrapper, 'price').text()).toBe('Price150 tADA');
    });

    it('says the listing\'s deposit goes back to the seller and the buyer does not pay it, with the verified amount', async () => {
      prepareSucceeds({ ...SUMMARY, depositLovelace: '1620000' });
      const wrapper = render();
      await flushPromises();
      expect(byId(wrapper, 'deposit-note').text()).toBe('The seller\'s deposit of 1.62 tADA goes back to the seller. You do not pay it.');
    });

    it('says the NFT\'s own ADA stays the buyer\'s and is not in the total', async () => {
      const wrapper = render();
      await flushPromises();
      expect(byId(wrapper, 'nft-ada-note').text()).toBe('Your NFT arrives with the small amount of ADA the network requires. It stays yours and is not part of the total.');
    });

    it('explains a top-up only when there is one', async () => {
      const wrapper = render();
      await flushPromises();
      expect(byId(wrapper, 'top-up').text()).toBe('Top-up to the network minimum0 tADA');
      expect(has(wrapper, 'top-up-note')).toBe(false);

      prepareSucceeds({ ...SUMMARY, minUtxoTopUpLovelace: '155080', totalOutflowLovelace: (120n * ADA + 312345n + 155080n).toString() });
      const again = render();
      await flushPromises();
      expect(byId(again, 'top-up-note').text()).toContain('below the least the network allows for an output');
    });

    it('warns when the verified price is not the one the list showed', async () => {
      prepareSucceeds({ ...SUMMARY, priceLovelace: (150n * ADA).toString() });
      const wrapper = render();
      await flushPromises();
      expect(byId(wrapper, 'price-differs').text()).toBe('The price is 150 tADA, not the 120 tADA the list showed. Check it before you confirm.');
    });

    it('does not warn when they agree', async () => {
      const wrapper = render();
      await flushPromises();
      expect(has(wrapper, 'price-differs')).toBe(false);
    });

    it('shows that Gero lends the collateral when the summary says so, and nothing when it does not', async () => {
      prepareSucceeds({ ...SUMMARY, sponsoredCollateralRef: `${'ee'.repeat(32)}#0` });
      const wrapper = render();
      await flushPromises();
      expect(byId(wrapper, 'sponsored').text()).toBe('Collateral provided by Gero');

      prepareSucceeds();
      const plain = render();
      await flushPromises();
      expect(has(plain, 'sponsored')).toBe(false);
    });

    it('does not ask for a signature on a summary it cannot read or that is about another listing', async () => {
      const broken: Record<string, unknown>[] = [
        { ...SUMMARY, totalOutflowLovelace: 'lots' },
        { ...SUMMARY, priceLovelace: undefined },
        { ...SUMMARY, ref: `${'99'.repeat(32)}#0` },
        { ...SUMMARY, unit: `${'99'.repeat(28)}4e4654` },
      ];
      for (const summary of broken) {
        prepareSucceeds(summary);
        const wrapper = render();
        await flushPromises();
        expect(has(wrapper, 'confirm')).toBe(false);
        expect(has(wrapper, 'total')).toBe(false);
        expect(byId(wrapper, 'error').text()).toBe('We could not prepare this transaction. Try again.');
        expect(has(wrapper, 'retry')).toBe(true);
        wrapper.unmount();
      }
    });
  });

  describe('the lookalike warning', () => {
    const lookalike = { name: 'SpaceBudz', policyId: REAL_POLICY };

    it('is shown with the real collection\'s policy ID, next to this NFT\'s own', async () => {
      const wrapper = render({ lookalike });
      await flushPromises();
      expect(byId(wrapper, 'lookalike').text()).toBe(
        `This collection has the same name as SpaceBudz, a popular collection under a different policy ID (${REAL_POLICY}). Check the policy ID before you buy.`,
      );
      expect(byId(wrapper, 'policy').text()).toContain(LISTING.policyId);
    });

    it('can break inside the 56-character policy ID it names', async () => {
      const wrapper = render({ lookalike });
      await flushPromises();
      expect(byId(wrapper, 'lookalike').classes()).toContain('buy-nft__lookalike');
    });

    it('is shown on the review as well as while the worker builds', async () => {
      const wrapper = render({ lookalike });
      await flushPromises();
      expect(has(wrapper, 'review')).toBe(true);
      expect(has(wrapper, 'lookalike')).toBe(true);
    });

    it('is not shown without one', async () => {
      const wrapper = render();
      await flushPromises();
      expect(has(wrapper, 'lookalike')).toBe(false);
      expect(byId(wrapper, 'policy').text()).toContain(LISTING.policyId);
    });
  });

  describe('signing', () => {
    it('signs with the typed password only once there is one, and says the purchase is on its way', async () => {
      const wrapper = render();
      await flushPromises();

      expect(byId(wrapper, 'confirm').attributes('disabled')).toBeDefined();
      await wrapper.get('[data-test="password"]').setValue('hunter2');
      await flushPromises();
      await byId(wrapper, 'confirm').trigger('click');
      await flushPromises();

      expect(flow.signAndSubmit).toHaveBeenCalledWith({ password: 'hunter2' });
      expect(byId(wrapper, 'done').text()).toContain('Your purchase is on its way. The NFT shows in your wallet once the transaction is confirmed.');
      expect(byId(wrapper, 'done').text()).toContain(TX_ID);
      expect(wrapper.emitted('sent')).toEqual([[LISTING_REF]]);
      // The explorer link is a button of the house kind, not a bare Vuetify one.
      expect(byId(wrapper, 'explorer').classes()).toContain('g-btn');
      expect(byId(wrapper, 'explorer').attributes('href')).toBe(`https://explorer.example/${TX_ID}`);
      await byId(wrapper, 'done-button').trigger('click');
      expect(wrapper.emitted('close')).toHaveLength(1);
      // A purchase that went out is not a changed listing: nothing to reload.
      expect(wrapper.emitted('refresh')).toBeUndefined();
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
      expect(wrapper.emitted('sent')).toBeUndefined();
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
  });

  describe('a failure', () => {
    it('a listing that was bought or moved says so and offers Refresh, which asks the page to reload the list instead of building again', async () => {
      prepareFails('LISTING_NOT_FOUND');
      const wrapper = render();
      await flushPromises();

      expect(byId(wrapper, 'error').text()).toContain('This listing changed.');
      expect(has(wrapper, 'retry')).toBe(false);
      expect(has(wrapper, 'confirm')).toBe(false);

      await byId(wrapper, 'refresh').trigger('click');
      expect(flow.prepare).toHaveBeenCalledTimes(1);
      expect(wrapper.emitted('refresh')).toHaveLength(1);
      expect(wrapper.emitted('close')).toHaveLength(1);
    });

    it('tells the page to reload its list when a sheet that said the listing changed is closed, by Close or by the X, so the sold row loses its Buy', async () => {
      prepareFails('LISTING_NOT_FOUND');
      const byClose = render();
      await flushPromises();
      await byId(byClose, 'close').trigger('click');
      expect(byClose.emitted('refresh')).toHaveLength(1);
      expect(byClose.emitted('close')).toHaveLength(1);
      byClose.unmount();

      const byX = render();
      await flushPromises();
      await byX.get('[data-test="dialog-close"]').trigger('click');
      expect(byX.emitted('refresh')).toHaveLength(1);
      expect(byX.emitted('close')).toHaveLength(1);
    });

    it('does so for a listing spent between the review and the signature as well', async () => {
      flow.signAndSubmit.mockImplementation(async () => {
        flow.prepared.value = null;
        flow.failure.value = { code: 'INPUT_SPENT' };
        flow.stage.value = 'idle';
        return false;
      });
      const wrapper = render();
      await flushPromises();
      await wrapper.get('[data-test="password"]').setValue('hunter2');
      await byId(wrapper, 'confirm').trigger('click');
      await flushPromises();
      await byId(wrapper, 'close').trigger('click');
      expect(wrapper.emitted('refresh')).toHaveLength(1);
    });

    it('asks for no reload when the sheet is closed for any other reason', async () => {
      // A failure that is not a changed listing.
      for (const code of ['BUILD_FAILED', 'VERIFY_FAILED', 'PRIVATE_LISTING']) {
        prepareFails(code);
        const wrapper = render();
        await flushPromises();
        await byId(wrapper, 'close').trigger('click');
        expect(wrapper.emitted('refresh'), code).toBeUndefined();
        wrapper.unmount();
      }
      // The review, cancelled.
      prepareSucceeds();
      const review = render();
      await flushPromises();
      await byId(review, 'cancel').trigger('click');
      expect(review.emitted('refresh')).toBeUndefined();
      expect(review.emitted('close')).toHaveLength(1);
    });

    it('a listing spent between the review and the signature reads as sold or delisted, with Refresh', async () => {
      flow.signAndSubmit.mockImplementation(async () => {
        flow.prepared.value = null;
        flow.failure.value = { code: 'INPUT_SPENT' };
        flow.stage.value = 'idle';
        return false;
      });
      const wrapper = render();
      await flushPromises();
      await wrapper.get('[data-test="password"]').setValue('hunter2');
      await byId(wrapper, 'confirm').trigger('click');
      await flushPromises();

      expect(byId(wrapper, 'error').text()).toContain('This NFT was just bought or delisted.');
      expect(has(wrapper, 'refresh')).toBe(true);
      expect(has(wrapper, 'retry')).toBe(false);
    });

    it('a failure building again can fix offers Try again, which prepares the same listing', async () => {
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
      for (const code of ['VERIFY_FAILED', 'PRIVATE_LISTING', 'OWN_LISTING', 'INSUFFICIENT_ADA']) {
        prepareFails(code);
        const wrapper = render();
        await flushPromises();

        expect(has(wrapper, 'retry'), code).toBe(false);
        expect(has(wrapper, 'refresh'), code).toBe(false);
        expect(has(wrapper, 'confirm'), code).toBe(false);
        await byId(wrapper, 'close').trigger('click');
        expect(wrapper.emitted('close'), code).toHaveLength(1);
        wrapper.unmount();
      }
    });

    it('a submit that may have gone through points to Activity, never offers to build it again, and tells the page to lock the listing', async () => {
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
      expect(flow.prepare).toHaveBeenCalledTimes(1);
      expect(wrapper.emitted('sent')).toEqual([[LISTING_REF]]);

      // View activity opens the wallet's activity; it never builds or sends anything again.
      expect(byId(wrapper, 'activity').text()).toBe('View activity');
      flow.prepare.mockClear();
      flow.signAndSubmit.mockClear();
      await byId(wrapper, 'activity').trigger('click');
      expect(router.push).toHaveBeenCalledWith({ path: '/transactions' });
      expect(wrapper.emitted('close')).toHaveLength(1);
      expect(flow.prepare).not.toHaveBeenCalled();
      expect(flow.signAndSubmit).not.toHaveBeenCalled();
    });

    it('offers View activity for a submit that may have gone through, and for nothing else', async () => {
      for (const code of ['BUILD_FAILED', 'LISTING_NOT_FOUND', 'VERIFY_FAILED', 'PRIVATE_LISTING']) {
        prepareFails(code);
        const wrapper = render();
        await flushPromises();
        expect(has(wrapper, 'activity'), code).toBe(false);
        wrapper.unmount();
      }
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
      expect(wrapper.text()).toContain('Coming soon for hardware wallets');
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

    it('closes when the wallet is switched: the purchase was built for the last one', async () => {
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
