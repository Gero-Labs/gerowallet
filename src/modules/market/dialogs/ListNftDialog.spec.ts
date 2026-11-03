// The sheet that lists an NFT for sale, and (given `existing`) changes the price of a listing the
// wallet already has. The seller types a price; the sheet shows how it splits (Gero's fee, each
// creator royalty, what the seller keeps) and refuses what the worker would refuse, then the
// worker builds and verifies the transaction and the sheet shows ITS figures for the signature.
// The prepared-tx flow is replaced by refs and spies the test owns (useNftMarketFlow and
// usePreparedTxFlow have their own specs); what is checked here is what the sheet asks of it, in
// which state, and what it shows. The copy is the real English table, so a mistyped key shows up
// as a raw key in the assertions.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import type { Ref } from 'vue';
import { createTestVuetify } from '@test/helpers/vuetify';
import type { RoyaltyInfo } from '@/api/nft-market-api';
import type { OwnListing } from '@/chrome/nftMarket/ownListings';
import { Blockchain, Network } from '@/models/types';

const TX_CBOR = '84a400';
const TX_ID = 'ab'.repeat(32);
const POLICY = 'cd'.repeat(28);
const UNIT = `${POLICY}4e4654`;
const LISTING_REF = `${'11'.repeat(32)}#0`;
const CREATOR_A = `addr_test1qz${'a'.repeat(40)}ac4f9d2e`;
const CREATOR_B = `addr_test1qz${'b'.repeat(40)}b7e6a1c3`;
const SHORT_A = 'addr_test1qzaaa…ac4f9d2e';
const ADA = 1_000_000n;

const FIVE_PERCENT: RoyaltyInfo = { source: 'cip27', rate: 0.05, recipients: [{ address: CREATOR_A, rate: 0.05, minFeeLovelace: null, maxFeeLovelace: null }] };
const TWELVE_PERCENT: RoyaltyInfo = { source: 'cip27', rate: 0.12, recipients: [{ address: CREATOR_A, rate: 0.12, minFeeLovelace: null, maxFeeLovelace: null }] };
const NO_ROYALTIES: RoyaltyInfo = { source: 'none', rate: 0, recipients: [] };

const EXISTING: OwnListing = {
  ref: LISTING_REF,
  unit: UNIT,
  datum: {
    owner: 'aa'.repeat(28),
    sellerAddress: 'addr_test1seller',
    price: 120n * ADA,
    royalties: [{ address: CREATOR_A, lovelace: 6n * ADA }],
    buyer: null,
  },
  depositLovelace: '1550000',
  deploymentVersion: 1,
};

/** What the worker verified for a list at 100 ADA with a 5% royalty. */
const LIST_SUMMARY = {
  txId: TX_ID,
  unit: UNIT,
  listingAddress: 'addr_test1listing',
  listingOutputIndex: 0,
  deploymentVersion: 1,
  priceLovelace: '100000000',
  marketFeeLovelace: '1500000',
  royaltiesLovelace: '5000000',
  sellerReceivesLovelace: '93500000',
  depositLovelace: '1550000',
  networkFeeLovelace: '213445',
  royalties: [{ address: CREATOR_A, lovelace: '5000000' }],
  dropped: [] as { address: string; lovelace: string }[],
  invalidRecipients: 0,
};
const REPRICE_SUMMARY = {
  txId: TX_ID,
  ref: LISTING_REF,
  unit: UNIT,
  oldPriceLovelace: '120000000',
  listingAddress: 'addr_test1listing',
  listingOutputIndex: 0,
  deploymentVersion: 1,
  priceLovelace: '90000000',
  marketFeeLovelace: '1500000',
  royaltiesLovelace: '6000000',
  sellerReceivesLovelace: '82500000',
  depositLovelace: '1550000',
  networkFeeLovelace: '350000',
};

type FlowStage = 'idle' | 'preparing' | 'review' | 'signing' | 'submitting' | 'done';
const flow = vi.hoisted(
  () =>
    ({}) as {
      stage: Ref<FlowStage>;
      prepared: Ref<{ txCbor: string; txId: string; summary: Record<string, unknown> } | null>;
      failure: Ref<{ code: string } | null>;
      submittedTxId: Ref<string | null>;
      royaltyConfirmation: Ref<{ ada: string; percent: string } | null>;
      prepare: Mock<(payload: Record<string, unknown>) => Promise<boolean>>;
      signAndSubmit: Mock<(credentials?: { password?: string }) => Promise<boolean>>;
      reset: Mock<() => void>;
      keystone: { keystoneShow: Ref<boolean> };
      action: string | undefined;
    },
);
const info = vi.hoisted(
  () =>
    ({}) as {
      royalties: Ref<unknown>;
      royaltiesState: Ref<'idle' | 'loading' | 'ready' | 'failed'>;
      floorLovelace: Ref<bigint | null>;
      lastSaleLovelace: Ref<bigint | null>;
      load: Mock<() => Promise<void>>;
      reset: Mock<() => void>;
      options: { royalties: boolean } | undefined;
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
  flow.royaltyConfirmation = ref(null);
  flow.keystone = { keystoneShow: ref(false) };
  flow.prepare = vi.fn<(payload: Record<string, unknown>) => Promise<boolean>>();
  flow.signAndSubmit = vi.fn<(credentials?: { password?: string }) => Promise<boolean>>();
  flow.reset = vi.fn<() => void>(() => {
    flow.stage.value = 'idle';
    flow.prepared.value = null;
    flow.failure.value = null;
    flow.submittedTxId.value = null;
    flow.royaltyConfirmation.value = null;
  });
  return {
    ...actual,
    useNftMarketFlow: (action: 'list' | 'reprice') => {
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
        royaltyConfirmation: computed(() => flow.royaltyConfirmation.value),
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
vi.mock('@/modules/market/composables/useListingMarketInfo', async () => {
  const { ref } = await import('vue');
  info.royalties = ref(null);
  info.royaltiesState = ref('idle');
  info.floorLovelace = ref(null);
  info.lastSaleLovelace = ref(null);
  info.load = vi.fn<() => Promise<void>>(() => Promise.resolve());
  info.reset = vi.fn<() => void>();
  return {
    useListingMarketInfo: (_unit: () => string, options: { royalties: boolean }) => {
      info.options = options;
      return {
        royalties: info.royalties,
        royaltiesState: info.royaltiesState,
        floorLovelace: info.floorLovelace,
        lastSaleLovelace: info.lastSaleLovelace,
        load: info.load,
        reset: info.reset,
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

import ListNftDialog from './ListNftDialog.vue';
import { walletStore } from '@/stores/walletStore';

enableAutoUnmount(afterEach);

const store = walletStore as unknown as typeof walletState;

function prepareSucceeds(summary: Record<string, unknown> = LIST_SUMMARY) {
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

function render(props: { isOpen?: boolean; unit?: string; existing?: OwnListing } = {}) {
  return mount(ListNftDialog, {
    attachTo: document.body,
    props: { isOpen: true, unit: UNIT, ...props },
    global: { plugins: [createTestVuetify()] },
  });
}

type Wrapper = ReturnType<typeof render>;
const body = (wrapper: Wrapper) => wrapper.get('[data-testid="list-nft"]');
const byId = (wrapper: Wrapper, id: string) => wrapper.get(`[data-testid="list-nft-${id}"]`);
const has = (wrapper: Wrapper, id: string) => wrapper.find(`[data-testid="list-nft-${id}"]`).exists();
const priceInput = (wrapper: Wrapper) => wrapper.get('[data-testid="list-nft-price"] input');

async function typePrice(wrapper: Wrapper, text: string) {
  await priceInput(wrapper).setValue(text);
  await flushPromises();
}

/** The royalty terms the sheet reads have arrived. */
function royaltiesAre(terms: RoyaltyInfo) {
  info.royalties.value = terms;
  info.royaltiesState.value = 'ready';
}

describe('ListNftDialog: a new listing', () => {
  beforeEach(() => {
    flow.reset();
    flow.keystone.keystoneShow.value = false;
    flow.action = undefined;
    flow.prepare.mockReset();
    flow.signAndSubmit.mockReset();
    flow.reset.mockClear();
    info.load.mockClear();
    info.reset.mockClear();
    info.floorLovelace.value = null;
    info.lastSaleLovelace.value = null;
    royaltiesAre(FIVE_PERCENT);
    store.loggedWallet = { id: 1, chain: Blockchain.CARDANO, network: Network.PREPROD, type: 'Normal' };
    allowedHardware.types = [];
    prepareSucceeds();
    signingSucceeds();
  });
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('opens on the price: the NFT, no worker call yet, and the royalty terms asked for', async () => {
    const wrapper = render();
    await flushPromises();

    expect(flow.action).toBe('list');
    expect(info.options).toEqual({ royalties: true });
    expect(info.load).toHaveBeenCalled();
    expect(wrapper.get('[data-test="dialog-title"]').text()).toBe('List for sale');
    expect(wrapper.get('[data-testid="listing-nft-name"]').text()).toBe('Equine Pioneer 04601');
    expect(body(wrapper).text()).toContain('Equine Pioneer 04601');
    expect(flow.prepare).not.toHaveBeenCalled();
    expect(byId(wrapper, 'continue').attributes('disabled')).toBeDefined();
  });

  describe('the breakdown', () => {
    it('100 ADA with a 5% royalty: fee 1.5, royalty 5, you receive 93.5', async () => {
      const wrapper = render();
      await typePrice(wrapper, '100');

      const breakdown = wrapper.get('[data-testid="listing-breakdown"]');
      expect(breakdown.get('[data-testid="breakdown-price"]').text()).toBe('Price100 ADA');
      expect(breakdown.get('[data-testid="breakdown-fee"]').text()).toBe('Gero fee1.5 ADA');
      expect(breakdown.get('[data-testid="breakdown-royalty"]').text()).toBe(`Royalty to ${SHORT_A}5 ADA`);
      expect(breakdown.get('[data-testid="breakdown-royalties-total"]').text()).toBe('Royalties, 5% of the price5 ADA');
      expect(breakdown.get('[data-testid="breakdown-receive"]').text()).toBe('You receive93.5 ADA');
      expect(byId(wrapper, 'continue').attributes('disabled')).toBeUndefined();
    });

    it('follows the price as it is typed, to the lovelace', async () => {
      const wrapper = render();
      await typePrice(wrapper, '4.35');
      expect(wrapper.get('[data-testid="breakdown-price"]').text()).toBe('Price4.35 ADA');
      await typePrice(wrapper, '600');
      // The fee is capped at 5 ADA.
      expect(wrapper.get('[data-testid="breakdown-fee"]').text()).toBe('Gero fee5 ADA');
      expect(wrapper.get('[data-testid="breakdown-royalties-total"]').text()).toBe('Royalties, 5% of the price30 ADA');
      expect(wrapper.get('[data-testid="breakdown-receive"]').text()).toBe('You receive565 ADA');
    });

    it('has no royalty rows for a collection without royalties, and the seller keeps price minus the fee', async () => {
      royaltiesAre(NO_ROYALTIES);
      const wrapper = render();
      await typePrice(wrapper, '100');
      expect(wrapper.find('[data-testid="breakdown-royalty"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="breakdown-royalties-total"]').exists()).toBe(false);
      expect(wrapper.get('[data-testid="breakdown-receive"]').text()).toBe('You receive98.5 ADA');
      expect(byId(wrapper, 'continue').attributes('disabled')).toBeUndefined();
    });

    it('shows nothing until a price is typed', async () => {
      const wrapper = render();
      await flushPromises();
      expect(wrapper.find('[data-testid="listing-breakdown"]').exists()).toBe(false);
    });

    it('tells the seller about a royalty too small to pay and one beyond the recipient limit', async () => {
      royaltiesAre({
        source: 'cip27',
        rate: 0.1405,
        recipients: [
          { address: CREATOR_A, rate: 0.04, minFeeLovelace: null, maxFeeLovelace: null },
          { address: CREATOR_B, rate: 0.0005, minFeeLovelace: null, maxFeeLovelace: null },
          { address: 'addr_test1c', rate: 0.03, minFeeLovelace: null, maxFeeLovelace: null },
          { address: 'addr_test1d', rate: 0.03, minFeeLovelace: null, maxFeeLovelace: null },
          { address: 'addr_test1e', rate: 0.04, minFeeLovelace: null, maxFeeLovelace: null },
        ],
      });
      const wrapper = render();
      await typePrice(wrapper, '1000');
      // 0.05% of 1000 ADA is 0.5 ADA, under min-UTxO; the four others fight for three places.
      expect(wrapper.findAll('[data-testid="breakdown-dropped-small"]')).toHaveLength(1);
      expect(wrapper.findAll('[data-testid="breakdown-dropped-many"]')).toHaveLength(1);
    });
  });

  describe('the price', () => {
    it('refuses 4 ADA: Confirm stays off and the sheet says why', async () => {
      const wrapper = render();
      await typePrice(wrapper, '4');

      expect(byId(wrapper, 'continue').attributes('disabled')).toBeDefined();
      expect(body(wrapper).text()).toContain('The price is too low. The minimum is 5 ADA.');
      await byId(wrapper, 'continue').trigger('click');
      expect(flow.prepare).not.toHaveBeenCalled();
    });

    it('accepts exactly 5 ADA', async () => {
      const wrapper = render();
      await typePrice(wrapper, '5');
      expect(byId(wrapper, 'continue').attributes('disabled')).toBeUndefined();
      expect(body(wrapper).text()).not.toContain('too low');
    });

    it('refuses what is not a price, in plain words', async () => {
      const wrapper = render();
      for (const text of ['abc', '1e3', '-5', '1.0000001']) {
        await typePrice(wrapper, text);
        expect(body(wrapper).text(), text).toContain('Enter a price in ADA with up to 6 decimals.');
        expect(byId(wrapper, 'continue').attributes('disabled'), text).toBeDefined();
      }
    });

    it('refuses a price above the whole ADA supply', async () => {
      const wrapper = render();
      await typePrice(wrapper, '45000000001');
      expect(body(wrapper).text()).toContain('The price is too high. The most you can ask is 45,000,000,000 ADA.');
      expect(byId(wrapper, 'continue').attributes('disabled')).toBeDefined();
    });

    it('refuses a price that leaves the seller under 1.5 ADA after the fee and royalties', async () => {
      royaltiesAre({ source: 'cip27', rate: 0.5, recipients: [{ address: CREATOR_A, rate: 0.5, minFeeLovelace: null, maxFeeLovelace: null }] });
      const wrapper = render();
      await typePrice(wrapper, '5');
      expect(body(wrapper).text()).toContain('After the market fee and royalties you would receive less than 1.5 ADA. Raise the price.');
      expect(byId(wrapper, 'continue').attributes('disabled')).toBeDefined();
    });

    it('asks the worker with the exact lovelace amount as a bigint, and nothing else about the listing', async () => {
      const wrapper = render();
      await typePrice(wrapper, '100.5');
      await byId(wrapper, 'continue').trigger('click');
      await flushPromises();

      expect(flow.prepare).toHaveBeenCalledTimes(1);
      expect(flow.prepare).toHaveBeenCalledWith({ unit: UNIT, priceLovelace: 100_500_000n });
    });

    it('reads a comma as the decimal separator', async () => {
      const wrapper = render();
      await typePrice(wrapper, '12,5');
      await byId(wrapper, 'continue').trigger('click');
      await flushPromises();
      expect(flow.prepare).toHaveBeenCalledWith({ unit: UNIT, priceLovelace: 12_500_000n });
    });
  });

  describe('the collection\'s royalty terms', () => {
    it('waits for them: no price is judged and nothing can be continued while they load', async () => {
      info.royalties.value = null;
      info.royaltiesState.value = 'loading';
      const wrapper = render();
      await typePrice(wrapper, '100');

      expect(body(wrapper).text()).toContain('Reading the royalty terms of this collection');
      expect(wrapper.find('[data-testid="listing-breakdown"]').exists()).toBe(false);
      expect(byId(wrapper, 'continue').attributes('disabled')).toBeDefined();
    });

    it('never lists without them: a failed read says so and offers to read them again', async () => {
      info.royalties.value = null;
      info.royaltiesState.value = 'failed';
      const wrapper = render();
      await typePrice(wrapper, '100');

      expect(body(wrapper).text()).toContain('We could not read the royalty terms of this collection. Try again.');
      expect(byId(wrapper, 'continue').attributes('disabled')).toBeDefined();
      info.load.mockClear();
      await byId(wrapper, 'royalties-retry').trigger('click');
      expect(info.load).toHaveBeenCalledTimes(1);
    });

    it('refuses a collection whose terms contradict themselves', async () => {
      royaltiesAre({ source: 'cip27', rate: 2, recipients: [{ address: CREATOR_A, rate: 2, minFeeLovelace: null, maxFeeLovelace: null }] });
      const wrapper = render();
      await typePrice(wrapper, '100');
      expect(body(wrapper).text()).toContain('The royalty terms of this collection are not valid, so it cannot be listed here.');
      expect(byId(wrapper, 'continue').attributes('disabled')).toBeDefined();
    });
  });

  describe('royalties above the usual 10%', () => {
    beforeEach(() => royaltiesAre(TWELVE_PERCENT));

    it('shows the effective amount and share, and keeps Confirm off until the seller agrees', async () => {
      const wrapper = render();
      await typePrice(wrapper, '100');

      const checkbox = byId(wrapper, 'royalty-confirm');
      expect(checkbox.text()).toContain('I agree to pay 12 ADA in royalties, 12% of the price');
      expect(body(wrapper).text()).toContain('This collection takes more in royalties than usual. Check the amounts before you confirm.');
      expect(byId(wrapper, 'continue').attributes('disabled')).toBeDefined();
      await byId(wrapper, 'continue').trigger('click');
      expect(flow.prepare).not.toHaveBeenCalled();
    });

    it('lets the seller continue once they agree, and tells the worker so', async () => {
      const wrapper = render();
      await typePrice(wrapper, '100');
      await wrapper.get('[data-testid="list-nft-royalty-confirm"] input').setValue(true);
      await flushPromises();

      expect(byId(wrapper, 'continue').attributes('disabled')).toBeUndefined();
      await byId(wrapper, 'continue').trigger('click');
      await flushPromises();
      expect(flow.prepare).toHaveBeenCalledWith({ unit: UNIT, priceLovelace: 100n * ADA, confirmRoyaltyAboveCap: true });
    });

    it('asks again when the price changes: the agreement was to those amounts', async () => {
      const wrapper = render();
      await typePrice(wrapper, '100');
      await wrapper.get('[data-testid="list-nft-royalty-confirm"] input').setValue(true);
      await flushPromises();
      await typePrice(wrapper, '200');

      expect(byId(wrapper, 'continue').attributes('disabled')).toBeDefined();
      expect(byId(wrapper, 'royalty-confirm').text()).toContain('24 ADA in royalties');
    });

    it('is judged on the effective amount: a 1% royalty with a 15 ADA minimum on 100 ADA is 15%', async () => {
      royaltiesAre({ source: 'cip102', rate: 0.01, recipients: [{ address: CREATOR_A, rate: 0.01, minFeeLovelace: 15n * ADA, maxFeeLovelace: null }] });
      const wrapper = render();
      await typePrice(wrapper, '100');
      expect(byId(wrapper, 'royalty-confirm').text()).toContain('I agree to pay 15 ADA in royalties, 15% of the price');
    });

    it('does not ask at exactly 10%', async () => {
      royaltiesAre({ source: 'cip27', rate: 0.1, recipients: [{ address: CREATOR_A, rate: 0.1, minFeeLovelace: null, maxFeeLovelace: null }] });
      const wrapper = render();
      await typePrice(wrapper, '100');
      expect(has(wrapper, 'royalty-confirm')).toBe(false);
      expect(byId(wrapper, 'continue').attributes('disabled')).toBeUndefined();
    });

    it('shows what the worker says when it asks for the confirmation itself, at its own amounts', async () => {
      royaltiesAre(FIVE_PERCENT);
      const wrapper = render();
      await typePrice(wrapper, '100');
      flow.prepare.mockImplementation(async () => {
        flow.failure.value = { code: 'ROYALTY_CONFIRMATION_REQUIRED' };
        flow.royaltyConfirmation.value = { ada: '12.5', percent: '12.5' };
        flow.stage.value = 'idle';
        return false;
      });
      await byId(wrapper, 'continue').trigger('click');
      await flushPromises();

      // Back on the price, with the checkbox and the worker's figures: no error screen.
      expect(has(wrapper, 'error')).toBe(false);
      expect(byId(wrapper, 'royalty-confirm').text()).toContain('I agree to pay 12.5 ADA in royalties, 12.5% of the price');
      expect(byId(wrapper, 'continue').attributes('disabled')).toBeDefined();
    });
  });

  it('forgets the worker\'s confirmation request when the price changes: it was about the last price', async () => {
    royaltiesAre(FIVE_PERCENT);
    const wrapper = render();
    await typePrice(wrapper, '100');
    flow.prepare.mockImplementation(async () => {
      flow.failure.value = { code: 'ROYALTY_CONFIRMATION_REQUIRED' };
      flow.royaltyConfirmation.value = { ada: '12.5', percent: '12.5' };
      flow.stage.value = 'idle';
      return false;
    });
    await byId(wrapper, 'continue').trigger('click');
    await flushPromises();
    expect(has(wrapper, 'royalty-confirm')).toBe(true);

    flow.reset.mockClear();
    await typePrice(wrapper, '120');
    expect(flow.reset).toHaveBeenCalled();
    // At 5% the preview needs no confirmation: the checkbox goes with the worker's request.
    expect(has(wrapper, 'royalty-confirm')).toBe(false);
    expect(byId(wrapper, 'continue').attributes('disabled')).toBeUndefined();
  });

  describe('floor and last sale', () => {
    it('shows both beside the price when the feed has them', async () => {
      info.floorLovelace.value = 120n * ADA;
      info.lastSaleLovelace.value = 150_500_000n;
      const wrapper = render();
      await flushPromises();
      expect(byId(wrapper, 'floor').text()).toBe('Floor120 ADA');
      expect(byId(wrapper, 'last-sale').text()).toBe('Last Sale150.5 ADA');
    });

    it('leaves out the one it does not have', async () => {
      info.floorLovelace.value = 120n * ADA;
      const wrapper = render();
      await flushPromises();
      expect(has(wrapper, 'floor')).toBe(true);
      expect(has(wrapper, 'last-sale')).toBe(false);
    });

    it('shows neither on a test network, where there is no feed', async () => {
      const wrapper = render();
      await flushPromises();
      expect(has(wrapper, 'floor')).toBe(false);
      expect(has(wrapper, 'last-sale')).toBe(false);
    });
  });

  describe('the review of what the worker verified', () => {
    async function toReview(wrapper: Wrapper, price = '100') {
      await typePrice(wrapper, price);
      await byId(wrapper, 'continue').trigger('click');
      await flushPromises();
    }

    it('shows the worker\'s figures, not the preview\'s: price, fee, royalty, what you receive, the deposit and the network fee', async () => {
      // The worker's answer differs from the preview on purpose.
      prepareSucceeds({ ...LIST_SUMMARY, sellerReceivesLovelace: '93400000', depositLovelace: '1620000', networkFeeLovelace: '170000' });
      const wrapper = render();
      await toReview(wrapper);

      const review = byId(wrapper, 'review');
      expect(review.text()).toContain('Your listing');
      expect(review.get('[data-testid="breakdown-price"]').text()).toBe('Price100 ADA');
      expect(review.get('[data-testid="breakdown-fee"]').text()).toBe('Gero fee1.5 ADA');
      expect(review.get('[data-testid="breakdown-royalty"]').text()).toBe(`Royalty to ${SHORT_A}5 ADA`);
      expect(review.get('[data-testid="breakdown-receive"]').text()).toBe('You receive93.4 ADA');
      expect(review.get('[data-testid="breakdown-deposit"]').text()).toBe('Your deposit, returned to you1.62 ADA');
      expect(review.get('[data-testid="breakdown-network-fee"]').text()).toBe('Network Fee0.17 ADA');
      expect(has(wrapper, 'confirm')).toBe(true);
    });

    it('says what the worker left out, from its own notes', async () => {
      prepareSucceeds({ ...LIST_SUMMARY, dropped: [{ address: CREATOR_B, lovelace: '500000' }], invalidRecipients: 1 });
      const wrapper = render();
      await toReview(wrapper);
      expect(wrapper.findAll('[data-testid="breakdown-dropped-small"]')).toHaveLength(1);
      expect(wrapper.get('[data-testid="breakdown-invalid"]').text()).toBe('1 royalty recipient has no valid address and is left out.');
    });

    it('waits while the worker builds, and nothing may close the sheet', async () => {
      flow.prepare.mockImplementation(() => {
        flow.stage.value = 'preparing';
        return new Promise(() => {});
      });
      const wrapper = render();
      await toReview(wrapper);
      expect(has(wrapper, 'preparing')).toBe(true);
      expect(wrapper.get('[data-test="dialog"]').attributes('data-persistent')).toBe('true');
    });

    it('signs with the typed password only once there is one', async () => {
      const wrapper = render();
      await toReview(wrapper);

      expect(byId(wrapper, 'confirm').attributes('disabled')).toBeDefined();
      await wrapper.get('[data-test="password"]').setValue('hunter2');
      await flushPromises();
      expect(byId(wrapper, 'confirm').attributes('disabled')).toBeUndefined();
      await byId(wrapper, 'confirm').trigger('click');
      await flushPromises();

      expect(flow.signAndSubmit).toHaveBeenCalledWith({ password: 'hunter2' });
      expect(has(wrapper, 'done')).toBe(true);
      expect(byId(wrapper, 'done').text()).toContain('Your NFT is being listed.');
      expect(byId(wrapper, 'done').text()).toContain(TX_ID);
    });

    it('goes back to the price with what was typed, and the password gone', async () => {
      const wrapper = render();
      await toReview(wrapper, '100.5');
      await wrapper.get('[data-test="password"]').setValue('hunter2');
      await byId(wrapper, 'back').trigger('click');
      await flushPromises();

      expect(flow.reset).toHaveBeenCalled();
      expect((priceInput(wrapper).element as HTMLInputElement).value).toBe('100.5');
      expect(has(wrapper, 'confirm')).toBe(false);
    });

    it('a wrong password stays on the review and says so', async () => {
      flow.signAndSubmit.mockImplementation(async () => {
        flow.failure.value = { code: 'WRONG_PASSWORD' };
        flow.stage.value = 'review';
        return false;
      });
      const wrapper = render();
      await toReview(wrapper);
      await wrapper.get('[data-test="password"]').setValue('nope');
      await byId(wrapper, 'confirm').trigger('click');
      await flushPromises();

      expect(byId(wrapper, 'error').text()).toBe('Incorrect password. Please try again.');
      expect(has(wrapper, 'confirm')).toBe(true);
    });

    it('a PassKey wallet signs with its key and shows no password field', async () => {
      store.loggedWallet = { id: 1, chain: Blockchain.CARDANO, network: Network.PREPROD, type: 'Normal', encryptionMethod: 'prf' };
      const wrapper = render();
      await toReview(wrapper);

      expect(wrapper.find('[data-test="password"]').exists()).toBe(false);
      await wrapper.get('[data-test="passkey"]').trigger('click');
      await flushPromises();
      expect(flow.signAndSubmit).toHaveBeenCalledTimes(1);
    });

    it('shows that Gero lends the collateral when the summary says so', async () => {
      prepareSucceeds({ ...REPRICE_SUMMARY, sponsoredCollateralRef: `${'ee'.repeat(32)}#0` });
      const wrapper = render({ existing: EXISTING });
      await typePrice(wrapper, '90');
      await byId(wrapper, 'continue').trigger('click');
      await flushPromises();
      expect(byId(wrapper, 'sponsored').text()).toBe('Collateral provided by Gero');
    });
  });

  describe('a failure', () => {
    async function failWith(code: string) {
      prepareFails(code);
      const wrapper = render();
      await typePrice(wrapper, '100');
      await byId(wrapper, 'continue').trigger('click');
      await flushPromises();
      return wrapper;
    }

    it('LISTING_NOT_FOUND-style changes say so and offer a refresh, which starts again', async () => {
      const wrapper = await failWith('NFT_NOT_FOUND');
      expect(byId(wrapper, 'error').text()).toBe('This NFT is not in your wallet any more. Refresh and try again.');
      expect(has(wrapper, 'retry')).toBe(false);

      await byId(wrapper, 'refresh').trigger('click');
      await flushPromises();
      expect(flow.reset).toHaveBeenCalled();
      expect(has(wrapper, 'error')).toBe(false);
      expect((priceInput(wrapper).element as HTMLInputElement).value).toBe('100');
    });

    it('a failure building again can fix offers Try again, which asks the worker once more with the same price', async () => {
      const wrapper = await failWith('BUILD_FAILED');
      expect(byId(wrapper, 'error').text()).toBe('We could not prepare this transaction. Try again.');
      expect(has(wrapper, 'refresh')).toBe(false);

      prepareSucceeds();
      await byId(wrapper, 'retry').trigger('click');
      await flushPromises();
      expect(flow.prepare).toHaveBeenCalledTimes(2);
      expect(flow.prepare).toHaveBeenLastCalledWith({ unit: UNIT, priceLovelace: 100n * ADA });
      expect(has(wrapper, 'confirm')).toBe(true);
    });

    it('a refusal that would fail the same way offers only Close', async () => {
      const wrapper = await failWith('VERIFY_FAILED');
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
      await typePrice(wrapper, '100');
      await byId(wrapper, 'continue').trigger('click');
      await flushPromises();
      await wrapper.get('[data-test="password"]').setValue('hunter2');
      await byId(wrapper, 'confirm').trigger('click');
      await flushPromises();

      expect(byId(wrapper, 'error').text()).toBe('This may have been sent. Check your activity before you try again.');
      expect(has(wrapper, 'retry')).toBe(false);
      expect(has(wrapper, 'refresh')).toBe(false);
    });

    it('a signing failure stays on the review: confirming again is the retry', async () => {
      flow.signAndSubmit.mockImplementation(async () => {
        flow.failure.value = { code: 'SIGN_FAILED' };
        flow.stage.value = 'review';
        return false;
      });
      const wrapper = render();
      await typePrice(wrapper, '100');
      await byId(wrapper, 'continue').trigger('click');
      await flushPromises();
      await wrapper.get('[data-test="password"]').setValue('hunter2');
      await byId(wrapper, 'confirm').trigger('click');
      await flushPromises();

      expect(byId(wrapper, 'error').text()).toBe('We could not sign this transaction. Try again.');
      expect(has(wrapper, 'confirm')).toBe(true);
    });

    it('never shows a string from the worker or Nexus, only the copy for its code', async () => {
      const wrapper = await failWith('SOMETHING_NEW_FROM_NEXUS');
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
      expect(has(wrapper, 'continue')).toBe(false);
      expect(flow.prepare).not.toHaveBeenCalled();
    });

    it('lets a hardware wallet through once its type is listed', async () => {
      allowedHardware.types = ['Ledger'];
      store.loggedWallet = { id: 1, chain: Blockchain.CARDANO, network: Network.PREPROD, type: 'Ledger' };
      const wrapper = render();
      await typePrice(wrapper, '100');
      expect(has(wrapper, 'hardware')).toBe(false);
      expect(byId(wrapper, 'continue').attributes('disabled')).toBeUndefined();
    });

    it('says the market is not available on a network with no deployment, and builds nothing', async () => {
      store.loggedWallet = { id: 1, chain: Blockchain.CARDANO, network: Network.MAINNET, type: 'Normal' };
      const wrapper = render();
      await typePrice(wrapper, '100');
      expect(body(wrapper).text()).toContain('The market is not available on this network.');
      expect(byId(wrapper, 'continue').attributes('disabled')).toBeDefined();
    });

    it('closes when the wallet is switched: the sheet was about the last wallet\'s NFT', async () => {
      const wrapper = render();
      await typePrice(wrapper, '100');
      await byId(wrapper, 'continue').trigger('click');
      await flushPromises();

      store.loggedWallet = { id: 2, chain: Blockchain.CARDANO, network: Network.PREPROD, type: 'Normal' };
      await flushPromises();
      expect(wrapper.emitted('close')).toBeTruthy();
    });
  });

  it('starts clean each time it opens', async () => {
    const wrapper = render({ isOpen: false });
    await wrapper.setProps({ isOpen: true });
    await typePrice(wrapper, '100');
    await wrapper.setProps({ isOpen: false });
    await wrapper.setProps({ isOpen: true });
    await flushPromises();

    expect((priceInput(wrapper).element as HTMLInputElement).value).toBe('');
    expect(flow.reset).toHaveBeenCalled();
  });
});

describe('ListNftDialog: edit price', () => {
  beforeEach(() => {
    flow.reset();
    flow.action = undefined;
    flow.prepare.mockReset();
    flow.signAndSubmit.mockReset();
    flow.reset.mockClear();
    info.load.mockClear();
    info.floorLovelace.value = null;
    info.lastSaleLovelace.value = null;
    info.royalties.value = null;
    info.royaltiesState.value = 'idle';
    store.loggedWallet = { id: 1, chain: Blockchain.CARDANO, network: Network.PREPROD, type: 'Normal' };
    allowedHardware.types = [];
    prepareSucceeds(REPRICE_SUMMARY);
    signingSucceeds();
  });
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('is a reprice of the existing listing: titled so, no royalty terms read, the current price filled in', async () => {
    const wrapper = render({ existing: EXISTING });
    await flushPromises();

    expect(flow.action).toBe('reprice');
    expect(info.options).toEqual({ royalties: false });
    expect(wrapper.get('[data-test="dialog-title"]').text()).toBe('Edit price');
    expect((priceInput(wrapper).element as HTMLInputElement).value).toBe('120');
    expect(body(wrapper).text()).toContain('Current price');
    expect(body(wrapper).text()).toContain('120 ADA');
  });

  it('keeps the listing\'s royalties and moves only the fee and what the seller keeps', async () => {
    const wrapper = render({ existing: EXISTING });
    await typePrice(wrapper, '90');

    expect(wrapper.get('[data-testid="breakdown-price"]').text()).toBe('Price90 ADA');
    expect(wrapper.get('[data-testid="breakdown-fee"]').text()).toBe('Gero fee1.5 ADA');
    // The royalty keeps its 6 ADA, now a larger share of a smaller price.
    expect(wrapper.get('[data-testid="breakdown-royalty"]').text()).toBe(`Royalty to ${SHORT_A}6 ADA`);
    expect(wrapper.get('[data-testid="breakdown-royalties-total"]').text()).toBe('Royalties, 6.67% of the price6 ADA');
    expect(wrapper.get('[data-testid="breakdown-receive"]').text()).toBe('You receive82.5 ADA');
  });

  it('refuses the price it already has', async () => {
    const wrapper = render({ existing: EXISTING });
    await typePrice(wrapper, '120.0');
    expect(body(wrapper).text()).toContain('This is already the price. Enter a new one.');
    expect(byId(wrapper, 'continue').attributes('disabled')).toBeDefined();
  });

  it('refuses the same things a new listing does: under the minimum, and a price that leaves the seller too little', async () => {
    const wrapper = render({ existing: EXISTING });
    await typePrice(wrapper, '4');
    expect(body(wrapper).text()).toContain('The price is too low. The minimum is 5 ADA.');
    // 6 ADA: fee 1.5 and the fixed 6 ADA royalty leave nothing.
    await typePrice(wrapper, '6');
    expect(body(wrapper).text()).toContain('After the market fee and royalties you would receive less than 1.5 ADA. Raise the price.');
    expect(byId(wrapper, 'continue').attributes('disabled')).toBeDefined();
  });

  it('never asks for a royalty confirmation: the royalties are not recomputed', async () => {
    const wrapper = render({ existing: { ...EXISTING, datum: { ...EXISTING.datum, royalties: [{ address: CREATOR_A, lovelace: 40n * ADA }] } } });
    await typePrice(wrapper, '100');
    expect(has(wrapper, 'royalty-confirm')).toBe(false);
  });

  it('asks the worker to change the price of that listing, with the exact amount', async () => {
    const wrapper = render({ existing: EXISTING });
    await typePrice(wrapper, '90');
    await byId(wrapper, 'continue').trigger('click');
    await flushPromises();
    expect(flow.prepare).toHaveBeenCalledWith({ ref: LISTING_REF, priceLovelace: 90n * ADA });
  });

  it('reviews the worker\'s figures with the old price beside the new one, the deposit staying put', async () => {
    const wrapper = render({ existing: EXISTING });
    await typePrice(wrapper, '90');
    await byId(wrapper, 'continue').trigger('click');
    await flushPromises();

    const review = byId(wrapper, 'review');
    expect(review.text()).toContain('New price');
    expect(review.get('[data-testid="breakdown-price"]').text()).toBe('Price90 ADA');
    expect(review.get('[data-testid="breakdown-receive"]').text()).toBe('You receive82.5 ADA');
    expect(review.get('[data-testid="breakdown-deposit"]').text()).toBe('Your deposit, returned to you1.55 ADA');
    expect(review.get('[data-testid="breakdown-network-fee"]').text()).toBe('Network Fee0.35 ADA');
    expect(review.get('[data-testid="list-nft-old-price"]').text()).toBe('Current price120 ADA');
  });

  it('says the price change is on its way when it is done', async () => {
    const wrapper = render({ existing: EXISTING });
    await typePrice(wrapper, '90');
    await byId(wrapper, 'continue').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="password"]').setValue('hunter2');
    await byId(wrapper, 'confirm').trigger('click');
    await flushPromises();
    expect(byId(wrapper, 'done').text()).toContain('The new price is on its way.');
  });

  it('says the listing changed, and offers a refresh, when the worker no longer finds it', async () => {
    prepareFails('LISTING_NOT_FOUND');
    const wrapper = render({ existing: EXISTING });
    await typePrice(wrapper, '90');
    await byId(wrapper, 'continue').trigger('click');
    await flushPromises();
    expect(byId(wrapper, 'error').text()).toContain('This listing changed.');
    expect(has(wrapper, 'refresh')).toBe(true);
  });

  it('cannot price a listing at a deployment this build does not configure', async () => {
    const wrapper = render({ existing: { ...EXISTING, deploymentVersion: 9 } });
    await typePrice(wrapper, '90');
    expect(body(wrapper).text()).toContain('This listing cannot be read, so it cannot be used here.');
    expect(byId(wrapper, 'continue').attributes('disabled')).toBeDefined();
  });
});
