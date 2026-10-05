import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import GuideSfc from './RealFiGettingStarted.vue';

// test-utils v1's mount() typings predate <script setup> components.
const Guide = GuideSfc as unknown as Parameters<typeof mount>[0];

const BASE = {
  mainnet: true,
  hasUsdr: false,
  canStake: true,
  canStakeExternally: false,
  canAcquire: true,
  canSwapUsdrf: true,
  hasUsdcx: false,
  usdcxLabel: '',
  swapStatus: 'available',
  canRetryAvailability: false,
};

function mountGuide(props: Partial<typeof BASE> = {}) {
  return mount(Guide, {
    propsData: { ...BASE, ...props },
    mocks: {
      $t: (key: string, values?: Record<string, unknown>) =>
        values ? `${key}${JSON.stringify(values)}` : key,
    },
    stubs: { 'v-btn': { template: '<button @click="$emit(\'click\')"><slot /></button>' } },
  });
}

type Guide = ReturnType<typeof mountGuide>;

/** Step 2's buttons, in order, as "label (tier)". */
function acquireButtons(guide: Guide): string[] {
  return guide.findAll('.realfi-getting-started__actions button').wrappers.map((b) => {
    const tier = ['primary', 'secondary', 'tertiary'].find((t) => b.classes(`g-btn--${t}`));
    return `${b.text()} (${tier})`;
  });
}

describe('RealFiGettingStarted: getting USDrf', () => {
  it('without USDCx, recommends swapping ADA for USDCx first, then USDCx for USDrf', () => {
    const guide = mountGuide();
    expect(guide.text()).toContain('realfi.gettingStarted.needUsdcx');
    expect(acquireButtons(guide)).toEqual([
      'realfi.gettingStarted.getUsdcx (secondary)',
      'realfi.gettingStarted.getUsdrf (tertiary)',
    ]);
    // Both swaps are offered, so say they are separate and USDCx has to land first.
    expect(guide.text()).toContain('realfi.gettingStarted.getUsdcxNote');
  });

  it('with USDCx, says how much and leads with the USDrf swap', async () => {
    const guide = mountGuide({ hasUsdcx: true, usdcxLabel: '12.50 USDCx' });
    expect(guide.text()).toContain('realfi.gettingStarted.haveUsdcx{"amount":"12.50 USDCx"}');
    expect(guide.text()).not.toContain('realfi.gettingStarted.needUsdcx');
    expect(acquireButtons(guide)).toEqual([
      'realfi.gettingStarted.getUsdrf (secondary)',
      'realfi.gettingStarted.getUsdcx (tertiary)',
    ]);
    expect(guide.text()).not.toContain('realfi.gettingStarted.getUsdcxNote');
    await guide.findAll('.realfi-getting-started__actions button').at(0).trigger('click');
    expect(guide.emitted('get-usdrf')).toHaveLength(1);
  });

  it("with USDCx but no USDrf swap in Gero yet, points to RealFi's app", async () => {
    const guide = mountGuide({ hasUsdcx: true, usdcxLabel: '12.50 USDCx', canSwapUsdrf: false });
    expect(acquireButtons(guide)).toEqual([
      'realfi.start.cta (secondary)',
      'realfi.gettingStarted.getUsdcx (tertiary)',
    ]);
    expect(guide.text()).toContain('realfi.gettingStarted.usdrfSwapPending');
    await guide.findAll('.realfi-getting-started__actions button').at(0).trigger('click');
    expect(guide.emitted('open-realfi')).toHaveLength(1);
  });

  it('without USDCx and no USDrf swap yet, still leads with the ADA swap', () => {
    const guide = mountGuide({ canSwapUsdrf: false });
    expect(acquireButtons(guide)).toEqual([
      'realfi.gettingStarted.getUsdcx (secondary)',
      'realfi.start.cta (tertiary)',
    ]);
    expect(guide.text()).not.toContain('realfi.gettingStarted.getUsdcxNote');
  });

  it('says nothing about holdings when Gero cannot swap at all', () => {
    const guide = mountGuide({ canAcquire: false, canSwapUsdrf: false, hasUsdcx: true, swapStatus: 'unavailable' });
    expect(guide.text()).not.toContain('realfi.gettingStarted.haveUsdcx');
    expect(guide.text()).not.toContain('realfi.gettingStarted.needUsdcx');
    expect(acquireButtons(guide)).toEqual([]);
    expect(guide.text()).toContain('realfi.gettingStarted.swapStatus.unavailable');
  });
});
