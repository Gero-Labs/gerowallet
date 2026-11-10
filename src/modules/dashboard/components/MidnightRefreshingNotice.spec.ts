import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, nextTick, reactive } from 'vue';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
const wallet = vi.hoisted(() => ({ loggedWallet: { chain: 'Midnight', network: 'Mainnet' } }));
vi.mock('@/stores/walletStore', () => ({ walletStore: reactive(wallet) }));

// @ts-ignore: tsconfig ships no `*.vue` shim; vite resolves this fine.
import MidnightRefreshingNotice from './MidnightRefreshingNotice.vue';
// @ts-ignore: tsconfig ships no `*.vue` shim; vite resolves this fine.
import MidnightNoticeSlot from './MidnightNoticeSlot.vue';
import { midnightStore } from '@/stores/midnightStore';
import type { MidnightRefreshSnapshot } from '@/chains/midnight/midnightRefresh';
import { useMidnightSendHold } from '@/shared/composables/useMidnightSendHold';
import { noteMidnightNetworkUpgrading, noteMidnightUpdateRequired, resetMidnightWriteGateForTests } from '@/chains/midnight/midnightWriteGate';

const stubs = { 'v-icon': true, GButton: { template: '<button><slot /></button>' } };
const SNAPSHOT: MidnightRefreshSnapshot = {
  balances: { shieldedTokens: {}, nightShielded: 0n, nightUnshielded: 5n, nightRegistered: 0n, dust: 0n, dustGenerating: 0n },
  transactions: [], utxos: [], dustState: null, tip: { hash: 'h', height: 10, timestamp: 1 },
};
const refreshing = (extra: Partial<NonNullable<typeof midnightStore.refreshing>> = {}) => {
  midnightStore.refreshSnapshot = SNAPSHOT;
  midnightStore.refreshing = { startedAt: 1, reason: null, stalled: false, progress: null, ...extra };
};

beforeEach(() => {
  resetMidnightWriteGateForTests();
  midnightStore.refreshSnapshot = null;
  midnightStore.refreshing = null;
});

describe('Refreshing notice', () => {
  it('renders nothing when no rebuild runs', () => {
    const w = mount(MidnightRefreshingNotice, { attrs: { class: 'slot' }, global: { stubs } });
    expect(w.find('.slot').exists()).toBe(false);
  });

  it('says why when the server said it was the network upgrade, and the plain sentence otherwise', async () => {
    refreshing();
    const w = mount(MidnightRefreshingNotice, { global: { stubs } });
    expect(w.get('[data-test="midnight-refreshing-text"]').text()).toBe('midnight.refresh.inProgress');
    midnightStore.refreshing = { ...midnightStore.refreshing!, reason: 'upgrade' };
    await nextTick();
    expect(w.get('[data-test="midnight-refreshing-text"]').text()).toBe('midnight.refresh.afterUpgrade');
  });

  it('shows progress only when the sync reports it; the card itself is no live region', async () => {
    refreshing();
    const w = mount(MidnightRefreshingNotice, { global: { stubs } });
    expect(w.find('[role="progressbar"]').exists()).toBe(false);
    midnightStore.refreshing = { ...midnightStore.refreshing!, progress: 42 };
    await nextTick();
    expect(w.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('42');
    expect(w.text()).toContain('42%');
    expect(w.find('[aria-live]').exists()).toBe(false);
    expect(w.find('[role="status"]').exists()).toBe(false);
  });

  it('stalled: "Still refreshing. Check your connection.", on the warning pair, no progress', async () => {
    refreshing({ stalled: true, progress: 42 });
    const w = mount(MidnightRefreshingNotice, { global: { stubs } });
    expect(w.get('[data-test="midnight-refreshing-text"]').text()).toBe('midnight.refresh.stalled');
    expect(w.find('[role="progressbar"]').exists()).toBe(false);
    expect(w.get('[data-test="midnight-refreshing"]').classes()).toContain('refresh-notice--stalled');
    expect(w.get('[data-test="midnight-refreshing"]').classes()).not.toContain('glass-panel');
  });
});

describe('the notice slot during a refresh', () => {
  it('keeps one live region mounted before the refresh, and says its start once', async () => {
    const w = mount(MidnightNoticeSlot, { global: { stubs } });
    const region = w.get('[data-test="midnight-notice-announcer"]');
    expect(region.attributes('role')).toBe('status');
    expect(region.text()).toBe('');
    refreshing({ reason: 'upgrade' });
    await flushPromises();
    expect(w.get('[data-test="midnight-notice-announcer"]').text()).toBe('midnight.refresh.afterUpgrade');
    // A progress tick says nothing new.
    midnightStore.refreshing = { ...midnightStore.refreshing!, progress: 50 };
    await flushPromises();
    expect(w.get('[data-test="midnight-notice-announcer"]').text()).toBe('midnight.refresh.afterUpgrade');
  });

  it('shows refreshing after update required and the upgrade, at most two', async () => {
    refreshing();
    await noteMidnightUpdateRequired('Mainnet', 'response');
    const w = mount(MidnightNoticeSlot, { global: { stubs } });
    await flushPromises();
    const shown = w.findAll('[data-test="midnight-update-banner"], [data-test="midnight-refreshing"]').map((el) => el.attributes('data-test'));
    expect(shown).toEqual(['midnight-update-banner', 'midnight-refreshing']);
  });
});

describe('one reason Send and Register are held', () => {
  const Probe = defineComponent({
    setup() { return useMidnightSendHold(() => 'Mainnet'); },
    template: '<i />',
  });

  it('update required, then the upgrade, then refreshing', async () => {
    const w = mount(Probe);
    const vm = w.vm as unknown as { hold: string | null; sendText: string; registrationText: string; icon: string };
    expect(vm.hold).toBeNull();
    refreshing();
    await nextTick();
    expect([vm.hold, vm.sendText, vm.icon]).toEqual(['refreshing', 'midnight.refresh.sendHeld', 'mdi-refresh']);
    await noteMidnightNetworkUpgrading('Mainnet', 'status');
    await flushPromises();
    expect(vm.hold).toBe('networkUpgrading');
    await noteMidnightUpdateRequired('Mainnet', 'response');
    await flushPromises();
    expect([vm.hold, vm.sendText, vm.registrationText]).toEqual(['updateRequired', 'midnight.errors.updateRequired', 'midnight.update.registrationHeld']);
  });
});

describe('Refreshing wiring', () => {
  const src = join(__dirname, '../../..');
  const read = (path: string) => readFileSync(join(src, path), 'utf8');

  it('greys value containers with the one .g-stale utility, never the controls', () => {
    const page = read('modules/portfolio/PortfolioPage.vue');
    expect(page).toContain(`<v-row no-gutters class="hero-row" :class="{ 'g-stale': midnightRefreshing }">`);
    expect(page).toContain(`<v-col cols="12" sm="6" class="pa-2" :class="{ 'g-stale': midnightRefreshing }">\n          <MidnightDustGauge`);
    expect(page).toContain(`<MidnightHoldingsTable :class="{ 'g-stale': midnightRefreshing }" />`);
    expect(page).not.toMatch(/g-stale[^\n]*\n[^\n]*MidnightProofServerWidget/);
    const home = read('sidepanel/pages/HomePage.vue');
    expect(home).toContain(`<MiniDustGauge v-if="isMidnight" :class="{ 'g-stale': midnightRefreshing }" />`);
    expect(read('shared/styles/baseline.css')).toContain('.g-stale {');
    expect(read('modules/dashboard/components/MidnightPortfolioChart.vue')).toContain('data-test="midnight-refresh-caption"');
    expect(read('sidepanel/components/BalanceSection.vue')).toContain('data-test="midnight-refresh-caption"');
  });

  it('every held Send and Register reads the one hold, and the side panel says it once under Send', () => {
    for (const file of ['modules/dashboard/dialogs/MidnightSendDialog.vue', 'sidepanel/components/flows/MidnightSendSheet.vue', 'modules/dashboard/dialogs/DustRegistrationDialog.vue']) {
      expect(read(file)).toContain('const sendHold = useMidnightSendHold(() => loggedWallet.value?.network);');
    }
    const home = read('sidepanel/pages/HomePage.vue');
    expect(home).toContain(':disabled-ids="midnightSendPaused ? [\'send\'] : []"');
    expect(home.match(/ id="home-send-paused"/g)).toHaveLength(1);
    expect(home).toContain(':described-by="midnightSendPaused ? \'home-send-paused\' : undefined"');
    expect(home).toContain('const midnightSendPaused = midnightSendHold.held;');
  });
});
