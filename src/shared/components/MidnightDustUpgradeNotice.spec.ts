import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import MidnightDustUpgradeNotice from './MidnightDustUpgradeNotice.vue';
import { claimDustUpgradeNotice, walletPredatesMainnetDustReset } from '@/chains/midnight/midnightDustUpgradeNotice';

vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
beforeEach(() => localStorage.clear());

function render(network: 'mainnet' | 'preprod', address: string) {
  return mount(MidnightDustUpgradeNotice, { props: { network, address }, global: {
    stubs: { VAlert: { template: '<aside><slot /></aside>' }, GButton: { template: '<button><slot /></button>' } },
  } });
}

describe('ledger 9 DUST notices', () => {
  it('shows each notice once per wallet on its own network', async () => {
    const view = render('preprod', 'first');
    expect(view.text()).toContain('midnight.dustUpgrade.nativeCleared');
    await view.get('button').trigger('click');
    expect(view.text()).toBe('');
    view.unmount();
    expect(render('preprod', 'first').text()).toBe('');
    expect(render('preprod', 'second').text()).toContain('midnight.dustUpgrade.nativeCleared');
    expect(render('mainnet', 'first').text()).toContain('midnight.dustUpgrade.cnightRefill');
    vi.resetModules();
    const reopened = await import('@/chains/midnight/midnightDustUpgradeNotice');
    expect(reopened.claimDustUpgradeNotice('mainnet', 'first')).toBe(false);
  });

  it('requires an address and remembers the notice for the session when storage is unavailable', () => {
    const unavailable = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unavailable'); });
    try {
      expect(claimDustUpgradeNotice('mainnet', '')).toBe(false);
      expect(claimDustUpgradeNotice('mainnet', 'blocked-storage')).toBe(true);
      expect(claimDustUpgradeNotice('mainnet', 'blocked-storage')).toBe(false);
    } finally { unavailable.mockRestore(); }
  });

  it('qualifies an older wallet or restored wallet with confirmed pre-upgrade history', () => {
    expect(walletPredatesMainnetDustReset('2026-11-01', [])).toBe(true);
    const before = 1_792_000_000;
    expect(walletPredatesMainnetDustReset('2026-11-23', [{ status: 'confirmed', timestamp: before }])).toBe(true);
    expect(walletPredatesMainnetDustReset('2026-11-23', [{ status: 'pending', timestamp: before }])).toBe(false);
    expect(walletPredatesMainnetDustReset(undefined, [{ status: 'confirmed', timestamp: 0 }])).toBe(false);
  });
});
