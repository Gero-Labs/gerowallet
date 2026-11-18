// Issue 1584: narrowing the chart kept its bar spacing and left edge, so the newest
// points (the live balance tail among them) slid out of view and the price axis
// rescaled to the older data. A width change must fit the whole series again.
import { mount, flushPromises } from '@vue/test-utils';
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const fitContent = vi.fn();
  const chart = {
    applyOptions: vi.fn(),
    addSeries: vi.fn(() => ({ setData: vi.fn(), applyOptions: vi.fn() })),
    timeScale: () => ({ fitContent }),
    priceScale: () => ({ applyOptions: vi.fn() }),
    subscribeCrosshairMove: vi.fn(),
    remove: vi.fn(),
  };
  return { fitContent, chart, observers: [] as Array<(entries: unknown[]) => void> };
});

vi.mock('lightweight-charts', () => ({ createChart: vi.fn(() => h.chart), AreaSeries: {} }));
vi.mock('@/stores/walletStore', async () => {
  const { reactive } = await import('vue');
  return { walletStore: reactive({ loggedWallet: { id: 1, chain: 'Cardano', network: 'Preprod', baseAddress: 'addr_test1' }, config: {} }) };
});
vi.mock('@/utils/networks', () => ({ default: { resolveCurrencySymbol: () => 't₳' } }));
vi.mock('@/utils/assets', () => ({ default: { walletSvg: '' } }));
vi.mock('@/shared/utils/filters', () => ({ default: { shortenStringWithEllipsis: (s: string) => s } }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/shared/components/CopyButton.vue', () => ({ default: { name: 'CopyButton', render: () => null } }));
vi.mock('@/shared/components/OdometerCounter.vue', () => ({ default: { name: 'OdometerCounter', render: () => null } }));

import PortfolioChart from './PortfolioChart.vue';

class FakeResizeObserver {
  constructor(callback: (entries: unknown[]) => void) { h.observers.push(callback); }
  observe() {}
  disconnect() {}
}

const resize = (width: number, height: number) => {
  for (const callback of h.observers) callback([{ contentRect: { width, height } }]);
};

beforeEach(() => {
  vi.useFakeTimers();
  h.observers.length = 0;
  h.fitContent.mockClear();
  h.chart.applyOptions.mockClear();
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1100);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderChart() {
  const now = Date.now();
  const series = Array.from({ length: 24 }, (_, i) => [now - (24 - i) * 3_600_000, i * 5] as [number, number]);
  const wrapper = mount(PortfolioChart, {
    props: { chartData: series, chartDataUsd: series, chartDataEur: [], loading: false, progressiveLoading: true },
    global: {
      config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) },
      stubs: { 'v-icon': true, 'v-tooltip': true, 'v-progress-circular': true, 'v-btn': true, 'v-menu': true, 'v-list': true, 'v-list-item': true, 'v-chip': true },
    },
    attachTo: document.body,
  });
  await flushPromises();
  await vi.advanceTimersByTimeAsync(200);
  await flushPromises();
  return wrapper;
}

describe('PortfolioChart resize', () => {
  it('fits the whole series again when the width changes', async () => {
    const wrapper = await renderChart();
    expect(h.observers.length).toBeGreaterThan(0);
    h.fitContent.mockClear();

    resize(350, 200);

    expect(h.chart.applyOptions).toHaveBeenCalledWith({ width: 350, height: 200 });
    expect(h.fitContent).toHaveBeenCalled();
    wrapper.unmount();
  });

  it('keeps the visible range when only the height changes', async () => {
    const wrapper = await renderChart();
    resize(1100, 200);
    h.fitContent.mockClear();

    resize(1100, 240);

    expect(h.chart.applyOptions).toHaveBeenCalledWith({ width: 1100, height: 240 });
    expect(h.fitContent).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
