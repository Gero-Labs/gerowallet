// A held quick action (Midnight Send while the network is paused) stays in
// place and focusable, says why through aria-describedby, and does nothing.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { computed } from 'vue';

vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../composables/useChainContext', () => ({
  useChainContext: () => ({ networkInfo: computed(() => ({ transactionSupport: true, perpetualsSupport: false })) }),
}));
vi.mock('@/utils/assets', () => ({ default: { sendSvg: 'send.svg', qrCodeSvg: 'qr.svg', barChart: 'chart.svg' } }));

import QuickActions from './QuickActions.vue';

enableAutoUnmount(afterEach);

const stubs = { 'v-avatar': { template: '<span><slot /></span>' }, 'v-img': true };

describe('QuickActions', () => {
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
