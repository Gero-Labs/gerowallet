import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { mount, type VueWrapper } from '@vue/test-utils';
import * as Vue from 'vue';
import { nextTick,  type Ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The live DUST reading both screens consume, driven directly by each test. */
interface LiveDust { dustBalance: Ref<bigint>; settled: Ref<boolean> }
/** The `<script setup>` bindings these tests read or drive, reached through the instance. */
interface SetupState {
  recipient: unknown;
  amount: unknown;
  /** Side panel only. */
  step: unknown;
  /** Dashboard only. */
  currentStep: unknown;
  sponsorWalletId: unknown;
  blockedByFee: unknown;
}

const review = vi.hoisted(() => ({ live: {} as LiveDust, sponsorId: null as number | null }));
const ui = vi.hoisted(() => ({
  slot: { render(this: Vue.ComponentPublicInstance) { return Vue.h('div', this.$slots['default']?.()); } },
  blank: { render() { return Vue.h('div'); } },
}));
vi.mock('@/shared/dialogs/BaseDialog.vue', () => ({ default: ui.slot }));
vi.mock('@/sidepanel/components/BottomSheet.vue', () => ({ default: ui.slot }));
vi.mock('@/shared/components/CustomStepper.vue', () => ({ default: ui.slot }));
vi.mock('@/shared/components/TransactionAuthSection.vue', () => ({ default: ui.blank }));
vi.mock('@/shared/components/TransactionDetailsCard.vue', () => ({ default: ui.blank }));
vi.mock('@/shared/components/MidnightSendTimeline.vue', () => ({ default: ui.blank }));
vi.mock('@/modules/dashboard/components/MidnightPrivateBalances.vue', () => ({ default: ui.blank }));
vi.mock('@/modules/dashboard/dialogs/ShieldedProvingConsentDialog.vue', () => ({ default: ui.blank }));
vi.mock('@/modules/dashboard/dialogs/QRAddressScannerDialog.vue', () => ({ default: ui.blank }));
vi.mock('@/modules/dashboard/dialogs/MidnightSponsorPicker.vue', () => ({ default: {
  name: 'ReviewSponsorPicker', props: ['modelValue', 'senderWalletId', 'network'],
  render() { return Vue.h('div', { 'data-sponsor-picker': 'true' }); },
} }));
vi.mock('@/shared/composables/useMidnightDustLive', async () => {
  const { ref } = await import('vue');
  review.live = { dustBalance: ref(0n), settled: ref(true) };
  return { useMidnightDustLive: () => review.live };
});
vi.mock('@/stores/walletStore', async () => {
  const { reactive } = await import('vue');
  return { walletStore: reactive({ loggedWallet: { id: 1, name: 'Sender', network: 'Mainnet', type: 'normal', chain: 'midnight' } }) };
});
vi.mock('@/stores/geroStore', () => ({ geroStore: { wallets: { 2: { id: 2, name: 'Sponsor', encryptionMethod: 'password' } } } }));
vi.mock('@/stores/midnightStore', async () => {
  const { reactive } = await import('vue');
  return { midnightStore: reactive({
    balances: { nightUnshielded: 10_000_000n, shieldedTokens: {} },
    dustState: null, utxos: [], addresses: { unshielded: 'mn_addr1self', dust: 'mn_dust1self' },
    proofServer: { mode: 'cloud' }, privateSyncStatus: 'synced', sendProgress: null,
  }) };
});
vi.mock('@/chains/midnight/midnightSponsorLinks', () => ({
  loadSponsorLinks: async () => [],
  linkFor: () => review.sponsorId == null ? undefined : { sponsorWalletId: review.sponsorId },
}));
vi.mock('@/chains/midnight/midnightSponsorLookup', () => ({ loadSponsorCandidates: async () => ({ candidates: [] }) }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/shared/composables/useGlobalSearch', () => ({ settingsNavRequest: {} }));
vi.mock('@/shared/composables/useMidnightSendTimeline', async () => {
  const { ref } = await import('vue');
  return { useMidnightSendTimeline: () => ref([]) };
});
vi.mock('@/sidepanel/composables/useChainContext', async () => {
  const { ref } = await import('vue');
  return { useChainContext: () => ({ themeColors: ref({ primary: '#00ff00' }) }) };
});
vi.mock('@/shared/utils/openFullDashboard', () => ({ openFullDashboard: vi.fn() }));
vi.mock('@/plugins/snackbar', () => ({ default: { show: vi.fn() } }));
vi.mock('@/utils/assets', () => ({ default: { sendSvg: '' } }));
vi.mock('@/utils/rules', () => ({ default: { required: () => () => true } }));
vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));

import Dialog from '@/modules/dashboard/dialogs/MidnightSendDialog.vue';
import Sheet from '@/sidepanel/components/flows/MidnightSendSheet.vue';

const views: VueWrapper[] = [];
const buttonStub = { props: ['disabled'], emits: ['click'],
        template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' };
const formStub = { methods: { validate: async () => ({ valid: true, errors: [] }) }, template: '<div><slot /></div>' };
function mountScreen(component: Vue.Component) {
  const slots = Object.fromEntries(['v-card', 'v-card-title', 'v-card-text', 'v-card-actions', 'v-stepper', 'v-stepper-header', 'v-stepper-window', 'v-stepper-window-item', 'v-tabs', 'v-tab', 'v-window', 'v-window-item', 'v-row', 'v-col', 'v-expand-transition', 'v-fade-transition', 'v-slide-y-transition'].map((name) => [name, ui.slot]));
  const wrapper = mount(component, { props: { isOpen: true, modelValue: true }, global: { config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) }, stubs: { ...slots, 'v-btn': buttonStub, 'v-form': formStub, 'v-icon': true, 'v-avatar': true, 'v-spacer': true, 'v-text-field': true, 'v-select': true, 'v-menu': true, 'v-progress-linear': true, 'v-progress-circular': true, 'v-tooltip': true } } });
  views.push(wrapper);
  return wrapper;
}
async function settle() { for (let i = 0; i < 10; i++) { await Promise.resolve(); await nextTick(); } }
function state(wrapper: VueWrapper): SetupState {
  return (wrapper.vm.$ as unknown as { setupState: SetupState }).setupState;
}
function button(wrapper: VueWrapper, text: string) {
  const found = wrapper.findAll('button').find((entry) => entry.text().includes(text));
  if (!found) throw new Error(`Missing button ${text}`);
  return found;
}
beforeEach(() => { review.live.dustBalance.value = 0n; review.live.settled.value = true; review.sponsorId = null; });
afterEach(() => { views.splice(0).forEach((wrapper) => wrapper.unmount()); });

describe.each([['dashboard', Dialog], ['side panel', Sheet]] as const)('%s send wiring', (surface, component) => {
  it('renders warning and picker on unverified zero and permits proceeding without a sponsor', async () => {
    const wrapper = mountScreen(component);
    const setup = state(wrapper);
    setup.recipient = 'mn_addr1destination';
    setup.amount = '1';
    if (surface === 'side panel') setup.step = 2;
    await settle();
    expect(wrapper.text()).toContain('midnight.send.noDustFee');
    expect(wrapper.find('[data-sponsor-picker]').exists()).toBe(true);
    expect(setup.sponsorWalletId).toBeNull();
    const next = button(wrapper, surface === 'dashboard' ? 'common.continue' : 'miniGero.review');
    expect(next.attributes('disabled')).toBeUndefined();
    await next.trigger('click');
    await settle();
    expect(surface === 'dashboard' ? setup.currentStep : setup.step).toBe(surface === 'dashboard' ? 2 : 3);
  });

  it('restores a saved sponsor and lets the picker clear it while the zero stays unverified', async () => {
    review.sponsorId = 2;
    const wrapper = mountScreen(component);
    await settle();
    const picker = wrapper.findComponent({ name: 'ReviewSponsorPicker' });
    expect(picker.props('modelValue')).toBe(2);
    picker.vm.$emit('update:modelValue', null);
    await settle();
    expect(state(wrapper).sponsorWalletId).toBeNull();
    expect(state(wrapper).blockedByFee).toBe(false);
  });

  it('hides the warning and picker while unsettled or positive', async () => {
    review.live.settled.value = false;
    const wrapper = mountScreen(component);
    await settle();
    expect(wrapper.text()).not.toContain('midnight.send.noDustFee');
    expect(wrapper.find('[data-sponsor-picker]').exists()).toBe(false);
    review.live.dustBalance.value = 10n;
    review.live.settled.value = true;
    await settle();
    expect(wrapper.text()).not.toContain('midnight.send.noDustFee');
    expect(wrapper.find('[data-sponsor-picker]').exists()).toBe(false);
  });
});
