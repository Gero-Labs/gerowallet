import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { reactive } from 'vue';

const wallet = vi.hoisted(() => ({ loggedWallet: { chain: 'Midnight', network: 'Stagenet' } as { chain: string; network: string } | null }));
vi.mock('@/stores/walletStore', () => ({ walletStore: reactive(wallet) }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

// @ts-ignore: tsconfig ships no `*.vue` shim; vite resolves this fine.
import MidnightNoticeSlot from './MidnightNoticeSlot.vue';
import { MAX_NOTICES, MIDNIGHT_NOTICE_ORDER, visibleMidnightNotices } from './midnightNotices';
import { noteMidnightNetworkUpgrading, noteMidnightUpdateRequired, resetMidnightWriteGateForTests } from '@/chains/midnight/midnightWriteGate';
import { walletStore } from '@/stores/walletStore';

const stubs = { 'v-icon': true, GButton: { template: '<button><slot /></button>' } };
const setWallet = (network: string) => {
  (walletStore as { loggedWallet: { chain: string; network: string } | null }).loggedWallet = { chain: 'Midnight', network };
};

beforeEach(() => {
  resetMidnightWriteGateForTests();
  setWallet('Stagenet');
});

describe('Midnight notice slot', () => {
  it('ranks the notices and shows at most two', () => {
    const all = Object.fromEntries(MIDNIGHT_NOTICE_ORDER.map((id) => [id, true]));
    expect(visibleMidnightNotices(all)).toEqual(MIDNIGHT_NOTICE_ORDER.slice(0, MAX_NOTICES));
    expect(MAX_NOTICES).toBe(2);
    expect(visibleMidnightNotices({ stagenet: true })).toEqual(['stagenet']);
    expect(visibleMidnightNotices({})).toEqual([]);
  });

  it('the network upgrade comes before the Stagenet notice', async () => {
    await noteMidnightNetworkUpgrading('Stagenet', 'status');
    const w = mount(MidnightNoticeSlot, { global: { stubs } });
    await flushPromises();
    const order = w.findAll('[data-test]').map((el) => el.attributes('data-test')).filter((id) => id !== 'midnight-notice-slot');
    expect(order.indexOf('midnight-upgrade-banner')).toBeLessThan(order.indexOf('midnight-stagenet-notice'));
  });

  it('update required comes first and replaces the network upgrade banner', async () => {
    await noteMidnightNetworkUpgrading('Stagenet', 'status');
    await noteMidnightUpdateRequired('Stagenet', 'response');
    const w = mount(MidnightNoticeSlot, { props: { layout: 'panel' }, global: { stubs } });
    await flushPromises();
    const ids = w.findAll('[data-test]').map((el) => el.attributes('data-test'));
    expect(ids).toContain('midnight-update-banner');
    expect(ids).not.toContain('midnight-upgrade-banner');
    expect(ids.indexOf('midnight-update-banner')).toBeLessThan(ids.indexOf('midnight-stagenet-notice'));
  });

  it('renders nothing when no notice applies, so a parent spacing class takes no room', () => {
    setWallet('Preprod');
    const w = mount(MidnightNoticeSlot, { attrs: { class: 'slot' }, global: { stubs } });
    expect(w.find('.slot').exists()).toBe(false);
  });
});
