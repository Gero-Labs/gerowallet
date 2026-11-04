// A drawer that opens beside a dialog's right edge when the window has room for both, and
// in place otherwise, so the dialog itself never has to scroll for what the drawer holds.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';
import BaseDialog from './BaseDialog.vue';
import DialogDrawer from './DialogDrawer.vue';

/** Every media query answers `wide`: whether the window has room beside the dialog. */
function windowWide(wide: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: wide, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
}

const drawerOpen = ref(true);
const InDialog = defineComponent({
  setup: () => () => h(BaseDialog, { isOpen: true, title: 'Dialog', width: 428 }, {
    default: () => [
      h('p', { class: 'dialog-body' }, 'Body'),
      h(DialogDrawer, { open: drawerOpen.value, label: 'Details' }, { default: () => h('p', { class: 'drawer-body' }, 'Drawer') }),
    ],
  }),
});

const body = () => document.body;
const overlayContent = () => body().querySelector('.v-overlay__content');

beforeEach(() => { drawerOpen.value = true; });
afterEach(() => { document.body.innerHTML = ''; });

describe('DialogDrawer', () => {
  it('opens beside the dialog when the window has room, and moves the dialog aside for it', async () => {
    windowWide(true);
    mount(InDialog, { attachTo: body(), global: { plugins: [createTestVuetify()] } });
    await flushPromises();
    const drawer = body().querySelector('.base-dialog__drawer-host .dialog-drawer');
    expect(drawer?.textContent).toBe('Drawer');
    expect(drawer?.getAttribute('aria-label')).toBe('Details');
    expect(drawer?.classList.contains('dialog-drawer--side')).toBe(true);
    expect(overlayContent()?.classList.contains('base-dialog--with-drawer')).toBe(true);
  });

  it('lets the dialog back to the centre once it closes', async () => {
    windowWide(true);
    mount(InDialog, { attachTo: body(), global: { plugins: [createTestVuetify()] } });
    await flushPromises();
    drawerOpen.value = false;
    await flushPromises();
    expect(overlayContent()?.classList.contains('base-dialog--with-drawer')).toBe(false);
  });

  it('opens in place when the window is too narrow to hold it beside the dialog', async () => {
    windowWide(false);
    mount(InDialog, { attachTo: body(), global: { plugins: [createTestVuetify()] } });
    await flushPromises();
    expect(body().querySelector('.base-dialog__drawer-host .dialog-drawer')).toBeNull();
    const drawer = body().querySelector('.dialog-drawer');
    expect(drawer?.classList.contains('dialog-drawer--side')).toBe(false);
    expect(overlayContent()?.classList.contains('base-dialog--with-drawer')).toBe(false);
  });

  it('opens in place outside a dialog', async () => {
    windowWide(true);
    const wrapper = mount(DialogDrawer, { props: { open: true }, slots: { default: 'Inline' }, attachTo: body() });
    await flushPromises();
    expect(wrapper.get('.dialog-drawer').text()).toBe('Inline');
    expect(wrapper.get('.dialog-drawer').classes()).not.toContain('dialog-drawer--side');
  });

  it('renders nothing while closed', async () => {
    windowWide(true);
    const wrapper = mount(DialogDrawer, { props: { open: false }, slots: { default: 'Inline' }, attachTo: body() });
    await flushPromises();
    expect(wrapper.find('.dialog-drawer').exists()).toBe(false);
  });
});
