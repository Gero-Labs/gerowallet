import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';
import BottomSheet from './BottomSheet.vue';
import { useSheetVisibility } from '../composables/useSheetVisibility';

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

// A parent that mounts its sheet with v-if and opens it in the same tick
// (HomePage's CIP-113 Send, issue 1439) hands BottomSheet modelValue = true
// at mount, with no later change for a watcher to see.
describe('BottomSheet mounted with its initial modelValue', () => {
  const { isAnySheetOpen } = useSheetVisibility();

  it('opens, takes focus and holds the open credit when mounted open', async () => {
    const opener = document.body.appendChild(document.createElement('button'));
    opener.focus();
    const wrapper = mount(BottomSheet, {
      props: { modelValue: true, title: 'Send' },
      attachTo: document.body,
      global: { plugins: [createTestVuetify()] },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    expect(isAnySheetOpen.value).toBe(true);
    expect(wrapper.get('.bottom-sheet-container').element.contains(document.activeElement)).toBe(true);

    await dismiss(wrapper, 'close button');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]]);
    expect(isAnySheetOpen.value).toBe(false);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('does nothing when mounted closed', async () => {
    const wrapper = mount(BottomSheet, {
      props: { modelValue: false, title: 'Send' },
      global: { plugins: [createTestVuetify()] },
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.emitted('close')).toBeUndefined();
    expect(isAnySheetOpen.value).toBe(false);
  });
});
