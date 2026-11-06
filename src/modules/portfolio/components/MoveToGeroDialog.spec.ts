// The sheet that moves ONE stuck listing of a closed marketplace into a Gero listing, in one
// transaction. It prices the move the way the list sheet prices a listing (the same
// useListingPriceForm and ListingBreakdown), says plainly that the NFT leaves the old marketplace
// for a Gero listing, and shows what the worker verified before anything is signed. The
// prepared-tx flow is replaced by refs and spies the test owns (useNftMarketFlow and
// usePreparedTxFlow have their own specs); what is checked here is what the sheet asks of it, in
// which state, and what it shows. The copy is the real English table, so a mistyped key shows up as
// a raw key in the assertions.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import type { Ref } from 'vue';
import { createTestVuetify } from '@test/helpers/vuetify';
import type { RoyaltyInfo } from '@/api/nft-market-api';
import type { LegacyListingItem } from '@/api/legacy-listings-api';
import { Blockchain, Network } from '@/models/types';

const TX_CBOR = '84a400';
const TX_ID = 'ab'.repeat(32);
const POLICY = 'cd'.repeat(28);
const UNIT = `${POLICY}4e4654`;
const CREATOR_A = `addr_test1qz${'a'.repeat(40)}ac4f9d2e`;
const SHORT_A = 'addr_test1qzaaa…ac4f9d2e';
const LEGACY_TX = 'fb'.repeat(32);
const LEGACY_REF = `${LEGACY_TX}#0`;

const FIVE_PERCENT: RoyaltyInfo = { source: 'cip27', rate: 0.05, recipients: [{ address: CREATOR_A, rate: 0.05, minFeeLovelace: null, maxFeeLovelace: null }] };
const TWELVE_PERCENT: RoyaltyInfo = { source: 'cip27', rate: 0.12, recipients: [{ address: CREATOR_A, rate: 0.12, minFeeLovelace: null, maxFeeLovelace: null }] };

const LISTING: LegacyListingItem = {
  txHash: LEGACY_TX,
  outputIndex: 0,
  contract: 'legacy_v3',
  kind: 'listing',
  ownerPkh: 'aa'.repeat(28),
  lovelace: '1361960',
  assets: [{ unit: UNIT, quantity: '1' }],
};
const OFFER: LegacyListingItem = { ...LISTING, txHash: 'fc'.repeat(32), kind: 'offer', contract: 'legacy_v2', lovelace: '25000000', assets: [] };

/** What the worker verified for a move at 100 ADA with a 5% royalty. */
const MIGRATE_SUMMARY = {
  txId: TX_ID,
  unit: UNIT,
  legacyRef: LEGACY_REF,
  legacyContract: 'legacy_v3',
  listingAddress: 'addr_test1listing',
  listingOutputIndex: 1,
  deploymentVersion: 1,
  priceLovelace: '100000000',
  marketFeeLovelace: '1500000',
  royaltiesLovelace: '5000000',
  sellerReceivesLovelace: '93500000',
  depositLovelace: '1550000',
  networkFeeLovelace: '413445',
  royalties: [{ address: CREATOR_A, lovelace: '5000000' }],
  dropped: [] as { address: string; lovelace: string }[],
  invalidRecipients: 0,
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
      unit: (() => string) | undefined;
    },
);
const legacy = vi.hoisted(
  () =>
    ({}) as {
      items: Ref<LegacyListingItem[]>;
      meta: Ref<Map<string, { name: string; image?: string }>>;
      forget: Mock<(refs: string[]) => void>;
      refresh: Mock<() => Promise<void>>;
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
    useNftMarketFlow: (action: 'migrate') => {
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
    useListingMarketInfo: (unit: () => string, options: { royalties: boolean }) => {
      info.options = options;
      info.unit = unit;
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
vi.mock('@/shared/composables/useLegacyListings', async () => {
  const { ref } = await import('vue');
  legacy.items = ref([]);
  legacy.meta = ref(new Map());
  legacy.forget = vi.fn<(refs: string[]) => void>();
  legacy.refresh = vi.fn<() => Promise<void>>(() => Promise.resolve());
  return { useLegacyListings: () => ({ items: legacy.items, meta: legacy.meta, forget: legacy.forget, refresh: legacy.refresh }) };
});
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('vue-router', () => ({ useRouter: () => router }));
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

import MoveToGeroDialog from './MoveToGeroDialog.vue';
import { walletStore } from '@/stores/walletStore';

enableAutoUnmount(afterEach);

const store = walletStore as unknown as typeof walletState;

function prepareSucceeds(summary: Record<string, unknown> = MIGRATE_SUMMARY) {
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

function render(props: { isOpen?: boolean; legacyRef?: string } = {}) {
  return mount(MoveToGeroDialog, {
    attachTo: document.body,
    props: { isOpen: true, legacyRef: LEGACY_REF, ...props },
    global: { plugins: [createTestVuetify()] },
  });
}

type Wrapper = ReturnType<typeof render>;
const body = (wrapper: Wrapper) => wrapper.get('[data-testid="move-to-gero"]');
const byId = (wrapper: Wrapper, id: string) => wrapper.get(`[data-testid="move-to-gero-${id}"]`);
const has = (wrapper: Wrapper, id: string) => wrapper.find(`[data-testid="move-to-gero-${id}"]`).exists();
const priceInput = (wrapper: Wrapper) => wrapper.get('[data-testid="move-to-gero-price"] input');

async function typePrice(wrapper: Wrapper, text: string) {
  await priceInput(wrapper).setValue(text);
  await flushPromises();
}

/** The royalty terms the sheet reads have arrived. */
function royaltiesAre(terms: RoyaltyInfo) {
  info.royalties.value = terms;
  info.royaltiesState.value = 'ready';
}

beforeEach(() => {
  flow.reset();
  flow.keystone.keystoneShow.value = false;
  flow.action = undefined;
  flow.prepare.mockReset();
  flow.signAndSubmit.mockReset();
  flow.reset.mockClear();
  router.push.mockClear();
  info.load.mockClear();
  info.reset.mockClear();
  info.floorLovelace.value = null;
  info.lastSaleLovelace.value = null;
  legacy.items.value = [LISTING, OFFER];
  legacy.meta.value = new Map([[UNIT, { name: 'Equine Pioneer 04601', image: 'https://img.example/1.png' }]]);
  legacy.forget.mockClear();
  legacy.refresh.mockClear();
  royaltiesAre(FIVE_PERCENT);
  store.loggedWallet = { id: 1, chain: Blockchain.CARDANO, network: Network.PREPROD, type: 'Normal' };
  allowedHardware.types = [];
  prepareSucceeds();
  signingSucceeds();
});
afterEach(() => {
  document.body.replaceChildren();
});

describe('MoveToGeroDialog: the price', () => {
  it('opens on the price of ONE listing: the NFT, a plain statement that it leaves the closed marketplace, and no worker call yet', async () => {
    const wrapper = render();
    await flushPromises();

    expect(flow.action).toBe('migrate');
    expect(wrapper.get('[data-test="dialog-title"]').text()).toBe('Move to Gero');
    // Plainly: the NFT leaves the closed marketplace and goes straight into a Gero listing.
    expect(wrapper.get('[data-test="dialog-subtitle"]').text()).toBe(
      'This NFT leaves the closed marketplace and goes straight into a Gero listing, in one transaction. You choose the price.',
    );
    expect(wrapper.get('[data-testid="listing-nft-name"]').text()).toBe('Equine Pioneer 04601');
    expect(wrapper.get('[data-testid="listing-nft-caption"]').text()).toBe('cdcdcdc...cdcdcd');
    expect(flow.prepare).not.toHaveBeenCalled();
    expect(byId(wrapper, 'continue').attributes('disabled')).toBeDefined();
  });

  it('reads the royalty terms and price hints of the legacy NFT\'s own unit, like a new listing', async () => {
    render();
    await flushPromises();
    expect(info.options).toEqual({ royalties: true });
    expect(info.unit?.()).toBe(UNIT);
    expect(info.load).toHaveBeenCalled();
  });

  it('shows the same breakdown the list sheet does: 100 ADA with a 5% royalty is fee 1.5, royalty 5, you receive 93.5', async () => {
    const wrapper = render();
    await typePrice(wrapper, '100');

    const breakdown = wrapper.get('[data-testid="listing-breakdown"]');
    expect(breakdown.get('[data-testid="breakdown-price"]').text()).toBe('Price100 ADA');
    expect(breakdown.get('[data-testid="breakdown-fee"]').text()).toBe('Gero fee1.5 ADA');
    expect(breakdown.get('[data-testid="breakdown-royalty"]').text()).toBe(`Royalty to ${SHORT_A}5 ADA`);
    expect(breakdown.get('[data-testid="breakdown-receive"]').text()).toBe('You receive93.5 ADA');
    expect(byId(wrapper, 'continue').attributes('disabled')).toBeUndefined();
  });

  it('shows the collection floor and last sale when the feed has them', async () => {
    info.floorLovelace.value = 90_000_000n;
    info.lastSaleLovelace.value = 120_500_000n;
    const wrapper = render();
    await flushPromises();
    expect(byId(wrapper, 'floor').text()).toContain('90 ADA');
    expect(byId(wrapper, 'last-sale').text()).toContain('120.5 ADA');
  });

  it('refuses 4 ADA and what is not a price, and Continue stays off', async () => {
    const wrapper = render();
    await typePrice(wrapper, '4');
    expect(byId(wrapper, 'continue').attributes('disabled')).toBeDefined();
    expect(body(wrapper).text()).toContain('The price is too low. The minimum is 5 ADA.');
    await byId(wrapper, 'continue').trigger('click');
    expect(flow.prepare).not.toHaveBeenCalled();

    await typePrice(wrapper, '1e3');
    expect(body(wrapper).text()).toContain('Enter a price in ADA with up to 6 decimals.');
    expect(byId(wrapper, 'continue').attributes('disabled')).toBeDefined();
  });

  it('refuses a price that leaves the seller under 1.5 ADA after the fee and the royalties', async () => {
    const wrapper = render();
    await typePrice(wrapper, '5');
    // 5 ADA: fee 1.5, royalty 0.25: the seller keeps 3.25, so it is allowed...
    expect(byId(wrapper, 'continue').attributes('disabled')).toBeUndefined();
    royaltiesAre({ source: 'cip27', rate: 0.5, recipients: [{ address: CREATOR_A, rate: 0.5, minFeeLovelace: null, maxFeeLovelace: null }] });
    await flushPromises();
    // ...and at 50% royalties it is not.
    expect(body(wrapper).text()).toContain('you would receive less than 1.5 ADA');
    expect(byId(wrapper, 'continue').attributes('disabled')).toBeDefined();
  });

  it('waits for the royalty terms: Continue is off while they load, and a failed read offers a retry', async () => {
    info.royalties.value = null;
    info.royaltiesState.value = 'loading';
    const wrapper = render();
    await typePrice(wrapper, '100');
    expect(has(wrapper, 'royalties-loading')).toBe(true);
    expect(byId(wrapper, 'continue').attributes('disabled')).toBeDefined();

    info.royaltiesState.value = 'failed';
    await flushPromises();
    expect(byId(wrapper, 'royalties-error').text()).toContain('We could not read the royalty terms of this collection');
    info.load.mockClear();
    await byId(wrapper, 'royalties-retry').trigger('click');
    expect(info.load).toHaveBeenCalledTimes(1);
  });

  it('asks the seller to agree to royalties above 10% before anything is built, and sends the confirmation with the request', async () => {
    royaltiesAre(TWELVE_PERCENT);
    const wrapper = render();
    await typePrice(wrapper, '100');

    expect(has(wrapper, 'royalty-warning')).toBe(true);
    expect(byId(wrapper, 'royalty-warning').text()).toContain('I agree to pay 12 ADA in royalties, 12% of the price');
    expect(byId(wrapper, 'continue').attributes('disabled')).toBeDefined();

    await byId(wrapper, 'royalty-confirm').find('input').setValue(true);
    expect(byId(wrapper, 'continue').attributes('disabled')).toBeUndefined();
    await byId(wrapper, 'continue').trigger('click');
    await flushPromises();

    expect(flow.prepare).toHaveBeenCalledWith({ legacyRef: LEGACY_REF, priceLovelace: 100_000_000n, confirmRoyaltyAboveCap: true });
  });

  it('a changed price withdraws the agreement', async () => {
    royaltiesAre(TWELVE_PERCENT);
    const wrapper = render();
    await typePrice(wrapper, '100');
    await byId(wrapper, 'royalty-confirm').find('input').setValue(true);
    expect(byId(wrapper, 'continue').attributes('disabled')).toBeUndefined();

    await typePrice(wrapper, '101');
    expect(byId(wrapper, 'continue').attributes('disabled')).toBeDefined();
  });

  it('on mainnet, where no Gero deployment is configured, there is nothing to price against and it says so', async () => {
    store.loggedWallet = { id: 1, chain: Blockchain.CARDANO, network: Network.MAINNET, type: 'Normal' };
    const wrapper = render();
    await typePrice(wrapper, '100');
    expect(byId(wrapper, 'unavailable').text()).toBe('The market is not available on this network.');
    expect(byId(wrapper, 'continue').attributes('disabled')).toBeDefined();
    expect(has(wrapper, 'review')).toBe(false);
    expect(wrapper.find('[data-testid="listing-breakdown"]').exists()).toBe(false);
  });
});

describe('MoveToGeroDialog: prepare and review', () => {
  it('sends the legacy ref and the exact price to the migrate flow, and nothing else', async () => {
    const wrapper = render();
    await typePrice(wrapper, '100.5');
    await byId(wrapper, 'continue').trigger('click');
    await flushPromises();

    expect(flow.prepare).toHaveBeenCalledTimes(1);
    expect(flow.prepare).toHaveBeenCalledWith({ legacyRef: LEGACY_REF, priceLovelace: 100_500_000n });
  });

  it('shows the worker\'s verified figures, the deposit and network fee, and who lends the collateral', async () => {
    prepareSucceeds({ ...MIGRATE_SUMMARY, sponsoredCollateralRef: `${'aa'.repeat(32)}#2` });
    const wrapper = render();
    await typePrice(wrapper, '100');
    await byId(wrapper, 'continue').trigger('click');
    await flushPromises();

    const review = byId(wrapper, 'review');
    expect(review.text()).toContain('Your Gero listing');
    expect(review.get('[data-testid="breakdown-price"]').text()).toBe('Price100 ADA');
    expect(review.get('[data-testid="breakdown-receive"]').text()).toBe('You receive93.5 ADA');
    expect(review.get('[data-testid="breakdown-deposit"]').text()).toContain('1.55 ADA');
    expect(review.get('[data-testid="breakdown-network-fee"]').text()).toContain('0.413445 ADA');
    expect(has(wrapper, 'sponsored')).toBe(true);
    // Back returns to the price, which keeps what was typed.
    await byId(wrapper, 'back').trigger('click');
    expect((priceInput(wrapper).element as HTMLInputElement).value).toBe('100');
  });

  it('confirms with the password the signature needs', async () => {
    const wrapper = render();
    await typePrice(wrapper, '100');
    await byId(wrapper, 'continue').trigger('click');
    await flushPromises();

    expect(byId(wrapper, 'confirm').attributes('disabled')).toBeDefined();
    await wrapper.get('[data-test="password"]').setValue('secret');
    expect(byId(wrapper, 'confirm').attributes('disabled')).toBeUndefined();
    await byId(wrapper, 'confirm').trigger('click');
    await flushPromises();

    expect(flow.signAndSubmit).toHaveBeenCalledWith({ password: 'secret' });
    expect(has(wrapper, 'done')).toBe(true);
  });
});

describe('MoveToGeroDialog: done', () => {
  async function moved() {
    const wrapper = render();
    await typePrice(wrapper, '100');
    await byId(wrapper, 'continue').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="password"]').setValue('secret');
    await byId(wrapper, 'confirm').trigger('click');
    await flushPromises();
    return wrapper;
  }

  it('says the NFT is moving, hides the item from the list at once, and links the transaction', async () => {
    const wrapper = await moved();

    expect(byId(wrapper, 'done').text()).toContain('Your NFT is moving to Gero. It shows as listed once the transaction is confirmed.');
    expect(byId(wrapper, 'done').text()).toContain(TX_ID);
    expect(byId(wrapper, 'explorer').attributes('href')).toBe(`https://explorer.example/${TX_ID}`);
    expect(legacy.forget).toHaveBeenCalledWith([LEGACY_REF]);
  });

  it('keeps the screens after the item has left the list', async () => {
    const wrapper = render();
    await typePrice(wrapper, '100');
    await byId(wrapper, 'continue').trigger('click');
    await flushPromises();
    // The list forgets the item the moment the move is submitted.
    legacy.forget.mockImplementation(() => { legacy.items.value = []; });
    await wrapper.get('[data-test="password"]').setValue('secret');
    await byId(wrapper, 'confirm').trigger('click');
    await flushPromises();

    expect(has(wrapper, 'done')).toBe(true);
    expect(has(wrapper, 'gone')).toBe(false);
  });

  it('closing after a move looks the list up again', async () => {
    const wrapper = await moved();
    await byId(wrapper, 'done-button').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(legacy.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('MoveToGeroDialog: failures', () => {
  async function reviewOpen() {
    const wrapper = render();
    await typePrice(wrapper, '100');
    return wrapper;
  }

  it('a refusal that would fail the same way offers neither a retry nor a refresh', async () => {
    prepareFails('VERIFY_FAILED');
    const wrapper = await reviewOpen();
    await byId(wrapper, 'continue').trigger('click');
    await flushPromises();

    expect(byId(wrapper, 'error').text()).toBe('The wallet could not confirm this transaction.');
    expect(has(wrapper, 'retry')).toBe(false);
    expect(has(wrapper, 'refresh')).toBe(false);
    expect(has(wrapper, 'activity')).toBe(false);
  });

  it('a failure building again can fix offers Try again, which prepares once more with the same price', async () => {
    prepareFails('BUILD_FAILED');
    const wrapper = await reviewOpen();
    await byId(wrapper, 'continue').trigger('click');
    await flushPromises();
    expect(byId(wrapper, 'error').text()).toBe('We could not prepare this transaction. Try again.');

    prepareSucceeds();
    await byId(wrapper, 'retry').trigger('click');
    await flushPromises();

    expect(flow.prepare).toHaveBeenLastCalledWith({ legacyRef: LEGACY_REF, priceLovelace: 100_000_000n });
    expect(has(wrapper, 'review')).toBe(true);
  });

  it('a listing that moved elsewhere (sold, cancelled) says so and offers Refresh, which looks the list up again and leaves', async () => {
    prepareFails('LISTING_NOT_FOUND');
    const wrapper = await reviewOpen();
    await byId(wrapper, 'continue').trigger('click');
    await flushPromises();

    expect(byId(wrapper, 'error').text()).toContain('This listing changed. Refresh and try again.');
    await byId(wrapper, 'refresh').trigger('click');
    expect(legacy.refresh).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('a signed move whose submit was not confirmed sends the seller to their activity, never to a rebuild', async () => {
    prepareSucceeds();
    flow.signAndSubmit.mockImplementation(async () => {
      flow.prepared.value = null;
      flow.failure.value = { code: 'SUBMIT_FAILED' };
      flow.stage.value = 'idle';
      return false;
    });
    const wrapper = await reviewOpen();
    await byId(wrapper, 'continue').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="password"]').setValue('secret');
    await byId(wrapper, 'confirm').trigger('click');
    await flushPromises();

    expect(byId(wrapper, 'error').text()).toContain('This may have been sent');
    expect(has(wrapper, 'retry')).toBe(false);
    await byId(wrapper, 'activity').trigger('click');
    expect(router.push).toHaveBeenCalledWith({ path: '/transactions' });
    expect(wrapper.emitted('close')).toHaveLength(1);
    // It may be on chain: the list is looked up again.
    expect(legacy.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('MoveToGeroDialog: what cannot be moved', () => {
  it('an offer holds no NFT: it is never priced, and the sheet says it cannot be moved', async () => {
    const wrapper = render({ legacyRef: `${OFFER.txHash}#0` });
    await flushPromises();

    expect(byId(wrapper, 'gone').text()).toBe('This is an offer to buy, not a listing, so it cannot be moved. You can still get it back.');
    expect(has(wrapper, 'price')).toBe(false);
    expect(has(wrapper, 'continue')).toBe(false);
    expect(flow.prepare).not.toHaveBeenCalled();
  });

  it('a listing the list no longer has was spent since: nothing is priced', async () => {
    legacy.items.value = [];
    const wrapper = render();
    await flushPromises();

    expect(byId(wrapper, 'gone').text()).toBe('This NFT is no longer locked on the closed marketplace. The list has been refreshed.');
    expect(has(wrapper, 'continue')).toBe(false);
    expect(flow.prepare).not.toHaveBeenCalled();
  });

  it('a bundle (several assets, or several of one) is not a single NFT: it says so, never "no longer locked", and is not moved', async () => {
    const SINGLE_ONLY = 'Only a listing of a single NFT can move to Gero.';
    for (const assets of [
      [{ unit: UNIT, quantity: '1' }, { unit: `${POLICY}4f74686572`, quantity: '1' }],
      [{ unit: UNIT, quantity: '3' }],
    ]) {
      legacy.items.value = [{ ...LISTING, assets }];
      const wrapper = render();
      await flushPromises();
      expect(byId(wrapper, 'gone').text(), JSON.stringify(assets)).toBe(SINGLE_ONLY);
      expect(wrapper.text()).not.toContain('no longer locked');
      expect(has(wrapper, 'continue')).toBe(false);
      expect(flow.prepare).not.toHaveBeenCalled();
      wrapper.unmount();
    }
  });

  it('the worker\'s not-a-single-NFT refusal reads the same, and offers no retry', async () => {
    prepareFails('NOT_SINGLE_NFT');
    const wrapper = render();
    await typePrice(wrapper, '100');
    await byId(wrapper, 'continue').trigger('click');
    await flushPromises();

    expect(byId(wrapper, 'error').text()).toBe('Only a listing of a single NFT can move to Gero.');
    expect(has(wrapper, 'retry')).toBe(false);
    expect(has(wrapper, 'refresh')).toBe(false);
  });

  it('a hardware wallet no device has signed a market transaction with is told so, and nothing is built', async () => {
    store.loggedWallet = { id: 1, chain: Blockchain.CARDANO, network: Network.PREPROD, type: 'Ledger' };
    const wrapper = render();
    await flushPromises();

    expect(has(wrapper, 'price')).toBe(false);
    expect(byId(wrapper, 'hardware').text()).toBe('Coming soon for hardware wallets');
    expect(flow.prepare).not.toHaveBeenCalled();
    expect(has(wrapper, 'continue')).toBe(false);
  });
});

describe('MoveToGeroDialog: opening and closing', () => {
  it('starts over each time it opens: a clean flow and a fresh price', async () => {
    const wrapper = render({ isOpen: false });
    await wrapper.setProps({ isOpen: true });
    await flushPromises();

    expect(flow.reset).toHaveBeenCalled();
    expect(info.reset).toHaveBeenCalled();
    expect(info.load).toHaveBeenCalled();
    expect((priceInput(wrapper).element as HTMLInputElement).value).toBe('');
  });

  it('cancel closes without asking the worker for anything', async () => {
    const wrapper = render();
    await byId(wrapper, 'cancel').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(flow.prepare).not.toHaveBeenCalled();
    expect(legacy.refresh).not.toHaveBeenCalled();
  });

  it('cannot be closed while the worker is preparing or the signature is in flight', async () => {
    const wrapper = render();
    await typePrice(wrapper, '100');
    flow.stage.value = 'preparing';
    await flushPromises();
    expect(wrapper.get('[data-test="dialog"]').attributes('data-persistent')).toBe('true');
    await wrapper.get('[data-test="dialog-close"]').trigger('click');
    expect(wrapper.emitted('close')).toBeUndefined();
  });
});
