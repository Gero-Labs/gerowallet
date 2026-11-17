// The dashboard banner and the settings group for announcements from Gero.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';

const fake = vi.hoisted(() => ({ store: null as unknown, flag: true }));

vi.mock('@/stores/announcementsStore', async () => {
  const { createFakePageStore, isCritical, isHeadline } = await import('@/services/announcements/__fixtures__/fakePageStore');
  fake.store = createFakePageStore();
  return { announcementsStore: fake.store, isCritical, isHeadline };
});
vi.mock('@/stores/featureFlagsStore', () => ({ featureFlagsStore: { isAnnouncementsEnabled: () => fake.flag } }));

import { i18nPlugin } from '@/plugins/i18n';
import type { FakePageStore } from '@/services/announcements/__fixtures__/fakePageStore';
import { annId, critical, product, warning } from '@/services/announcements/__fixtures__/stored';
import AnnouncementBanner from './AnnouncementBanner.vue';
import AnnouncementSettings from './AnnouncementSettings.vue';

const store = () => fake.store as FakePageStore;
enableAutoUnmount(afterEach);

const button = { template: '<button class="g-btn"><slot /></button>' };
const toggle = {
  props: ['modelValue', 'disabled', 'label', 'describedby'],
  emits: ['update:modelValue'],
  template: '<button class="toggle" :data-on="String(modelValue)" :aria-label="label" :aria-describedby="describedby" :disabled="disabled" @click="$emit(\'update:modelValue\', !modelValue)"></button>',
};
const globals = { plugins: [i18nPlugin], stubs: { 'v-icon': { template: '<i />' }, 'v-row': { template: '<div class="row"><slot /></div>' }, 'v-col': { template: '<div><slot /></div>' }, GButton: button, ToggleSwitch: toggle } };

beforeEach(() => {
  store().reset();
  fake.flag = true;
});

describe('AnnouncementBanner', () => {
  it('shows nothing without a critical service notice', () => {
    store().state.items = [warning(1), product(2)];
    expect(mount(AnnouncementBanner, { global: globals }).find('.announce-banner').exists()).toBe(false);
  });

  it('shows one banner, as an alert, with the title and the summary', () => {
    store().state.items = [critical(1), critical(2)];
    const view = mount(AnnouncementBanner, { global: globals });
    const banners = view.findAll('.announce-banner');
    expect(banners).toHaveLength(1);
    expect(banners[0]!.attributes('role')).toBe('alert');
    expect(view.text()).toContain('Title 1');
    expect(view.text()).toContain('Summary 1');
  });

  it('opens the notice from Details', async () => {
    store().state.items = [critical(1)];
    const view = mount(AnnouncementBanner, { global: globals });
    await view.find('button.g-btn').trigger('click');
    expect(store().open).toHaveBeenCalledWith(annId(1));
  });

  it('has a named dismiss button, and moves on to the next notice when dismissed', async () => {
    store().state.items = [critical(1), critical(2)];
    const view = mount(AnnouncementBanner, { global: globals });
    const dismiss = view.find('.announce-banner__dismiss');
    expect(dismiss.attributes('aria-label')).toBe('Dismiss');
    await dismiss.trigger('click');
    expect(store().dismissBanner).toHaveBeenCalledWith(annId(1));
    await nextTick();
    expect(view.text()).toContain('Title 2');
    await view.find('.announce-banner__dismiss').trigger('click');
    await nextTick();
    expect(view.find('.announce-banner').exists()).toBe(false);
  });
});

describe('AnnouncementSettings', () => {
  it('keeps service notices always on and offers a switch for product updates and for news', () => {
    const view = mount(AnnouncementSettings, { global: globals });
    const rows = view.findAll('.row');
    expect(rows).toHaveLength(3);
    expect(rows[0]!.text()).toContain('Service notices');
    expect(rows[0]!.text()).toContain('Always on');
    expect(rows[0]!.find('.toggle').exists()).toBe(false);
    expect(rows[1]!.text()).toContain('Product updates');
    expect(rows[2]!.text()).toContain('News');
    expect(view.findAll('.toggle').map((t) => t.attributes('data-on'))).toEqual(['true', 'true']);
  });

  it('switches a kind off and on through the store', async () => {
    const view = mount(AnnouncementSettings, { global: globals });
    await view.findAll('.toggle')[1]!.trigger('click');
    expect(store().setKind).toHaveBeenCalledWith('news', false);
    await flushPromises();
    expect(view.findAll('.toggle').map((t) => t.attributes('data-on'))).toEqual(['true', 'false']);
    // The label is a button too: the whole row toggles.
    await view.findAll('.announce-settings__label')[1]!.trigger('click');
    expect(store().setKind).toHaveBeenLastCalledWith('news', true);
  });

  it('gives each switch a name and a description, and keeps the pointer-only label out of the way', () => {
    const view = mount(AnnouncementSettings, { global: globals });
    const switches = view.findAll('.toggle');
    expect(switches.map((t) => t.attributes('aria-label'))).toEqual(['Product updates', 'News']);
    for (const t of switches) {
      const hint = view.find(`#${t.attributes('aria-describedby')}`);
      expect(hint.exists()).toBe(true);
      expect(hint.text().length).toBeGreaterThan(10);
    }
    // One control per setting for the keyboard and for a screen reader: the switch.
    for (const label of view.findAll('.announce-settings__label')) {
      expect(label.attributes('tabindex')).toBe('-1');
      expect(label.attributes('aria-hidden')).toBe('true');
    }
  });

  it('says so when a change could not be saved', async () => {
    store().setKind.mockRejectedValueOnce(new Error('not saved'));
    const view = mount(AnnouncementSettings, { global: globals });
    await view.findAll('.toggle')[0]!.trigger('click');
    await flushPromises();
    expect(view.find('[role="alert"]').text()).toBe('Couldn’t save that. Try again.');
  });

  it('tells the user how to recognise a real announcement', () => {
    const text = mount(AnnouncementSettings, { global: globals }).text();
    expect(text).toContain('How to tell an announcement is real');
    expect(text).toContain('It never asks for your recovery phrase, your password or a payment.');
  });

  it('is not shown while the kill switch is off', () => {
    fake.flag = false;
    expect(mount(AnnouncementSettings, { global: globals }).find('.announce-settings').exists()).toBe(false);
  });
});
