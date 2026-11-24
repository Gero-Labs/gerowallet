import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { reactive } from 'vue';

type LoggedWallet = { id: number; chain: string; network: string };
const wallet = vi.hoisted(() => ({
  loggedWallet: { id: 7, chain: 'Midnight', network: 'Preview' } as LoggedWallet | null,
  config: { midnightPreviewMoveNotice: true } as Record<string, unknown>,
}));
vi.mock('@/stores/walletStore', () => ({ walletStore: reactive(wallet) }));
vi.mock('@/db/wallet-db', () => ({ setWalletConfiguration: vi.fn(async () => undefined) }));
// Preview is read-only in GeroWallet today (midnightConfig.ts), so no write
// banner shows there. The precedence cases make its writes open, as they will
// be once Nexus opens them; the read-only case keeps the real capability.
const caps = vi.hoisted(() => ({ previewWritable: false }));
vi.mock('@/chains/midnight/midnightConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/chains/midnight/midnightConfig')>();
  return { ...actual, isMidnightReadOnlyNetwork: (network: string) => !caps.previewWritable && actual.isMidnightReadOnlyNetwork(network) };
});
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

// @ts-ignore: tsconfig ships no `*.vue` shim; vite resolves this fine.
import MidnightNoticeSlot from './MidnightNoticeSlot.vue';
import { MAX_NOTICES, MIDNIGHT_NOTICE_ORDER, visibleMidnightNotices } from './midnightNotices';
import { noteMidnightNetworkUpgrading, noteMidnightUpdateRequired, resetMidnightWriteGateForTests } from '@/chains/midnight/midnightWriteGate';
import { walletStore } from '@/stores/walletStore';

const stubs = { 'v-icon': true, GButton: { template: '<button><slot /></button>' } };
const setWallet = (network: string, moved = true) => {
  const store = walletStore as unknown as { loggedWallet: LoggedWallet | null; config: Record<string, unknown> };
  store.loggedWallet = { id: 7, chain: 'Midnight', network };
  store.config = { midnightPreviewMoveNotice: moved };
};

beforeEach(() => {
  resetMidnightWriteGateForTests();
  caps.previewWritable = false;
  setWallet('Preview');
});

describe('Midnight notice slot', () => {
  it('ranks the notices and shows at most two', () => {
    const all = Object.fromEntries(MIDNIGHT_NOTICE_ORDER.map((id) => [id, true]));
    expect(visibleMidnightNotices(all)).toEqual(MIDNIGHT_NOTICE_ORDER.slice(0, MAX_NOTICES));
    expect(MAX_NOTICES).toBe(2);
    expect(visibleMidnightNotices({ previewMove: true })).toEqual(['previewMove']);
    expect(visibleMidnightNotices({})).toEqual([]);
  });

  it('the network upgrade comes before the moved-to-Preview notice', async () => {
    caps.previewWritable = true;
    await noteMidnightNetworkUpgrading('Preview', 'status');
    const w = mount(MidnightNoticeSlot, { global: { stubs } });
    await flushPromises();
    const order = w.findAll('[data-test]').map((el) => el.attributes('data-test')).filter((id) => id !== 'midnight-notice-slot');
    expect(order.indexOf('midnight-upgrade-banner')).toBeGreaterThan(-1);
    expect(order.indexOf('midnight-preview-move-notice')).toBeGreaterThan(-1);
    expect(order.indexOf('midnight-upgrade-banner')).toBeLessThan(order.indexOf('midnight-preview-move-notice'));
  });

  it('update required comes first and replaces the network upgrade banner', async () => {
    caps.previewWritable = true;
    await noteMidnightNetworkUpgrading('Preview', 'status');
    await noteMidnightUpdateRequired('Preview', 'response');
    const w = mount(MidnightNoticeSlot, { props: { layout: 'panel' }, global: { stubs } });
    await flushPromises();
    const ids = w.findAll('[data-test]').map((el) => el.attributes('data-test'));
    expect(ids).toContain('midnight-update-banner');
    expect(ids).not.toContain('midnight-upgrade-banner');
    expect(ids.indexOf('midnight-preview-move-notice')).toBeGreaterThan(-1);
    expect(ids.indexOf('midnight-update-banner')).toBeLessThan(ids.indexOf('midnight-preview-move-notice'));
  });

  it('a read-only Preview wallet shows no write banner: reading is all it can do, whatever the server noted', async () => {
    await noteMidnightNetworkUpgrading('Preview', 'status');
    await noteMidnightUpdateRequired('Preview', 'response');
    const w = mount(MidnightNoticeSlot, { global: { stubs } });
    await flushPromises();
    const ids = w.findAll('[data-test]').map((el) => el.attributes('data-test'));
    expect(ids).not.toContain('midnight-upgrade-banner');
    expect(ids).not.toContain('midnight-update-banner');
    expect(ids).toContain('midnight-preview-move-notice');
  });

  it.each([['Preprod', true], ['Preview', false]] as const)(
    'renders nothing when no notice applies (%s, moved: %s), so a parent spacing class takes no room', (network, moved) => {
      setWallet(network, moved);
      const w = mount(MidnightNoticeSlot, { attrs: { class: 'slot' }, global: { stubs } });
      expect(w.find('.slot').exists()).toBe(false);
    });
});
