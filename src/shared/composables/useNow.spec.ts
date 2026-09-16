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

// The options router view sits inside <keep-alive>, so a card is deactivated
// rather than destroyed when the user navigates away.
const Host = defineComponent({
  props: { show: { type: Boolean, default: true } },
  setup(props) {
    return () => h('keep-alive', [props.show ? h(Clock) : null]);
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

  it('pauses while kept alive off screen and resumes with a fresh value', async () => {
    vi.setSystemTime(1_000_000);
    const wrapper = mount(Host as unknown as Parameters<typeof mount>[0]);
    expect(vi.getTimerCount()).toBe(1);

    await wrapper.setProps({ show: false });
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(60_000);
    await wrapper.setProps({ show: true });
    expect(vi.getTimerCount()).toBe(1);
    expect(wrapper.text()).toBe('1060000');
    wrapper.destroy();
  });
});
