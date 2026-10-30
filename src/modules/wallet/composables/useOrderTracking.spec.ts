import * as Vue from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardInfo } from '@/models/card';

const store = vi.hoisted(() => ({
  getOrderDetails: vi.fn(async () => ({ status: 'new' })),
  fetchCardUuidForOrder: vi.fn(async () => null),
  getDeliveryPayment: vi.fn(async () => ({ status: 'paid' })),
  fetchCardData: vi.fn(async () => undefined),
}));
vi.mock('@/stores/modules/card', () => ({ default: store }));

import { useOrderTracking } from './useOrderTracking';

const NOW = Date.parse('2026-10-22T10:00:00Z');
const MINUTE = 60_000;

const order = (createdAt: string, orderUuid = 'order-1') =>
  ({ cardData: { order_uuid: orderUuid, card_uuid: null, own_type: 'physical', status: 'new', created_at: createdAt } }) as unknown as CardInfo;

let wrapper: VueWrapper | undefined;

function track(cards: CardInfo[]) {
  const list = Vue.ref(cards);
  const Host = Vue.defineComponent({
    setup() {
      useOrderTracking(Vue.computed(() => list.value as CardInfo[]));
      return () => Vue.h('div');
    },
  });
  wrapper = mount(Host);
  return list;
}

/** Each check asks for the card UUID once per pending order. */
const checks = () => store.fetchCardUuidForOrder.mock.calls.length;
const elapse = (ms: number) => vi.advanceTimersByTimeAsync(ms);

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  setVisibility('visible');
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.useRealTimers();
});

describe('order tracking backoff', () => {
  it('checks a fresh order straight away, then every 10 s', async () => {
    track([order('2026-10-22T09:59:00Z')]);
    await elapse(0);
    expect(checks()).toBe(1);
    await elapse(10_000);
    expect(checks()).toBe(2);
    await elapse(10_000);
    expect(checks()).toBe(3);
  });

  it('checks an order placed hours ago only every five minutes', async () => {
    track([order('2026-10-22T07:00:00Z')]);
    await elapse(0);
    expect(checks()).toBe(1);
    await elapse(4 * MINUTE);
    expect(checks()).toBe(1);
    await elapse(MINUTE);
    expect(checks()).toBe(2);
  });

  it('slows to once a minute when a fresh order passes five minutes', async () => {
    track([order('2026-10-22T10:00:00Z')]);
    await elapse(5 * MINUTE);
    const atFiveMinutes = checks();
    expect(atFiveMinutes).toBe(31);
    await elapse(MINUTE);
    expect(checks()).toBe(atFiveMinutes + 1);
  });

  it('goes back to 10 s as soon as a new order is placed', async () => {
    const list = track([order('2026-10-22T07:00:00Z', 'old')]);
    await elapse(0);
    expect(checks()).toBe(1);

    list.value = [...list.value, order('2026-10-22T10:00:00Z', 'new')];
    await elapse(0);
    expect(checks()).toBe(3); // both orders, at once
    await elapse(10_000);
    expect(checks()).toBe(5);
  });

  it('falls back to the time it first saw the order when created_at is missing', async () => {
    track([order('')]);
    await elapse(0);
    await elapse(10_000);
    expect(checks()).toBe(2);
  });

  it('skips checks while the page is hidden and resumes when it is shown', async () => {
    track([order('2026-10-22T09:59:00Z')]);
    await elapse(0);
    setVisibility('hidden');
    await elapse(30_000);
    expect(checks()).toBe(1);
    setVisibility('visible');
    await elapse(10_000);
    expect(checks()).toBe(2);
  });

  it('stops when the page is left', async () => {
    track([order('2026-10-22T09:59:00Z')]);
    await elapse(0);
    wrapper?.unmount();
    wrapper = undefined;
    await elapse(10 * MINUTE);
    expect(checks()).toBe(1);
  });
});
