import Vue from 'vue';
import Vuetify from 'vuetify';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import StepSecurity from './StepSecurity.vue';

vi.mock('@/chrome/serialization', () => ({ isPaymentAddress: () => false }));
vi.mock('@/plugins/i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('@/shared/utils/webauthn-prf', () => ({ getPrfSupportMode: async () => 'none' }));

Vue.use(Vuetify);

describe('wallet name validation', () => {
  for (const name of ['', '   ', '\t\n', '\u00a0\u2003', 'W'.repeat(51)]) {
    it(`refuses ${JSON.stringify(name)} after a valid name`, async () => {
      const wrapper = mount(StepSecurity, {
        vuetify: new Vuetify(), propsData: { network: {} },
        mocks: { $t: (key: string) => key },
      });
      try {
        const input = wrapper.find('input[type=text]');
        const next = wrapper.find('button.onb-continue');
        await input.setValue('Valid wallet');
        await vi.waitFor(() => expect(next.attributes('disabled')).toBeUndefined());
        await input.setValue(name);
        await vi.waitFor(() => expect(next.attributes('disabled')).toBeDefined());
        await next.trigger('click');
        expect(wrapper.emitted('select')).toBeUndefined();
      } finally { wrapper.destroy(); }
    });
  }

  it('emits a trimmed name while preserving interior spaces', async () => {
    const wrapper = mount(StepSecurity, {
      vuetify: new Vuetify(), propsData: { network: {} },
      mocks: { $t: (key: string) => key },
    });
    try {
      await wrapper.find('input[type=text]').setValue('  My savings wallet  ');
      const next = wrapper.find('button.onb-continue');
      await vi.waitFor(() => expect(next.attributes('disabled')).toBeUndefined());
      await next.trigger('click');
      expect(wrapper.emitted('select')?.[0]).toEqual(['password', 'My savings wallet']);
      expect(wrapper.emitted('next')).toHaveLength(1);
    } finally { wrapper.destroy(); }
  });
});
