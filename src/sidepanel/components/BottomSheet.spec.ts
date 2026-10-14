import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';
import BottomSheet from './BottomSheet.vue';

enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.useFakeTimers();
  const matchMedia = window.matchMedia.bind(window);
  vi.spyOn(window, 'matchMedia').mockImplementation(query => {
    const media = matchMedia(query);
    if (query === '(prefers-reduced-motion: reduce)') Object.defineProperty(media, 'matches', { value: true });
    return media;
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function render(props: { closeDisabled?: boolean; persistent?: boolean; variant?: 'standard' | 'trust' } = {}) {
  const wrapper = mount(BottomSheet, {
    props: { modelValue: false, title: 'Send', ...props },
    global: { plugins: [createTestVuetify()] },
  });
  await wrapper.setProps({ modelValue: true });
  return wrapper;
}

type Sheet = Awaited<ReturnType<typeof render>>;
type Dismissal = 'close button' | 'Escape' | 'backdrop' | 'drag';

async function dismiss(wrapper: Sheet, action: Dismissal) {
  if (action === 'close button') await wrapper.get('.bottom-sheet-header button').trigger('click');
  if (action === 'Escape') await wrapper.get('.bottom-sheet-container').trigger('keydown', { key: 'Escape' });
  if (action === 'backdrop') await wrapper.get('.bottom-sheet-overlay').trigger('click');
  if (action === 'drag') {
    await wrapper.get('.bottom-sheet-handle').trigger('pointerdown', { pointerId: 1, pointerType: 'touch', clientY: 0 });
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientY: 20 }));
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientY: 500 }));
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientY: 500 }));
  }
  await vi.advanceTimersByTimeAsync(250);
}

describe('BottomSheet dismissal policy', () => {
  it.each(['close button', 'Escape', 'backdrop', 'drag'] as const)('blocks %s while disabled and restores it afterwards', async action => {
    const wrapper = await render({ closeDisabled: true });
    expect(wrapper.get('.bottom-sheet-header button').attributes('disabled')).toBeDefined();
    await dismiss(wrapper, action);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    await wrapper.setProps({ closeDisabled: false });
    expect(wrapper.get('.bottom-sheet-header button').attributes('disabled')).toBeUndefined();
    await dismiss(wrapper, action);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]]);
  });

  it.each(['close button', 'Escape'] as const)('keeps explicit %s cancellation available on ordinary persistent sheets', async action => {
    const wrapper = await render({ persistent: true });
    await dismiss(wrapper, action);
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]]);
  });

  it('keeps a sheet open if dismissal becomes disabled during its close animation', async () => {
    const wrapper = await render();
    await wrapper.get('.bottom-sheet-header button').trigger('click');
    await wrapper.setProps({ closeDisabled: true });
    await vi.advanceTimersByTimeAsync(250);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    await wrapper.setProps({ closeDisabled: false });
    await dismiss(wrapper, 'close button');
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]]);
  });

  it('allows its parent to close a disabled sheet', async () => {
    const wrapper = await render({ closeDisabled: true });
    await wrapper.setProps({ modelValue: false });
    await vi.advanceTimersByTimeAsync(250);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]]);
  });

  it('preserves the explicit Escape event for trust sheets unless disabled', async () => {
    const wrapper = await render({ variant: 'trust', closeDisabled: true });
    await dismiss(wrapper, 'Escape');
    expect(wrapper.emitted('escape')).toBeUndefined();
    await wrapper.setProps({ closeDisabled: false });
    await dismiss(wrapper, 'Escape');
    expect(wrapper.emitted('escape')).toHaveLength(1);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });
});
