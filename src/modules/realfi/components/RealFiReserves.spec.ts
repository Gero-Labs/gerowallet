import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { RealFiReservesReport } from '../types';

vi.mock('@/plugins/i18n', () => ({
  default: {
    locale: 'us',
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}${JSON.stringify(values)}` : key,
    tc: (key: string, n: number) => `${key}(${n})`,
  },
  getLocaleCode: () => 'en-US',
}));

import ReservesSfc from './RealFiReserves.vue';

// test-utils' mount() typings predate <script setup> components.
const Reserves = ReservesSfc as unknown as Parameters<typeof mount>[0];

/** Made-up figures and names: RealFi's own feed is private. */
function report(overrides: Partial<RealFiReservesReport> = {}): RealFiReservesReport {
  return {
    publishedAt: '2026-01-03T03:00:00Z',
    reserves: {
      asOf: '2026-01-02',
      totalUsd: 1_000_000,
      sleeves: [
        { sleeve: 'emerging_markets_private_credit', usd: 900_000, share: 0.9 },
        { sleeve: 'cash_and_cash_equivalents', usd: 99_000, share: 0.099 },
        { sleeve: 'crypto', usd: 1_000, share: 0.001 },
      ],
      custodians: [
        {
          custodian: 'Private Credit - Facility 1',
          usd: 900_000,
          share: 0.9,
          valuedAsOf: '2025-12-01',
          holdings: [
            {
              symbol: 'PRIVATE_CREDIT',
              assetClass: 'private_credit',
              sleeve: 'emerging_markets_private_credit',
              quantity: null,
              usd: 900_000,
              valuedAsOf: '2025-12-01',
            },
          ],
        },
        {
          custodian: 'Custodian A',
          usd: 100_000.004,
          share: 0.1,
          valuedAsOf: '2026-01-02',
          holdings: [
            {
              symbol: 'XS0000000009',
              assetClass: 'bond_etf',
              sleeve: 'us_corporate_bonds',
              quantity: 120,
              usd: 99_000,
              valuedAsOf: '2026-01-02',
            },
            { symbol: 'ETH', assetClass: 'crypto', sleeve: 'crypto', quantity: 0.3, usd: 1_000, valuedAsOf: '2026-01-02' },
            { symbol: 'USDC', assetClass: 'stablecoin', sleeve: 'cash_and_cash_equivalents', quantity: 0.002, usd: 0.002, valuedAsOf: '2026-01-02' },
            { symbol: 'USDC', assetClass: 'stablecoin', sleeve: 'cash_and_cash_equivalents', quantity: 0.002, usd: 0.002, valuedAsOf: '2026-01-02' },
          ],
        },
      ],
    },
    supply: { asOf: '2026-01-01', usdr: 998_000, susdr: null },
    nav: { asOf: '2025-12-28', totalUsd: 1_003_100, perToken: 1.0031, tokensOutstanding: 1_000_000, source: 'NFS' },
    coverage: null,
    history: {
      supply: [
        { date: '2025-12-01', usdr: 900_000 },
        { date: '2026-01-01', usdr: 998_000 },
      ],
      nav: [
        { date: '2025-12-21', totalUsd: 990_000, perToken: 1.001 },
        { date: '2025-12-28', totalUsd: 1_003_100, perToken: 1.0031 },
      ],
    },
    ...overrides,
  };
}

function mountReserves(r: RealFiReservesReport) {
  return mount(Reserves, {
    props: { report: r },
    global: {
      config: {
        globalProperties: mockGlobalProperties({
          $t: (key: string, values?: Record<string, unknown> | number) =>
            typeof values === 'number' ? `${key}(${values})` : values ? `${key}${JSON.stringify(values)}` : key,
        }),
      },
      stubs: { 'v-icon': { template: '<i />' } },
    },
  });
}

/** The figures' labels, in order. */
function figureLabels(wrapper: ReturnType<typeof mountReserves>): string[] {
  return wrapper.findAll('.realfi-reserves__figure dt').map((dt) => dt.text());
}

describe('RealFiReserves', () => {
  it('leads with NAV and gives no backing ratio while RealFi publishes none', () => {
    const wrapper = mountReserves(report());
    expect(figureLabels(wrapper)).toEqual([
      'realfi.reserves.navPerToken',
      'realfi.reserves.nav',
      'realfi.reserves.supply',
      'realfi.reserves.custody',
    ]);
    expect(wrapper.text()).toContain('$1.0031');
    expect(wrapper.text()).not.toContain('realfi.reserves.coverage');
  });

  it('puts RealFi’s official ratio first once it is published', () => {
    const wrapper = mountReserves(report({ coverage: { asOf: '2026-01-02', ratio: 1.0031 } }));
    expect(figureLabels(wrapper)[0]).toBe('realfi.reserves.coverage');
  });

  it('shows a NAV total on its own when RealFi publishes no per-token figure', () => {
    const nav = report().nav!;
    const wrapper = mountReserves(report({ nav: { ...nav, perToken: null } }));
    expect(figureLabels(wrapper)).toEqual([
      'realfi.reserves.nav',
      'realfi.reserves.supply',
      'realfi.reserves.custody',
    ]);
    expect(wrapper.find('.realfi-reserves__pending').exists()).toBe(false);
  });

  it('prints a backing just under 100% as under it, and a published 0% as 0%', () => {
    const coverageText = (ratio: number) =>
      mountReserves(report({ coverage: { asOf: '2026-01-02', ratio } }))
        .findAll('.realfi-reserves__figure')[0]!
        .text();
    expect(coverageText(0.9996)).toContain('"value":"99.96"');
    expect(coverageText(0)).toContain('"value":"0.00"');
  });

  it('says NAV is not published yet rather than leaving a gap', () => {
    const wrapper = mountReserves(report({ nav: null }));
    expect(figureLabels(wrapper)).toContain('realfi.reserves.nav');
    expect(wrapper.find('.realfi-reserves__pending').text()).toBe('realfi.reserves.navPending');
  });

  it('lists every sleeve in the legend with its share', () => {
    const rows = mountReserves(report()).findAll('.realfi-reserves__legend-row');
    expect(rows.map((r) => r.text())).toEqual([
      expect.stringContaining('realfi.reserves.sleeve.emerging_markets_private_credit'),
      expect.stringContaining('realfi.reserves.sleeve.cash_and_cash_equivalents'),
      expect.stringContaining('realfi.reserves.sleeve.crypto'),
    ]);
  });

  it('keeps custodians folded until asked, then lists holdings with dust on one line', () => {
    const wrapper = mountReserves(report());
    const details = wrapper.find('details');
    expect(details.attributes('open')).toBeUndefined();

    const custodianRows = wrapper.findAll('.realfi-reserves__custodian');
    expect(custodianRows.map((r) => r.find('th').text())).toEqual([
      expect.stringContaining('Private Credit - Facility 1'),
      'Custodian A',
    ]);
    // Only the older valuation is called out; Custodian A was valued on the publish date.
    expect(custodianRows[0]!.text()).toContain('realfi.reserves.custodians.valuedOn');
    expect(custodianRows[1]!.text()).not.toContain('valuedOn');

    const holdings = wrapper.findAll('.realfi-reserves__holding');
    expect(holdings.map((h) => h.text())).toEqual([
      expect.stringContaining('realfi.reserves.symbol.loan'),
      expect.stringContaining('XS0000000009'),
      expect.stringContaining('ETH'),
      'realfi.reserves.custodians.small(2)',
    ]);
    expect(holdings[1]!.find('td').classes()).toContain('g-mono');
  });

  it('draws the trend only with two points to join', () => {
    expect(mountReserves(report()).find('.realfi-trend').exists()).toBe(true);
    const flat = report({ history: { supply: [{ date: '2026-01-01', usdr: 1 }], nav: [] } });
    expect(mountReserves(flat).find('.realfi-trend').exists()).toBe(false);
  });

  it('shows a NAV-only report without custody sections', () => {
    const wrapper = mountReserves(report({ reserves: null }));
    expect(wrapper.find('.realfi-reserves__mix').exists()).toBe(false);
    expect(wrapper.find('details').exists()).toBe(false);
    expect(figureLabels(wrapper)).not.toContain('realfi.reserves.custody');
  });
});
