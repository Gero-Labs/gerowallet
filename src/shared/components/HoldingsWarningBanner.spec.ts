import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestVuetify } from '@test/helpers/vuetify';
import i18n, { i18nPlugin } from '@/plugins/i18n';

vi.mock('@/stores/walletStore', async () => ({
  walletStore: (await import('vue')).reactive({ loggedWallet: null as unknown, holdingsWarning: null as unknown }),
}));

import { walletStore } from '@/stores/walletStore';
import HoldingsWarningBanner from './HoldingsWarningBanner.vue';

enableAutoUnmount(afterEach);
const render = () => mount(HoldingsWarningBanner, { global: { plugins: [createTestVuetify(), i18nPlugin] } });

describe('HoldingsWarningBanner', () => {
  beforeEach(() => {
    walletStore.loggedWallet = { id: 7, chain: 'Cardano', network: 'Mainnet' };
    walletStore.holdingsWarning = null;
  });

  it('says nothing while the holdings check has found nothing', () => {
    expect(render().find('[data-testid="holdings-warning"]').exists()).toBe(false);
  });

  it('warns about the logged wallet, with the total the chain shows', () => {
    walletStore.holdingsWarning = { walletId: 7, chainTotal: '70066389' };
    const banner = render().get('[data-testid="holdings-warning"]');
    expect(banner.text()).toContain(String(i18n.t('holdingsCheck.title')));
    expect(banner.get('[data-testid="holdings-warning-chain-total"]').text())
      .toBe(String(i18n.t('holdingsCheck.chainTotal', { amount: '70.066389 ADA' })));
  });

  it('never shows a warning raised for another wallet', () => {
    walletStore.holdingsWarning = { walletId: 8, chainTotal: null };
    expect(render().find('[data-testid="holdings-warning"]').exists()).toBe(false);
  });
});
