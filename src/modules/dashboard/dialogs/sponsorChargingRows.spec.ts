import { mount, type VueWrapper } from '@vue/test-utils';
import * as Vue from 'vue';
import { nextTick } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sponsorStateFromDestination, type SponsorCandidate } from '@/chains/midnight/midnightSponsorEligibility';

// A wallet a live registration pays into, holding 0.3 DUST: under the 1 DUST a
// ledger 9 send can need, so it is charging (relaying with a known capacity),
// not ready, and never selectable.
const DUST = 10n ** 15n;
const stake = [{ cardanoRewardAddress: 'stake1a', state: 'active' }];
const ref = (id: number, name: string) => ({ id, name, network: 'Mainnet', dustAddress: `mn_dust1${name.toLowerCase()}` });
const charging = sponsorStateFromDestination(ref(2, 'Low'), {
  registered: true, currentCapacity: String((3n * DUST) / 10n), maxCapacity: String(2n * DUST), stakes: stake,
});
const ready = sponsorStateFromDestination(ref(3, 'Full'), {
  registered: true, currentCapacity: String(5n * DUST), maxCapacity: String(10n * DUST), stakes: stake,
});
const pending = sponsorStateFromDestination(ref(4, 'Pending'), {
  registered: false, stakes: [{ cardanoRewardAddress: 'stake1b', state: 'relaying' }],
});

const lookup = vi.hoisted(() => ({ candidates: [] as SponsorCandidate[] }));
vi.mock('@/chains/midnight/midnightSponsorLookup', () => ({
  loadSponsorCandidates: async () => ({ candidates: lookup.candidates, lookupIncomplete: false }),
}));
vi.mock('@/chains/midnight/midnightSponsorLinks', () => ({
  loadSponsorLinks: async () => ({ 1: { walletId: 1, sponsorWalletId: 2, sponsorName: 'Low', network: 'Mainnet', at: 0 } }),
  saveSponsorLink: vi.fn(), clearSponsorLink: vi.fn(),
}));
vi.mock('@/stores/geroStore', () => ({ geroStore: { wallets: {} } }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/shared/dialogs/BaseDialog.vue', () => ({
  default: { render(this: Vue.ComponentPublicInstance) { return Vue.h('div', this.$slots['default']?.()); } },
}));

import Picker from './MidnightSponsorPicker.vue';
import FeeWalletDialog from './MidnightFeeWalletDialog.vue';

const views: VueWrapper[] = [];
afterEach(() => { views.splice(0).forEach((view) => view.unmount()); });
async function settle() { for (let i = 0; i < 10; i++) { await Promise.resolve(); await nextTick(); } }
const stubs = { 'v-icon': true, 'v-tooltip': true, GButton: { template: '<button><slot /></button>' } };

describe('a sponsor short of a fee', () => {
  it('is charging, not ready, with its capacity kept', () => {
    expect(charging.state).toBe('relaying');
    expect(charging.capacity).toBe((3n * DUST) / 10n);
    expect(ready.state).toBe('ready');
  });

  it('shows as Charging in the send picker, disabled, and a saved choice of it is cleared', async () => {
    lookup.candidates = [ready, charging, pending];
    const wrapper = mount(Picker, { props: { modelValue: 2, senderWalletId: 1, network: 'Mainnet' }, global: { stubs } });
    views.push(wrapper);
    await settle();
    const rows = wrapper.findAll('button.sponsor-row');
    expect(rows.map((row) => row.attributes('disabled') !== undefined)).toEqual([false, true, true]);
    expect(rows[1].text()).toContain('midnight.sponsor.charging');
    expect(rows[1].text()).not.toContain('midnight.sponsor.relaying');
    // A registration still on Cardano keeps "Registering, not ready yet".
    expect(rows[2].text()).toContain('midnight.sponsor.relaying');
    expect(wrapper.emitted('update:modelValue')).toEqual([[null]]);
  });

  // The send screen restores a saved sponsor after the picker's lookup may already
  // have answered: the picker must still drop it when it can't pay.
  it('clears a saved charging sponsor written after the lookup answered', async () => {
    lookup.candidates = [ready, charging, pending];
    const wrapper = mount(Picker, { props: { modelValue: null, senderWalletId: 1, network: 'Mainnet' }, global: { stubs } });
    views.push(wrapper);
    await settle();
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    await wrapper.setProps({ modelValue: 2 });
    await settle();
    expect(wrapper.emitted('update:modelValue')).toEqual([[null]]);
    // A ready sponsor written the same way stays.
    await wrapper.setProps({ modelValue: 3 });
    await settle();
    expect(wrapper.emitted('update:modelValue')).toEqual([[null]]);
  });

  it('is listed under Charging with its balance in the fee-wallet dialog, not as unchecked', async () => {
    lookup.candidates = [ready, charging, pending];
    const wrapper = mount(FeeWalletDialog, {
      props: { isOpen: true, walletId: 1, walletName: 'Sender', network: 'Mainnet' }, global: { stubs },
    });
    views.push(wrapper);
    await settle();
    const groups = wrapper.findAll('.fwd-group').map((group) => group.text());
    expect(groups).toEqual(['midnight.sponsor.groupWithDust', 'midnight.sponsor.charging', 'midnight.sponsor.notChecked']);
    const off = wrapper.findAll('.fwd-row--off');
    expect(off).toHaveLength(2);
    expect(off[0].text()).toContain('Low');
    expect(off[0].text()).toContain('0.3000 DUST');
    expect(off[1].text()).toContain('Pending');
    expect(off[1].text()).toContain('midnight.sponsor.unlockToCheck');
    // The saved link points at the charging wallet, which can't pay now: nothing is pre-selected.
    expect(wrapper.find('.fwd-row--sel').exists()).toBe(false);
  });
});
