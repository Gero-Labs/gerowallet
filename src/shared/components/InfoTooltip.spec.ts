import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { VTooltip } from 'vuetify/components';
import { createTestVuetify } from '@test/helpers/vuetify';
import InfoTooltip from './InfoTooltip.vue';

enableAutoUnmount(afterEach);
afterEach(() => { vi.unstubAllGlobals(); });

const props = { label: 'About vaults', text: 'Shared custody on Cardano.' };

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query === '(prefers-reduced-motion: reduce)',
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

function mountTooltip() {
  return mount(InfoTooltip, { props, global: { plugins: [createTestVuetify()] }, attachTo: document.body });
}

describe('InfoTooltip', () => {
  it('is a named button described by a role="tooltip" element carrying the text', async () => {
    stubReducedMotion(false);
    const wrapper = mountTooltip();
    await flushPromises();
    const trigger = wrapper.get('button');
    expect(trigger.attributes('type')).toBe('button');
    expect(trigger.attributes('aria-label')).toBe('About vaults');
    const tooltip = document.getElementById(trigger.attributes('aria-describedby')!);
    expect(tooltip?.getAttribute('role')).toBe('tooltip');
    // Rendered eagerly, so the description exists before the tooltip is first shown.
    expect(tooltip?.textContent).toContain('Shared custody on Cardano.');
    expect(wrapper.findComponent(VTooltip).props('contentClass')).toBe('custom-tooltip');
  });

  it('opens on keyboard focus, so it is reachable without a mouse', async () => {
    stubReducedMotion(false);
    const wrapper = mountTooltip();
    const tooltip = wrapper.findComponent(VTooltip);
    const trigger = wrapper.get('button').element as HTMLButtonElement;
    trigger.focus();
    await flushPromises();
    await vi.waitFor(() => expect(tooltip.emitted('update:modelValue')?.at(-1)).toEqual([true]));
  });

  it('drops the open and close transition when the user asks for reduced motion', () => {
    stubReducedMotion(true);
    expect(mountTooltip().findComponent(VTooltip).props('transition')).toBe(false);
  });

  it('keeps the house transition otherwise', () => {
    stubReducedMotion(false);
    expect(mountTooltip().findComponent(VTooltip).props('transition')).not.toBe(false);
  });
});
