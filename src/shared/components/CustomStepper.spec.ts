import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { h } from 'vue';
import { VStepperWindowItem } from 'vuetify/components';
import { createTestVuetify } from '@test/helpers/vuetify';
import CustomStepper from './CustomStepper.vue';

enableAutoUnmount(afterEach);
describe('custom stepper with real Vuetify windows', () => {
  it('selects numeric pages and retains their state when navigating forward and back', async () => {
    const wrapper = mount(CustomStepper, {
      props: { steps: ['First', 'Second'], currentStep: 1 },
      global: { plugins: [createTestVuetify()] },
      slots: { default: () => [
        h(VStepperWindowItem, { value: 1, transition: false, reverseTransition: false }, () => h('input', { 'data-testid': 'first' })),
        h(VStepperWindowItem, { value: 2, transition: false, reverseTransition: false }, () => h('p', { 'data-testid': 'second' }, 'Second page')),
      ] },
    });
    await flushPromises();
    expect(wrapper.get('[data-testid="first"]').isVisible()).toBe(true);
    await wrapper.get('[data-testid="first"]').setValue('Unsubmitted draft');
    await wrapper.setProps({ currentStep: 2 });
    await flushPromises();
    expect(wrapper.get('[data-testid="second"]').isVisible()).toBe(true);
    expect(wrapper.get('.v-window-item--active').find('[data-testid="second"]').exists()).toBe(true);
    expect((wrapper.get('[data-testid="first"]').element.parentElement as HTMLElement).style.display).toBe('none');
    await wrapper.setProps({ currentStep: 1 });
    await flushPromises();
    expect(wrapper.get('[data-testid="first"]').isVisible()).toBe(true);
    expect((wrapper.get('[data-testid="first"]').element as HTMLInputElement).value).toBe('Unsubmitted draft');
    expect(wrapper.get('.v-window-item--active').find('[data-testid="first"]').exists()).toBe(true);
    expect((wrapper.get('[data-testid="second"]').element.parentElement as HTMLElement).style.display).toBe('none');
  });
});
