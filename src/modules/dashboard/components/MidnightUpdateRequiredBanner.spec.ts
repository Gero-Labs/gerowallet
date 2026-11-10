import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { reactive } from 'vue';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const wallet = vi.hoisted(() => ({ loggedWallet: { network: 'Mainnet' } as { network: string } | null }));
vi.mock('@/stores/walletStore', () => ({ walletStore: reactive(wallet) }));
vi.mock('@/shared/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string, args?: Record<string, string>) => (args?.['version'] ? `${k}:${args['version']}` : k) }),
}));

// @ts-ignore: tsconfig ships no `*.vue` shim; vite resolves this fine.
import MidnightUpdateRequiredBanner from './MidnightUpdateRequiredBanner.vue';
// @ts-ignore: tsconfig ships no `*.vue` shim; vite resolves this fine.
import MidnightNetworkUpgradeBanner from './MidnightNetworkUpgradeBanner.vue';
import {
  noteMidnightNetworkUpgrading, noteMidnightUpdateRequired, noteMidnightWritesOpen, resetMidnightWriteGateForTests,
} from '@/chains/midnight/midnightWriteGate';

const stubs = {
  'v-icon': true,
  GButton: { props: ['tier', 'loading', 'block'], emits: ['click'], template: '<button :data-tier="tier" :data-loading="loading" :data-block="block" @click="$emit(\'click\')"><slot /></button>' },
};
const runtime: Record<string, unknown> = {};

beforeEach(() => {
  resetMidnightWriteGateForTests();
  for (const key of Object.keys(runtime)) delete runtime[key];
  runtime['getManifest'] = () => ({ version: '2.8.4' });
  vi.stubGlobal('chrome', { runtime });
});
afterEach(() => vi.unstubAllGlobals());

const mountBanner = async (props: Record<string, unknown> = {}) => {
  const w = mount(MidnightUpdateRequiredBanner, { props, global: { stubs } });
  await flushPromises();
  return w;
};

describe('"Update required" banner', () => {
  it('is hidden while this build can send', async () => {
    const w = await mountBanner();
    expect(w.find('[data-test="midnight-update-banner"]').exists()).toBe(false);
  });

  it('shows the update sentence and the installed version, and goes when the state clears', async () => {
    await noteMidnightUpdateRequired('Mainnet', 'status', { minVersion: '2.9.0' });
    const w = await mountBanner();
    const banner = w.get('[data-test="midnight-update-banner"]');
    expect(banner.text()).toContain('midnight.errors.updateRequired');
    expect(w.get('[data-test="midnight-update-version"]').text()).toBe('midnight.update.installedVersion:2.8.4');
    expect(banner.attributes('role')).toBe('status');

    await noteMidnightWritesOpen('Mainnet');
    await flushPromises();
    expect(w.find('[data-test="midnight-update-banner"]').exists()).toBe(false);
  });

  it('takes precedence: the network upgrade banner hides while it shows', async () => {
    await noteMidnightNetworkUpgrading('Mainnet', 'status');
    await noteMidnightUpdateRequired('Mainnet', 'response');
    const update = await mountBanner();
    const upgrade = mount(MidnightNetworkUpgradeBanner, { global: { stubs } });
    await flushPromises();
    expect(update.find('[data-test="midnight-update-banner"]').exists()).toBe(true);
    expect(upgrade.find('[data-test="midnight-upgrade-banner"]').exists()).toBe(false);
  });

  it('Check for update: no update yet says so, once, in a polite live region', async () => {
    runtime['requestUpdateCheck'] = (cb: (s: string) => void) => cb('no_update');
    await noteMidnightUpdateRequired('Mainnet', 'response');
    const w = await mountBanner();
    const outcome = w.get('[data-test="midnight-update-outcome"]');
    expect(outcome.attributes('aria-live')).toBe('polite');
    expect(outcome.text()).toBe('');
    await w.get('[data-test="midnight-update-check"]').trigger('click');
    await flushPromises();
    expect(outcome.text()).toBe('midnight.update.noneYet');
    // The check can be asked again later.
    expect(w.find('[data-test="midnight-update-check"]').exists()).toBe(true);
  });

  it('Check for update: an update found offers the restart, which reloads the extension', async () => {
    const reload = vi.fn();
    runtime['requestUpdateCheck'] = (cb: (s: string) => void) => cb('update_available');
    runtime['reload'] = reload;
    await noteMidnightUpdateRequired('Mainnet', 'response');
    const w = await mountBanner({ block: true });
    await w.get('[data-test="midnight-update-check"]').trigger('click');
    await flushPromises();
    const restart = w.get('[data-test="midnight-update-restart"]');
    expect(restart.text()).toBe('midnight.update.restart');
    expect(restart.attributes('data-tier')).toBe('primary');
    expect(restart.attributes('data-block')).toBe('true');
    expect(w.find('[data-test="midnight-update-check"]').exists()).toBe(false);
    await restart.trigger('click');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('where the browser cannot check, the text stands alone', async () => {
    await noteMidnightUpdateRequired('Mainnet', 'response');
    const w = await mountBanner();
    expect(w.find('[data-test="midnight-update-banner"]').exists()).toBe(true);
    expect(w.find('[data-test="midnight-update-check"]').exists()).toBe(false);
  });

  it('is mounted on the Midnight dashboard and the side panel home, beside the upgrade banner', () => {
    const src = join(__dirname, '../../..');
    const page = readFileSync(join(src, 'modules/portfolio/PortfolioPage.vue'), 'utf8');
    const home = readFileSync(join(src, 'sidepanel/pages/HomePage.vue'), 'utf8');
    expect(page).toContain('<MidnightUpdateRequiredBanner class="portfolio-upgrade-banner" />');
    expect(home).toContain('<MidnightUpdateRequiredBanner v-if="isMidnight" block class="home-upgrade-banner" />');
    expect(home.indexOf('<MidnightUpdateRequiredBanner')).toBeLessThan(home.indexOf('<BalanceSection'));
    // Send held for either reason; the line under it says "update" when that is the reason.
    expect(home).toContain('const midnightSendPaused = computed(() => midnightWriteBlock.value !== null);');
    expect(home).toContain("? t('midnight.update.sendHeld')");
  });
});
