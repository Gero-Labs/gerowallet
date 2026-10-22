import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { createTestVuetify } from '@test/helpers/vuetify';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import * as Vue from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import SelectSfc from './CardCountrySelect.vue';

const Select = SelectSfc as unknown as Parameters<typeof mount>[0];
const flagStub = { props: ['iso'], render(this: Vue.ComponentPublicInstance & { iso: string }) { return Vue.h('i', this.iso); } };

let wrapper: VueWrapper;

function render(modelValue = '') {
  wrapper = mount(Select, {
    props: { modelValue, label: 'card.details.nationality' },
    attachTo: document.body,
    global: {
      plugins: [createTestVuetify()],
      components: { flag: flagStub },
      config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) },
    },
  });
  return wrapper;
}

// Each row also renders an empty title from `:title="''"`; only the labelled ones count.
const options = () => [...document.body.querySelectorAll('.v-list-item-title')]
  .map(node => node.textContent?.trim())
  .filter(Boolean);

async function type(text: string): Promise<void> {
  const input = wrapper.find('input');
  await input.trigger('focus');
  await input.setValue(text);
  await flushPromises();
}

afterEach(() => wrapper?.unmount());

describe('CardCountrySelect', () => {
  it('narrows the list to the countries matching what the user types', async () => {
    render();
    await type('isr');
    expect(options()).toEqual(['Israel']);
  });

  it('picks the first match on Enter', async () => {
    render();
    await type('israel');
    await wrapper.find('input').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['IL']);
  });

  it('says so when nothing matches', async () => {
    render();
    await type('zzzz');
    expect(document.body.textContent).toContain('common.noResults');
  });
});
