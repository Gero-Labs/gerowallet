import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';

vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/plugins/snackbar', () => ({ default: { fireSuccess: vi.fn() } }));

import EditableTextField from './EditableTextField.vue';

enableAutoUnmount(afterEach);
afterEach(() => { document.body.innerHTML = ''; });

function mountField(modelValue = 'Fixture wallet') {
  return mount(EditableTextField, {
    attachTo: document.body,
    props: { modelValue, rules: [(value?: string) => (value?.length ?? 0) >= 3 || 'Too short'] },
    global: { plugins: [createTestVuetify()] },
  });
}

describe('EditableTextField native Vue 3 model', () => {
  it('displays the wallet name on mount and after parent hydration', async () => {
    const wrapper = mountField();
    expect(wrapper.get('input').element.value).toBe('Fixture wallet');
    await wrapper.setProps({ modelValue: 'Hydrated wallet' });
    expect(wrapper.get('input').element.value).toBe('Hydrated wallet');
    expect(wrapper.emitted('onSave')).toBeUndefined();
  });

  it('keeps edits local until saved and restores the name when cancelled', async () => {
    const wrapper = mountField();
    const [edit, cancel, save] = wrapper.findAll('button');
    await edit!.trigger('click');
    await wrapper.get('input').setValue('Discarded draft');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    await cancel!.trigger('click');
    expect(wrapper.get('input').element.value).toBe('Fixture wallet');
    await edit!.trigger('click');
    await wrapper.get('input').setValue('Renamed fixture');
    await flushPromises();
    await save!.trigger('click');
    await flushPromises();
    expect(wrapper.emitted('update:modelValue')).toEqual([['Renamed fixture']]);
    expect(wrapper.emitted('onSave')).toEqual([['Renamed fixture']]);
  });
});
