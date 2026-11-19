import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, nextTick } from 'vue';
import { createVuetify } from 'vuetify';
import BaseDialog from './BaseDialog.vue';

/**
 * Issue 1594: a keyboard user who opens a dialog and closes it lands back on the
 * control that opened it, and the close button has a name. The dialog stub renders
 * like an open overlay and lets the test end the leave transition.
 */
const DialogStub = defineComponent({
  props: { modelValue: Boolean },
  emits: ['after-leave', 'update:modelValue'],
  template: '<div v-if="modelValue" class="v-overlay v-overlay--active"><slot /></div>',
});

const mounted: VueWrapper[] = [];
afterEach(() => {
  mounted.splice(0).forEach(w => w.unmount());
  document.body.innerHTML = '';
});

function setup() {
  const opener = document.createElement('button');
  opener.textContent = 'Send';
  document.body.appendChild(opener);
  opener.focus();
  const wrapper = mount(BaseDialog, {
    attachTo: document.body,
    props: { isOpen: false, title: 'Quick Send' },
    global: {
      plugins: [createVuetify()],
      config: { globalProperties: mockGlobalProperties({ $t: (key: string) => (key === 'common.close' ? 'Close' : key) }) },
      stubs: { 'v-dialog': DialogStub, 'v-img': true, 'v-icon': true, 'v-tooltip': true, CopyButton: true },
    },
  });
  mounted.push(wrapper);
  const leave = () => wrapper.findComponent(DialogStub).vm.$emit('after-leave');
  return { opener, wrapper, leave };
}

describe('BaseDialog keyboard focus (issue 1594)', () => {
  it('names its close button', async () => {
    const { wrapper } = setup();
    await wrapper.setProps({ isOpen: true });
    expect(wrapper.find('.close-button').attributes('aria-label')).toBe('Close');
  });

  it('returns focus to the control that opened it once it has closed', async () => {
    const { opener, wrapper, leave } = setup();
    await wrapper.setProps({ isOpen: true });
    (wrapper.find('.close-button').element as HTMLElement).focus();
    await wrapper.setProps({ isOpen: false });
    await nextTick();
    leave();
    expect(document.activeElement).toBe(opener);
  });

  it('leaves focus alone when the user has moved it somewhere else', async () => {
    const { wrapper, leave } = setup();
    await wrapper.setProps({ isOpen: true });
    await wrapper.setProps({ isOpen: false });
    const elsewhere = document.createElement('input');
    document.body.appendChild(elsewhere);
    elsewhere.focus();
    leave();
    expect(document.activeElement).toBe(elsewhere);
  });

  it('does nothing when the opener is gone', async () => {
    const { opener, wrapper, leave } = setup();
    await wrapper.setProps({ isOpen: true });
    opener.remove();
    await wrapper.setProps({ isOpen: false });
    leave();
    expect(document.activeElement).toBe(document.body);
  });
});
