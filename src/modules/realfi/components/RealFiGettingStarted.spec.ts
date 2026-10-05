import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import GuideSfc from './RealFiGettingStarted.vue';
import IsoSceneSfc from '@/shared/components/iso/IsoScene.vue';

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

  it('with USDCx, says how much, ticks the USDCx step and leads with the USDrf swap', async () => {
    const guide = mountGuide({ hasUsdcx: true, usdcxLabel: '12.50 USDCx' });
    expect(guide.text()).toContain('realfi.gettingStarted.haveUsdcx{"amount":"12.50 USDCx"}');
    expect(guide.text()).not.toContain('realfi.gettingStarted.needUsdcx');
    // A ticked step drops its button.
    expect(acquireButtons(guide)).toEqual(['realfi.gettingStarted.getUsdrf (secondary)']);
    expect(guide.text()).not.toContain('realfi.gettingStarted.getUsdcxNote');
    await guide.findAll('.realfi-getting-started__actions button').at(0).trigger('click');
    expect(guide.emitted('get-usdrf')).toHaveLength(1);
  });

  it("with USDCx but no USDrf swap in Gero yet, points to RealFi's app", async () => {
    const guide = mountGuide({ hasUsdcx: true, usdcxLabel: '12.50 USDCx', canSwapUsdrf: false });
    expect(acquireButtons(guide)).toEqual(['realfi.start.cta (secondary)']);
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

  it('gives each step of the full guide its scene, and keeps the compact guide text-only', () => {
    const scenes = (guide: Guide) => guide.findAllComponents(IsoSceneSfc as never).wrappers.map((s) => s.props('name'));
    expect(scenes(mountGuide())).toEqual(['earnRegion', 'earnUsdcx', 'earnSwap', 'earnStake']);
    expect(scenes(mount(GuideSfc as unknown as Parameters<typeof mount>[0], {
      propsData: { ...BASE, compact: true },
      mocks: { $t: (key: string) => key },
      stubs: { 'v-btn': { template: '<button><slot /></button>' } },
    }))).toEqual([]);
  });

  it('says nothing about holdings when Gero cannot swap at all', () => {
    const guide = mountGuide({ canAcquire: false, canSwapUsdrf: false, hasUsdcx: true, swapStatus: 'unavailable' });
    expect(guide.text()).not.toContain('realfi.gettingStarted.haveUsdcx');
    expect(guide.text()).not.toContain('realfi.gettingStarted.needUsdcx');
    expect(acquireButtons(guide)).toEqual([]);
    expect(guide.text()).toContain('realfi.gettingStarted.swapStatus.unavailable');
  });
});

describe('RealFiGettingStarted: steps you tick off', () => {
  type Step = { title: string; number: string; done: boolean };

  function steps(guide: Guide): Step[] {
    return guide.findAll('.realfi-getting-started__step').wrappers.map((li) => ({
      title: li.find('.t-label').text(),
      number: li.find('.realfi-getting-started__number').text(),
      done: li.classes('realfi-getting-started__step--done'),
    }));
  }

  function step(guide: Guide, title: string) {
    return guide.findAll('.realfi-getting-started__step').wrappers.find((li) => li.find('.t-label').text() === title)!;
  }

  it('on mainnet, gets USDCx and USDrf in two steps, neither ticked yet', () => {
    expect(steps(mountGuide())).toEqual([
      { title: 'realfi.gettingStarted.eligibilityTitle', number: '1', done: false },
      { title: 'realfi.gettingStarted.usdcxTitle', number: '2', done: false },
      { title: 'realfi.gettingStarted.acquireTitle', number: '3', done: false },
      { title: 'realfi.gettingStarted.stakeTitle', number: '4', done: false },
    ]);
  });

  it('ticks the USDCx step once the wallet holds USDCx, and tells screen readers', () => {
    const guide = mountGuide({ hasUsdcx: true, usdcxLabel: '12.50 USDCx' });
    expect(steps(guide).map((s) => s.done)).toEqual([false, true, false, false]);
    const usdcx = step(guide, 'realfi.gettingStarted.usdcxTitle');
    expect(usdcx.find('.realfi-getting-started__number .realfi-getting-started__tick').exists()).toBe(true);
    expect(usdcx.find('.realfi-getting-started__number').text()).toBe('');
    expect(usdcx.find('.realfi-getting-started__sr-only').text()).toBe('common.done');
    expect(step(guide, 'realfi.gettingStarted.acquireTitle').find('.realfi-getting-started__sr-only').exists()).toBe(false);
  });

  it('with USDrf, ticks both swap steps, drops their buttons and offers the stake', async () => {
    const guide = mountGuide({ hasUsdr: true });
    expect(steps(guide).map((s) => s.done)).toEqual([false, true, true, false]);
    expect(acquireButtons(guide)).toEqual([]);
    expect(guide.text()).not.toContain('realfi.gettingStarted.getUsdcxNote');
    expect(guide.text()).not.toContain('realfi.gettingStarted.routeNote');
    const stake = step(guide, 'realfi.gettingStarted.stakeTitle').find('button');
    expect(stake.text()).toBe('realfi.start.stakeCta');
    await stake.trigger('click');
    expect(guide.emitted('stake')).toHaveLength(1);
  });

  it('on preprod, has no USDCx step and numbers the rest 1 to 3', () => {
    const guide = mountGuide({ mainnet: false, canAcquire: false, canSwapUsdrf: false });
    expect(steps(guide).map((s) => [s.title, s.number])).toEqual([
      ['realfi.gettingStarted.eligibilityTitle', '1'],
      ['realfi.gettingStarted.acquireTitle', '2'],
      ['realfi.gettingStarted.stakeTitle', '3'],
    ]);
  });

  it('with swaps off, explains it at the first step still open', () => {
    const status = 'realfi.gettingStarted.swapStatus.disabled';
    const off = { canAcquire: false, canSwapUsdrf: false, swapStatus: 'disabled', canRetryAvailability: true };
    const fresh = mountGuide(off);
    expect(step(fresh, 'realfi.gettingStarted.usdcxTitle').text()).toContain(status);
    expect(step(fresh, 'realfi.gettingStarted.usdcxTitle').text()).toContain('realfi.gettingStarted.usdcxBody');
    expect(step(fresh, 'realfi.gettingStarted.acquireTitle').text()).not.toContain(status);

    const holding = mountGuide({ ...off, hasUsdcx: true });
    expect(step(holding, 'realfi.gettingStarted.usdcxTitle').text()).not.toContain(status);
    expect(step(holding, 'realfi.gettingStarted.acquireTitle').text()).toContain(status);
    expect(holding.findAll('button').wrappers.map((b) => b.text())).toContain('realfi.gettingStarted.retryAvailability');
  });
});
