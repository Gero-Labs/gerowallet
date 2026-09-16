import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNow } from './useNow';

const Clock = defineComponent({
  setup() {
    const now = useNow(1_000);
    return () => h('span', String(now.value));
  },
});

describe('useNow', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('ticks while mounted and stops when the component goes away', async () => {
    vi.setSystemTime(1_000_000);
    const wrapper = mount(Clock as unknown as Parameters<typeof mount>[0]);
    expect(wrapper.text()).toBe('1000000');

    // Fake timers move Date.now() along with the interval.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(wrapper.text()).toBe('1003000');

    const clear = vi.spyOn(globalThis, 'clearInterval');
    wrapper.destroy();
    expect(clear).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
