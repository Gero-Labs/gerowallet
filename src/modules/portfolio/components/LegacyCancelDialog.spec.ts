// The dialog that gets stuck items back (NFT rescue): the worker prepares and verifies the cancel,
// the dialog shows what it does, then signs and submits it. The prepared-tx flow is replaced by
// refs and spies the test owns (usePreparedTxFlow has its own specs); what is checked here is what
// the dialog asks of it, in which state, and what it shows and tells the listings list. The copy is
// the real English table, so a mistyped key shows up as a raw key in the assertions.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import type { Ref } from 'vue';
import { createTestVuetify } from '@test/helpers/vuetify';
import type { LegacyListingItem } from '@/api/legacy-listings-api';
import type { LegacyCancelSummary } from '@/chrome/legacyCancelVerify';

const TX_CBOR = '84a400';
const TX_ID = 'ab'.repeat(32);
const UNIT = 'cd'.repeat(28) + '4e4654';
const OWNER = 'aa'.repeat(28);
const REFS = [`${'11'.repeat(32)}#0`, `${'22'.repeat(32)}#1`];

const LISTING: LegacyListingItem = {
  txHash: '11'.repeat(32), outputIndex: 0, contract: 'legacy_v3', kind: 'listing', ownerPkh: OWNER, lovelace: '1361960',
  assets: [{ unit: UNIT, quantity: '1' }],
};
const OFFER: LegacyListingItem = {
  txHash: '22'.repeat(32), outputIndex: 1, contract: 'legacy_v2', kind: 'offer', ownerPkh: OWNER, lovelace: '25000000', assets: [],
};
const SUMMARY: LegacyCancelSummary = { txId: TX_ID, feeLovelace: '352696', refs: REFS, items: [LISTING, OFFER] };

type FlowStage = 'idle' | 'preparing' | 'review' | 'signing' | 'submitting' | 'done';
const flow = vi.hoisted(
  () =>
    ({}) as {
      stage: Ref<FlowStage>;
      prepared: Ref<{ txCbor: string; txId: string; summary: LegacyCancelSummary } | null>;
      failure: Ref<{ code: string } | null>;
      submittedTxId: Ref<string | null>;
      prepare: Mock<(refs: string[]) => Promise<boolean>>;
      signAndSubmit: Mock<(credentials?: { password?: string; privateKeyBytes?: Uint8Array }) => Promise<boolean>>;
      reset: Mock<() => void>;
      keystone: { keystoneShow: Ref<boolean> };
      options: { getIsBT?: () => boolean } | undefined;
    },
);
const listings = vi.hoisted(
  () => ({}) as { meta: Ref<Map<string, { name: string; image?: string }>>; refresh: Mock<() => Promise<void>>; forget: Mock<(refs: string[]) => void> },
);
const walletState = vi.hoisted(() => ({
  loggedWallet: { id: 1, chain: 'Cardano', network: 'Mainnet', type: 'Normal' } as Record<string, unknown>,
  keys: { payment: [], change: [], stake: [] },
  utxos: [],
}));
// Which hardware wallet types the rescue allows: empty, as shipped.
const allowedHardware = vi.hoisted(() => ({ types: [] as string[] }));

vi.mock('@/shared/composables/useLegacyRescue', async () => {
  const { ref } = await import('vue');
  flow.stage = ref('idle');
  flow.prepared = ref(null);
  flow.failure = ref(null);
  flow.submittedTxId = ref(null);
  flow.keystone = { keystoneShow: ref(false) };
  flow.prepare = vi.fn<(refs: string[]) => Promise<boolean>>();
  flow.signAndSubmit = vi.fn<(credentials?: { password?: string; privateKeyBytes?: Uint8Array }) => Promise<boolean>>();
  flow.reset = vi.fn<() => void>(() => {
    flow.stage.value = 'idle';
    flow.prepared.value = null;
    flow.failure.value = null;
    flow.submittedTxId.value = null;
  });
  return {
    useLegacyRescue: (options?: { getIsBT?: () => boolean }) => {
      flow.options = options;
      return {
        stage: flow.stage,
        prepared: flow.prepared,
        failure: flow.failure,
        submittedTxId: flow.submittedTxId,
        prepare: flow.prepare,
        signAndSubmit: flow.signAndSubmit,
        reset: flow.reset,
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
vi.mock('@/shared/composables/useLegacyListings', async () => {
  const { computed, ref } = await import('vue');
  listings.meta = ref(new Map());
  listings.refresh = vi.fn<() => Promise<void>>(() => Promise.resolve());
  listings.forget = vi.fn<(refs: string[]) => void>();
  return {
    useLegacyListings: () => ({
      items: ref([]),
      meta: listings.meta,
      count: computed(() => 0),
      loading: ref(false),
      refresh: listings.refresh,
      forget: listings.forget,
    }),
  };
});
vi.mock('@/stores/walletStore', async () => {
  const { reactive } = await import('vue');
  return { walletStore: reactive(walletState) };
});
vi.mock('@/shared/composables/useExplorer', () => ({
  useExplorer: () => ({ explorerUrl: (_: string, id: string) => (id ? `https://explorer.example/${id}` : '') }),
}));
vi.mock('@/utils/legacyMarketScripts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/legacyMarketScripts')>();
  return { ...actual, isLegacyRescueHardware: (type: string | null | undefined) => actual.isLegacyRescueHardware(type, allowedHardware.types) };
});
// BaseDialog is a v-dialog (teleported); a plain wrapper keeps the content in the test's DOM.
vi.mock('@/shared/dialogs/BaseDialog.vue', () => ({
  default: {
    props: ['isOpen', 'title', 'persistent'],
    emits: ['close'],
    template: `<div v-if="isOpen" data-test="dialog" :data-persistent="String(persistent)">
      <h2 data-test="dialog-title">{{ title }}</h2>
      <button data-test="dialog-close" @click="$emit('close')">x</button>
      <slot />
    </div>`,
  },
}));
// The password field's PassKey autofill needs WebAuthn; a plain input stands in for it.
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

import LegacyCancelDialog from './LegacyCancelDialog.vue';
import { walletStore } from '@/stores/walletStore';

enableAutoUnmount(afterEach);

const store = walletStore as unknown as typeof walletState;

/** The worker built and verified the cancel. */
function prepareSucceeds(summary: LegacyCancelSummary = SUMMARY) {
  flow.prepare.mockImplementation(async () => {
    flow.failure.value = null;
    flow.prepared.value = { txCbor: TX_CBOR, txId: summary.txId, summary };
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

/** Signing and submitting went through: what usePreparedTxFlow leaves behind. */
function signingSucceeds() {
  flow.signAndSubmit.mockImplementation(async () => {
    flow.submittedTxId.value = TX_ID;
    flow.stage.value = 'done';
    return true;
  });
}

function render(props: { isOpen?: boolean; refs?: string[] } = {}) {
  return mount(LegacyCancelDialog, {
    attachTo: document.body,
    props: { isOpen: true, refs: REFS, ...props },
    global: { plugins: [createTestVuetify()] },
  });
}

const body = (wrapper: ReturnType<typeof render>) => wrapper.get('[data-testid="legacy-cancel"]');

describe('LegacyCancelDialog', () => {
  beforeEach(() => {
    flow.reset();
    flow.keystone.keystoneShow.value = false;
    flow.options = undefined;
    flow.prepare.mockReset();
    flow.signAndSubmit.mockReset();
    flow.reset.mockClear();
    listings.refresh.mockClear();
    listings.forget.mockClear();
    listings.meta.value = new Map([[UNIT, { name: 'Equine Pioneer 04601', image: 'https://img.example/1.png' }]]);
    store.loggedWallet = { id: 1, chain: 'Cardano', network: 'Mainnet', type: 'Normal' };
    allowedHardware.types = [];
    prepareSucceeds();
    signingSucceeds();
  });
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('asks the worker to prepare the given refs when it opens, and waits while it builds', async () => {
    flow.prepare.mockImplementation(() => {
      flow.stage.value = 'preparing';
      return new Promise(() => {});
    });
    const wrapper = render();
    await flushPromises();

    expect(flow.prepare).toHaveBeenCalledTimes(1);
    expect(flow.prepare).toHaveBeenCalledWith(REFS);
    expect(wrapper.find('[data-testid="legacy-cancel-preparing"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="legacy-cancel-confirm"]').exists()).toBe(false);
    // Nothing may close it while the worker is building.
    expect(wrapper.get('[data-test="dialog"]').attributes('data-persistent')).toBe('true');
  });

  it('reviews what comes back: each item, the network fee, and what Gero adds when it lends nothing', async () => {
    const wrapper = render();
    await flushPromises();

    const review = body(wrapper).text();
    expect(review).toContain('You get back');
    expect(review).toContain('Equine Pioneer 04601');
    expect(review).toContain('1.36196 ADA locked');
    expect(review).toContain('Offer, 25 ADA locked');
    expect(review).toContain('Network fee');
    expect(review).toContain('0.352696 ADA');
    expect(wrapper.find('[data-testid="legacy-cancel-sponsored"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="legacy-cancel-confirm"]').exists()).toBe(true);
  });

  it('shows the sponsored-collateral line when the summary has a ref', async () => {
    prepareSucceeds({ ...SUMMARY, sponsoredCollateralRef: `${'ee'.repeat(32)}#0` });
    const wrapper = render();
    await flushPromises();

    expect(wrapper.get('[data-testid="legacy-cancel-sponsored"]').text()).toBe('Collateral provided by Gero');
  });

  it('LISTING_NOT_FOUND shows the gone message and refreshes', async () => {
    prepareFails('LISTING_NOT_FOUND');
    const wrapper = render();
    await flushPromises();

    expect(body(wrapper).text()).toContain('Some of these items are no longer locked. The list has been refreshed.');
    expect(listings.refresh).toHaveBeenCalledTimes(1);
    // Nothing to retry: the items are gone. The only way out is to close.
    expect(wrapper.find('[data-testid="legacy-cancel-retry"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="legacy-cancel-confirm"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="legacy-cancel-close"]').text()).toBe('Close');
  });

  it('any other failure says so once, in general terms, and offers to try again', async () => {
    prepareFails('BUILD_FAILED');
    const wrapper = render();
    await flushPromises();

    expect(body(wrapper).text()).toContain('Could not get these items back. Try again.');
    expect(listings.refresh).not.toHaveBeenCalled();

    prepareSucceeds();
    await wrapper.get('[data-testid="legacy-cancel-retry"]').trigger('click');
    await flushPromises();

    expect(flow.prepare).toHaveBeenCalledTimes(2);
    expect(flow.prepare).toHaveBeenLastCalledWith(REFS);
    expect(wrapper.find('[data-testid="legacy-cancel-confirm"]').exists()).toBe(true);
  });

  it.each(['BUILD_FAILED', 'NETWORK_UNSUPPORTED', 'WALLET_UNSUPPORTED', 'NOT_OWNED', 'EXPIRED', 'SOMETHING_NEW'])(
    'a %s failure keeps the general message and its retry, and closing does not refresh',
    async (code) => {
      prepareFails(code);
      const wrapper = render();
      await flushPromises();

      expect(wrapper.get('[data-testid="legacy-cancel-error"]').text()).toBe('Could not get these items back. Try again.');
      expect(wrapper.find('[data-testid="legacy-cancel-retry"]').exists()).toBe(true);
      await wrapper.get('[data-testid="legacy-cancel-close"]').trigger('click');
      expect(wrapper.emitted('close')).toHaveLength(1);
      expect(listings.refresh).not.toHaveBeenCalled();
    },
  );

  it('a signing failure stays on the review with the general message: confirming again is the retry', async () => {
    flow.signAndSubmit.mockImplementation(async () => {
      flow.failure.value = { code: 'SIGN_FAILED' };
      flow.stage.value = 'review';
      return false;
    });
    const wrapper = render();
    await flushPromises();
    await wrapper.get('[data-test="password"]').setValue('hunter2');
    await wrapper.get('[data-testid="legacy-cancel-confirm"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-testid="legacy-cancel-error"]').text()).toBe('Could not get these items back. Try again.');
    expect(wrapper.find('[data-testid="legacy-cancel-confirm"]').exists()).toBe(true);
    expect(listings.forget).not.toHaveBeenCalled();
  });

  describe('a refusal about the items themselves: building them again fails the same way', () => {
    const ITEM_CODES = ['EVALUATION_FAILED', 'DATUM_UNREADABLE', 'NOT_LEGACY_LISTING', 'VERIFY_FAILED', 'MIXED_CONTRACTS', 'TOO_MANY_LISTINGS'];

    it.each(ITEM_CODES)('%s for one item says that item cannot be returned, with no retry', async (code) => {
      prepareFails(code);
      const wrapper = render({ refs: [REFS[0]!] });
      await flushPromises();

      expect(wrapper.get('[data-testid="legacy-cancel-error"]').text()).toBe('This item can\'t be returned right now.');
      expect(wrapper.find('[data-testid="legacy-cancel-retry"]').exists()).toBe(false);
      expect(wrapper.get('[data-testid="legacy-cancel-close"]').text()).toBe('Close');
      expect(listings.refresh).not.toHaveBeenCalled();
    });

    it.each(ITEM_CODES)('%s for several items says one of them cannot be returned and to try them one at a time, with no retry', async (code) => {
      prepareFails(code);
      const wrapper = render({ refs: REFS });
      await flushPromises();

      expect(wrapper.get('[data-testid="legacy-cancel-error"]').text())
        .toBe('One of these items can\'t be returned right now. Try them one at a time.');
      expect(wrapper.find('[data-testid="legacy-cancel-retry"]').exists()).toBe(false);
      expect(listings.refresh).not.toHaveBeenCalled();
    });
  });

  it('a submit that was not confirmed says it may have been sent, offers no retry, and refreshes the list on close', async () => {
    // What usePreparedTxFlow leaves once a signature exists but SUBMIT_TX gave no transaction id.
    flow.signAndSubmit.mockImplementation(async () => {
      flow.prepared.value = null;
      flow.failure.value = { code: 'SUBMIT_FAILED' };
      flow.stage.value = 'idle';
      return false;
    });
    const wrapper = render();
    await flushPromises();
    await wrapper.get('[data-test="password"]').setValue('hunter2');
    await wrapper.get('[data-testid="legacy-cancel-confirm"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-testid="legacy-cancel-error"]').text())
      .toBe('This may have been sent. Check your activity before you try again.');
    expect(wrapper.find('[data-testid="legacy-cancel-retry"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="legacy-cancel-confirm"]').exists()).toBe(false);
    expect(listings.forget).not.toHaveBeenCalled();
    expect(listings.refresh).not.toHaveBeenCalled();

    await wrapper.get('[data-testid="legacy-cancel-close"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(listings.refresh).toHaveBeenCalledTimes(1);
    expect(flow.prepare).toHaveBeenCalledTimes(1);
  });

  it('success forgets the refs and shows done with the transaction link', async () => {
    const wrapper = render();
    await flushPromises();
    const confirm = wrapper.get('[data-testid="legacy-cancel-confirm"]');
    expect(confirm.attributes('disabled')).toBeDefined(); // a password wallet needs the password first

    await wrapper.get('[data-test="password"]').setValue('hunter2');
    await wrapper.get('[data-testid="legacy-cancel-confirm"]').trigger('click');
    await flushPromises();

    expect(flow.signAndSubmit).toHaveBeenCalledWith({ password: 'hunter2' });
    expect(listings.forget).toHaveBeenCalledTimes(1);
    expect(listings.forget).toHaveBeenCalledWith(REFS);
    const done = wrapper.get('[data-testid="legacy-cancel-done"]');
    expect(done.text()).toContain('Items on their way back to your wallet');
    expect(done.text()).toContain(TX_ID);
    expect(done.get('a').attributes('href')).toBe(`https://explorer.example/${TX_ID}`);

    // Closing after a rescue looks the list up again.
    expect(listings.refresh).not.toHaveBeenCalled();
    await wrapper.get('[data-testid="legacy-cancel-done-button"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(listings.refresh).toHaveBeenCalledTimes(1);
  });

  it('a wrong password stays on the review with its message, and forgets nothing', async () => {
    flow.signAndSubmit.mockImplementation(async () => {
      flow.failure.value = { code: 'WRONG_PASSWORD' };
      flow.stage.value = 'review';
      return false;
    });
    const wrapper = render();
    await flushPromises();
    await wrapper.get('[data-test="password"]').setValue('nope');
    await wrapper.get('[data-testid="legacy-cancel-confirm"]').trigger('click');
    await flushPromises();

    expect(body(wrapper).text()).toContain('Incorrect password. Please try again.');
    expect(wrapper.find('[data-testid="legacy-cancel-confirm"]').exists()).toBe(true);
    expect(listings.forget).not.toHaveBeenCalled();
  });

  it('a Google wallet signs with its session: no password field', async () => {
    store.loggedWallet = { id: 1, chain: 'Cardano', network: 'Mainnet', type: 'Google', encryptionMethod: 'mpc' };
    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="password"]').exists()).toBe(false);
    await wrapper.get('[data-testid="legacy-cancel-confirm"]').trigger('click');
    await flushPromises();

    expect(flow.signAndSubmit).toHaveBeenCalledTimes(1);
    expect(flow.signAndSubmit).toHaveBeenCalledWith();
  });

  it('a PassKey wallet signs with the PassKey result', async () => {
    store.loggedWallet = { id: 1, chain: 'Cardano', network: 'Mainnet', type: 'Normal', encryptionMethod: 'prf' };
    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="password"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="legacy-cancel-confirm"]').exists()).toBe(false);
    await wrapper.get('[data-test="passkey"]').trigger('click');
    await flushPromises();

    expect(flow.signAndSubmit).toHaveBeenCalledWith({ privateKeyBytes: new Uint8Array([1, 2, 3]) });
  });

  it('unlisted hardware wallet sees hardwareSoon and no button', async () => {
    store.loggedWallet = { id: 1, chain: 'Cardano', network: 'Mainnet', type: 'Ledger' };
    const wrapper = render();
    await flushPromises();

    expect(body(wrapper).text()).toBe('Coming soon for hardware wallets');
    expect(body(wrapper).findAll('button')).toHaveLength(0);
    expect(wrapper.find('[data-test="password"]').exists()).toBe(false);
    // The worker would refuse a device wallet anyway: nothing is asked of it.
    expect(flow.prepare).not.toHaveBeenCalled();
  });

  it('a hardware wallet the rescue allows signs on its device: hint, no password, the Keystone QR dialog', async () => {
    allowedHardware.types = ['Keystone'];
    store.loggedWallet = { id: 1, chain: 'Cardano', network: 'Mainnet', type: 'Keystone' };
    const wrapper = render();
    await flushPromises();

    expect(flow.prepare).toHaveBeenCalledWith(REFS);
    expect(wrapper.find('[data-test="password"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="legacy-cancel-device"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="keystone-dialog"]').exists()).toBe(false);

    flow.keystone.keystoneShow.value = true;
    await flushPromises();
    expect(wrapper.find('[data-test="keystone-dialog"]').exists()).toBe(true);

    await wrapper.get('[data-testid="legacy-cancel-confirm"]').trigger('click');
    expect(flow.signAndSubmit).toHaveBeenCalledWith();
  });

  it('cannot be closed while it signs or submits', async () => {
    const wrapper = render();
    await flushPromises();
    flow.stage.value = 'submitting';
    await flushPromises();

    expect(wrapper.get('[data-test="dialog"]').attributes('data-persistent')).toBe('true');
    await wrapper.get('[data-test="dialog-close"]').trigger('click');
    expect(wrapper.emitted('close')).toBeUndefined();

    flow.stage.value = 'review';
    await flushPromises();
    await wrapper.get('[data-test="dialog-close"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('starts over each time it opens', async () => {
    const wrapper = render({ isOpen: false });
    await flushPromises();
    expect(flow.prepare).not.toHaveBeenCalled();

    await wrapper.setProps({ isOpen: true, refs: [REFS[0]!] });
    await flushPromises();
    expect(flow.prepare).toHaveBeenLastCalledWith([REFS[0]]);

    await wrapper.setProps({ isOpen: false });
    await wrapper.setProps({ isOpen: true, refs: REFS });
    await flushPromises();
    expect(flow.prepare).toHaveBeenCalledTimes(2);
    expect(flow.prepare).toHaveBeenLastCalledWith(REFS);
    expect(flow.reset).toHaveBeenCalled();
  });

  it('closes when another wallet is logged in: the refs were the last one\'s', async () => {
    const wrapper = render();
    await flushPromises();

    store.loggedWallet = { id: 2, chain: 'Cardano', network: 'Mainnet', type: 'Normal' };
    await flushPromises();

    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
