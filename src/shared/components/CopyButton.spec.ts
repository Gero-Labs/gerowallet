import { nextTick } from 'vue';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestVuetify } from '@test/helpers/vuetify';
import { i18nPlugin } from '@/plugins/i18n';
import CopyButton from './CopyButton.vue';

const TX = '7ecfdae7a4a2b8ea1bd2b4cb6b3d1b4ec5e9e5e3c5f4b0c7f6c3e9d2a1b0c9d8';
const writeText = vi.fn<(text: string) => Promise<void>>();

enableAutoUnmount(afterEach);
beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, 'clipboard');
});

function mountButton(props: { label?: string; title?: string; xSmall?: boolean } = {}) {
  return mount(CopyButton, {
    props: { value: TX, ...props },
    global: { plugins: [createTestVuetify(), i18nPlugin] },
  });
}

describe('CopyButton', () => {
  it('names an icon-only button and shows the same name on hover', () => {
    const button = mountButton({ xSmall: true }).get('button');
    expect(button.attributes('aria-label')).toBe('Copy to clipboard');
    expect(button.attributes('title')).toBe('Copy to clipboard');
  });

  it('takes a more specific name from the caller', () => {
    const button = mountButton({ label: 'Copy transaction ID' }).get('button');
    expect(button.attributes('aria-label')).toBe('Copy transaction ID');
    expect(button.attributes('title')).toBe('Copy transaction ID');
  });

  it('copies the value and says "Copied" until the check mark goes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const wrapper = mountButton({ label: 'Copy transaction ID' });
    const button = wrapper.get('button');

    await button.trigger('click');
    await flushPromises();
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith(TX);
    expect(button.attributes('aria-label')).toBe('Copied');
    expect(button.attributes('title')).toBe('Copied');
    expect(wrapper.get('.v-icon').classes()).toContain('mdi-check');

    vi.advanceTimersByTime(1000);
    await nextTick();
    expect(button.attributes('aria-label')).toBe('Copy transaction ID');
    expect(wrapper.get('.v-icon').classes()).toContain('mdi-content-copy');
  });

  it('leaves a titled button to be named by its visible title', () => {
    const button = mountButton({ title: 'addr1q9…x7k2' }).get('button');
    expect(button.text()).toContain('addr1q9…x7k2');
    expect(button.attributes('aria-label')).toBeUndefined();
    expect(button.attributes('title')).toBeUndefined();
  });
});
