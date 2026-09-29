import { mount, type Wrapper } from '@vue/test-utils';
import Vue, { nextTick, type CreateElement, type Ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The live DUST reading both screens consume, driven directly by each test. */
interface LiveDust { dustBalance: Ref<bigint>; settled: Ref<boolean> }
/** The `<script setup>` bindings these tests read or drive, reached through the instance. */
interface SetupState {
  recipient: { value: unknown };
  amount: { value: unknown };
  /** Side panel only. */
  step: { value: unknown };
  /** Dashboard only. */
  currentStep: { value: unknown };
  sponsorWalletId: { value: unknown };
  blockedByFee: { value: unknown };
}

const review = vi.hoisted(() => ({ live: {} as LiveDust, sponsorId: null as number | null }));
const ui = vi.hoisted(() => ({
  slot: { render(this: Vue, h: CreateElement) { return h('div', this.$slots['default']); } },
  blank: { render(h: CreateElement) { return h('div'); } },
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
  name: 'ReviewSponsorPicker', props: ['value', 'senderWalletId', 'network'],
  render(h: CreateElement) { return h('div', { attrs: { 'data-sponsor-picker': 'true' } }); },
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

const views: Wrapper<Vue>[] = [];
const buttonStub = { props: ['disabled'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' };
const formStub = { methods: { validate: () => true }, template: '<div><slot /></div>' };
function mountScreen(component: typeof Dialog) {
  const slots = Object.fromEntries(['v-card', 'v-card-title', 'v-card-text', 'v-card-actions', 'v-stepper', 'v-stepper-header', 'v-stepper-items', 'v-stepper-content', 'v-tabs', 'v-tab', 'v-tabs-items', 'v-tab-item', 'v-row', 'v-col', 'v-expand-transition', 'v-fade-transition', 'v-slide-y-transition'].map((name) => [name, ui.slot]));
  const wrapper = mount(component, {
    propsData: { isOpen: true, value: true },
    mocks: { $t: (key: string) => key },
    stubs: { ...slots, 'v-btn': buttonStub, 'v-form': formStub, 'v-icon': true, 'v-avatar': true, 'v-spacer': true, 'v-text-field': true, 'v-select': true, 'v-menu': true, 'v-progress-linear': true, 'v-progress-circular': true, 'v-tooltip': true },
  });
  views.push(wrapper);
  return wrapper;
}
async function settle() { for (let i = 0; i < 10; i++) { await Promise.resolve(); await nextTick(); } }
function state(wrapper: Wrapper<Vue>): SetupState {
  return (wrapper.vm as unknown as { _setupState: SetupState })._setupState;
}
function button(wrapper: Wrapper<Vue>, text: string) {
  const found = wrapper.findAll('button').wrappers.find((entry) => entry.text().includes(text));
  if (!found) throw new Error(`Missing button ${text}`);
  return found;
}
beforeEach(() => { review.live.dustBalance.value = 0n; review.live.settled.value = true; review.sponsorId = null; });
afterEach(() => { views.splice(0).forEach((wrapper) => wrapper.destroy()); });

describe.each([['dashboard', Dialog], ['side panel', Sheet]] as const)('%s send wiring', (surface, component) => {
  it('renders warning and picker on unverified zero and permits proceeding without a sponsor', async () => {
    const wrapper = mountScreen(component);
    const setup = state(wrapper);
    setup.recipient.value = 'mn_addr1destination';
    setup.amount.value = '1';
    if (surface === 'side panel') setup.step.value = 2;
    await settle();
    expect(wrapper.text()).toContain('midnight.send.noDustFee');
    expect(wrapper.find('[data-sponsor-picker]').exists()).toBe(true);
    expect(setup.sponsorWalletId.value).toBeNull();
    const next = button(wrapper, surface === 'dashboard' ? 'common.continue' : 'miniGero.review');
    expect(next.attributes('disabled')).toBeUndefined();
    await next.trigger('click');
    await settle();
    expect(surface === 'dashboard' ? setup.currentStep.value : setup.step.value).toBe(surface === 'dashboard' ? 2 : 3);
  });

  it('restores a saved sponsor and lets the picker clear it while the zero stays unverified', async () => {
    review.sponsorId = 2;
    const wrapper = mountScreen(component);
    await settle();
    const picker = wrapper.findComponent({ name: 'ReviewSponsorPicker' });
    expect(picker.props('value')).toBe(2);
    picker.vm.$emit('input', null);
    await settle();
    expect(state(wrapper).sponsorWalletId.value).toBeNull();
    expect(state(wrapper).blockedByFee.value).toBe(false);
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
