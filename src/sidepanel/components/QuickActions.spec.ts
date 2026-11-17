// A held quick action (Midnight Send while the network is paused) stays in
// place and focusable, says why through aria-describedby, and does nothing.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { computed } from 'vue';

const chain = vi.hoisted(() => ({ transactionSupport: true, isSolana: false }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../composables/useChainContext', () => ({
  useChainContext: () => ({
    networkInfo: computed(() => ({ transactionSupport: chain.transactionSupport, perpetualsSupport: false })),
    isSolana: computed(() => chain.isSolana),
  }),
}));
vi.mock('@/utils/assets', () => ({ default: { sendSvg: 'send.svg', qrCodeSvg: 'qr.svg', barChart: 'chart.svg' } }));

import QuickActions from './QuickActions.vue';

enableAutoUnmount(afterEach);

const stubs = { 'v-avatar': { template: '<span><slot /></span>' }, 'v-img': true };

describe('QuickActions', () => {
  afterEach(() => {
    chain.transactionSupport = true;
    chain.isSolana = false;
  });

  it('shows Send and Receive on Solana, whose network keeps transactionSupport off', () => {
    chain.transactionSupport = false;
    chain.isSolana = true;
    const w = mount(QuickActions, { global: { stubs } });
    expect(w.find('[data-testid="quick-action-send"]').exists()).toBe(true);
    expect(w.find('[data-testid="quick-action-receive"]').exists()).toBe(true);
    expect(w.find('[data-testid="quick-action-perps"]').exists()).toBe(false);
  });

  it('shows neither on another chain without transaction support', () => {
    chain.transactionSupport = false;
    const w = mount(QuickActions, { global: { stubs } });
    expect(w.find('[data-testid="quick-action-send"]').exists()).toBe(false);
  });

  it('emits the action when nothing is held', async () => {
    const w = mount(QuickActions, { global: { stubs } });
    await w.get('[data-testid="quick-action-send"]').trigger('click');
    expect(w.emitted('action')).toEqual([['send']]);
    expect(w.get('[data-testid="quick-action-send"]').attributes('aria-disabled')).toBeUndefined();
  });

  it('holds a listed action: aria-disabled, the reason linked, no emit; the others still work', async () => {
    const w = mount(QuickActions, { props: { disabledIds: ['send'], describedBy: 'why' }, global: { stubs } });
    const send = w.get('[data-testid="quick-action-send"]');
    expect(send.attributes('aria-disabled')).toBe('true');
    expect(send.attributes('aria-describedby')).toBe('why');
    expect(send.attributes('disabled')).toBeUndefined();
    await send.trigger('click');
    expect(w.emitted('action')).toBeUndefined();
    await w.get('[data-testid="quick-action-receive"]').trigger('click');
    expect(w.emitted('action')).toEqual([['receive']]);
  });
});
