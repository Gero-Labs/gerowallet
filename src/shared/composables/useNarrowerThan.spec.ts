// Issue 1583: the portfolio's category chips stayed icon-only at full width. The toolbar
// they measure is re-created when the page switches template branch during hydration;
// the old element reported width 0 as it left, and the new one was never observed.
import { defineComponent, h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNarrowerThan } from './useNarrowerThan';

type Entry = { contentRect: { width: number } };
class FakeResizeObserver {
  static all: FakeResizeObserver[] = [];
  observed = new Set<Element>();
  constructor(private readonly callback: (entries: Entry[]) => void) {
    FakeResizeObserver.all.push(this);
  }
  observe(el: Element) { this.observed.add(el); }
  unobserve(el: Element) { this.observed.delete(el); }
  disconnect() { this.observed.clear(); }
  static resize(el: Element, width: number) {
    for (const ro of FakeResizeObserver.all) if (ro.observed.has(el)) ro.callback([{ contentRect: { width } }]);
  }
}

beforeEach(() => {
  FakeResizeObserver.all = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});
afterEach(() => vi.unstubAllGlobals());

const Host = defineComponent({
  props: { branch: { type: String, default: 'a' } },
  setup(props) {
    const target = ref<HTMLElement | null>(null);
    const narrow = useNarrowerThan(target, 560);
    return () => h('div', [
      // Two branches render two different elements, as PortfolioPage's v-if chain does.
      props.branch === 'a' ? h('div', { key: 'a', ref: target, id: 'a' }) : null,
      props.branch === 'b' ? h('div', { key: 'b', ref: target, id: 'b' }) : null,
      h('span', { id: 'state' }, narrow.value ? 'narrow' : 'wide'),
    ]);
  },
});

const state = (w: ReturnType<typeof mount>) => w.get('#state').text();

describe('useNarrowerThan', () => {
  it('follows the observed width against the threshold', async () => {
    const w = mount(Host, { attachTo: document.body });
    await nextTick();
    const el = w.get('#a').element;
    FakeResizeObserver.resize(el, 400);
    await nextTick();
    expect(state(w)).toBe('narrow');
    FakeResizeObserver.resize(el, 1100);
    await nextTick();
    expect(state(w)).toBe('wide');
    w.unmount();
  });

  it('ignores a zero width, which is an element that is not rendered', async () => {
    const w = mount(Host, { attachTo: document.body });
    await nextTick();
    const el = w.get('#a').element;
    FakeResizeObserver.resize(el, 1100);
    FakeResizeObserver.resize(el, 0);
    await nextTick();
    expect(state(w)).toBe('wide');
    w.unmount();
  });

  it('observes the element that replaces the first one', async () => {
    const w = mount(Host, { attachTo: document.body, props: { branch: 'a' } });
    await nextTick();
    const first = w.get('#a').element;
    await w.setProps({ branch: 'none' });
    FakeResizeObserver.resize(first, 0);
    await w.setProps({ branch: 'b' });
    await nextTick();
    const second = w.get('#b').element;
    FakeResizeObserver.resize(second, 1100);
    await nextTick();
    expect(state(w)).toBe('wide');
    FakeResizeObserver.resize(second, 400);
    await nextTick();
    expect(state(w)).toBe('narrow');
    w.unmount();
  });

  it('stops observing when the component unmounts', async () => {
    const w = mount(Host, { attachTo: document.body });
    await nextTick();
    w.unmount();
    expect(FakeResizeObserver.all.every(ro => ro.observed.size === 0)).toBe(true);
  });
});
