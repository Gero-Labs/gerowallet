import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { reactive } from 'vue';

const wallet = vi.hoisted(() => ({ loggedWallet: { network: 'Preprod' } as { network: string } | null }));
vi.mock('@/stores/walletStore', () => ({ walletStore: reactive(wallet) }));
vi.mock('@/shared/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string, args?: Record<string, string>) => (args?.['network'] ? `${k}:${args['network']}` : k) }),
}));

// @ts-ignore: tsconfig ships no `*.vue` shim; vite resolves this fine.
import MidnightNetworkUpgradeBanner from './MidnightNetworkUpgradeBanner.vue';
import { noteMidnightNetworkUpgrading, noteMidnightWritesOpen, resetMidnightWriteGateForTests } from '@/chains/midnight/midnightWriteGate';
import { walletStore } from '@/stores/walletStore';

const stubs = { 'v-icon': true };

beforeEach(() => {
  resetMidnightWriteGateForTests();
  (walletStore as { loggedWallet: { network: string } | null }).loggedWallet = { network: 'Preprod' };
});

describe('Midnight network upgrade banner', () => {
  it('is hidden while sends are open', () => {
    const w = mount(MidnightNetworkUpgradeBanner, { global: { stubs } });
    expect(w.find('[data-test="midnight-upgrade-banner"]').exists()).toBe(false);
  });

  it('shows the title, the sentence naming the network, and Learn more while paused, then goes', async () => {
    await noteMidnightNetworkUpgrading('Preprod', 'response');
    const w = mount(MidnightNetworkUpgradeBanner, { global: { stubs } });
    await flushPromises();
    const banner = w.find('[data-test="midnight-upgrade-banner"]');
    expect(banner.text()).toContain('midnight.upgrade.title');
    expect(banner.text()).toContain('midnight.errors.networkUpgrading:Midnight Preprod');
    expect(banner.find('a').attributes('href')).toBe('https://midnight.network/blog');
    expect(banner.find('a').attributes('rel')).toContain('noopener');

    await noteMidnightWritesOpen('Preprod');
    await flushPromises();
    expect(w.find('[data-test="midnight-upgrade-banner"]').exists()).toBe(false);
  });

  it('is per network', async () => {
    await noteMidnightNetworkUpgrading('Mainnet', 'status');
    const w = mount(MidnightNetworkUpgradeBanner, { global: { stubs } });
    await flushPromises();
    expect(w.find('[data-test="midnight-upgrade-banner"]').exists()).toBe(false);
  });
});
