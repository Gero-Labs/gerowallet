import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { createTestVuetify } from '@test/helpers/vuetify';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import StepSecurity from './StepSecurity.vue';
import networks from '@/utils/networks';
import { Blockchain, Network } from '@/models/types';

const network = networks.resolveNetwork(Blockchain.CARDANO, Network.MAINNET);

vi.mock('@/chrome/serialization', () => ({ isPaymentAddress: () => false }));
vi.mock('@/plugins/i18n', () => ({ default: { t: (key: string) => key, tc: (key: string, count: number) => `${key}:${count}` } }));
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
      expect(wrapper.emitted('select')?.[0]).toEqual(['password', 'My savings wallet', 1]);
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

describe('account count', () => {
  const mountStep = (offerAccounts?: boolean) => mount(StepSecurity, { props: { network, offerAccounts }, global: { plugins: [createTestVuetify()], config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) } } });

  it('is not offered unless the onboarding asks for it', () => {
    const wrapper = mountStep();
    try {
      expect(wrapper.find('.account-count').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });

  it('starts at one account, stays between 1 and 20 and goes out with the choice', async () => {
    const wrapper = mountStep(true);
    try {
      const [fewer, more] = wrapper.findAll('.account-count__step');
      const value = () => wrapper.find('.account-count__value').text();
      expect(value()).toBe('accounts.count:1');
      expect(fewer.attributes('disabled')).toBeDefined();

      await more.trigger('click');
      await more.trigger('click');
      expect(value()).toBe('accounts.count:3');
      await fewer.trigger('click');
      expect(value()).toBe('accounts.count:2');

      for (let i = 0; i < 25; i++) await more.trigger('click');
      expect(value()).toBe('accounts.count:20');
      expect(more.attributes('disabled')).toBeDefined();

      await fewer.trigger('click');
      const next = wrapper.find('button.step-next');
      await vi.waitFor(() => expect(next.attributes('disabled')).toBeUndefined());
      await next.trigger('click');
      expect(wrapper.emitted('select')?.[0]?.[2]).toBe(19);
    } finally { wrapper.unmount(); }
  });
});
