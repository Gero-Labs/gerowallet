// The PassKey button's label is the caller's to set (Quick Send reads "Try again" after a stopped sweep).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';

vi.mock('./PassKeyAuthButton.vue', () => ({ default: { props: ['text', 'disabled'], template: '<button data-passkey>{{ text || "own label" }}</button>' } }));
vi.mock('./PassKeyPasswordField.vue', () => ({ default: { template: '<input />' } }));
vi.mock('./ToggleSwitch.vue', () => ({ default: { template: '<div />' } }));

import TransactionAuthSection from './TransactionAuthSection.vue';

enableAutoUnmount(afterEach);

describe('TransactionAuthSection passkeyText', () => {
  it('leaves the PassKey button its own label by default and takes the caller\'s when given', async () => {
    const wrapper = mount(TransactionAuthSection, {
      props: { isPrfWallet: true, isSigned: false, loading: false, submitText: 'Confirm' },
      global: { plugins: [createTestVuetify()] },
    });
    expect(wrapper.get('[data-passkey]').text()).toBe('own label');
    await wrapper.setProps({ passkeyText: 'Try again' });
    expect(wrapper.get('[data-passkey]').text()).toBe('Try again');
    // Once signed, the submit button and its own text take over.
    await wrapper.setProps({ isSigned: true });
    expect(wrapper.find('[data-passkey]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Confirm');
  });
});
