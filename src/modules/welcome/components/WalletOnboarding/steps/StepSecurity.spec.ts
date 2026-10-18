import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { createTestVuetify } from '@test/helpers/vuetify';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import StepSecurity from './StepSecurity.vue';
import networks from '@/utils/networks';
import { Blockchain, Network } from '@/models/types';

const network = networks.resolveNetwork(Blockchain.CARDANO, Network.MAINNET);

vi.mock('@/chrome/serialization', () => ({ isPaymentAddress: () => false }));
vi.mock('@/plugins/i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('@/shared/utils/webauthn-prf', () => ({ getPrfSupportMode: async () => 'none' }));


describe('wallet name validation', () => {
  for (const name of ['', '   ', '\t\n', '\u00a0\u2003', 'W'.repeat(51)]) {
    it(`refuses ${JSON.stringify(name)} after a valid name`, async () => {
      const wrapper = mount(StepSecurity, { props: { network }, global: { plugins: [createTestVuetify()], config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) } } });
      try {
        const input = wrapper.find('input[type=text]');
        const next = wrapper.find('button.step-next');
        await input.setValue('Valid wallet');
        await vi.waitFor(() => expect(next.attributes('disabled')).toBeUndefined());
        await input.setValue(name);
        await vi.waitFor(() => expect(next.attributes('disabled')).toBeDefined());
        await next.trigger('click');
        expect(wrapper.emitted('select')).toBeUndefined();
      } finally { wrapper.unmount(); }
    });
  }

  it('emits a trimmed name while preserving interior spaces', async () => {
    const wrapper = mount(StepSecurity, { props: { network }, global: { plugins: [createTestVuetify()], config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) } } });
    try {
      await wrapper.find('input[type=text]').setValue('  My savings wallet  ');
      const next = wrapper.find('button.step-next');
      await vi.waitFor(() => expect(next.attributes('disabled')).toBeUndefined());
      await next.trigger('click');
      expect(wrapper.emitted('select')?.[0]).toEqual(['password', 'My savings wallet']);
      expect(wrapper.emitted('next')).toHaveLength(1);
    } finally { wrapper.unmount(); }
  });
});

describe('wallet name label', () => {
  it('names the field once, from the section label', () => {
    const wrapper = mount(StepSecurity, { props: { network }, global: { plugins: [createTestVuetify()], config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) } } });
    try {
      const input = wrapper.find('input[type=text]');
      const labels = wrapper.findAll('label, .t-label').filter((el) => el.text() === 'welcome.walletName');
      expect(labels).toHaveLength(1);
      expect(labels[0].attributes('for')).toBe(input.attributes('id'));
    } finally { wrapper.unmount(); }
  });
});
