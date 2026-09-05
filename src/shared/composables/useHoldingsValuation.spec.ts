// src/shared/composables/useHoldingsValuation.spec.ts
//
// Covers the CIP-113 display path: a token in walletStore.programmableTokens must
// surface as a holdings row, flagged and keyed so the dashboard can render it
// alongside spendable holdings. This is the layer between "the background has the
// data" and "the user sees it", and it had no coverage.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/chrome/serialization', () => ({
  getBalance: () => ({ coin: () => '0' }),
}));
vi.mock('@/modules/market/composables/useMarketData', () => ({
  useMarketData: () => ({ allTokens: { value: [] } }),
}));
vi.mock('@/shared/composables/useCurrencyConverter', () => ({
  useCurrencyConverter: () => ({ usdToEurRate: { value: 1 } }),
}));
vi.mock('@/modules/market/composables/useNativeCurrency', () => ({
  useNativeCurrency: () => ({
    currencyName: { value: 'Cardano' },
    currencyTicker: { value: 'ADA' },
  }),
}));
vi.mock('@/stores/priceStore', () => ({ priceStore: { adaUsd: { lastPrice: 0.4 } } }));
vi.mock('@/stores/networkStore', () => ({ networkStore: { price: { lastPrice: 0.4 } } }));
vi.mock('@/stores/coinGeckoStore', () => ({ coinGeckoStore: { cache: {} } }));
vi.mock('@/stores/tokenMetadataStore', () => ({ tokenMetadataStore: { tokens: {} } }));

import { walletStore } from '@/stores/walletStore';
import { useHoldingsValuation } from './useHoldingsValuation';

const PROGRAMMABLE_UNIT = '8f85b5bbdee80ace3a9f75140818d8fd0f9d9672802c4006e0bee92654657374313233';
const SPENDABLE_UNIT = 'aaaabbbbccccddddeeeeffff00001111222233334444555566667777';

function resetStore() {
  walletStore.loggedWallet = { chain: 'Cardano', network: 'Preview' };
  walletStore.utxos = [];
  walletStore.collateral = null;
  walletStore.tokens = {};
  walletStore.programmableTokens = {};
  walletStore.programmableLockedLovelace = '0';
}

describe('useHoldingsValuation — CIP-113 holdings', () => {
  beforeEach(resetStore);

  it('surfaces a programmable token as a holdings row', () => {
    walletStore.programmableTokens = {
      [PROGRAMMABLE_UNIT]: {
        unit: PROGRAMMABLE_UNIT,
        name: 'Test123',
        quantity: '10',
        policy_id: '8f85b5bbdee80ace3a9f75140818d8fd0f9d9672802c4006e0bee926',
        isProgrammable: true,
      },
    };

    const { holdings } = useHoldingsValuation();
    const row = holdings.value.find(r => r.unit === PROGRAMMABLE_UNIT);

    expect(row, 'programmable token produced no holdings row').toBeDefined();
    expect(row!.isProgrammable).toBe(true);
    expect(row!.balance).toBe(10);
  });

  it('gives the row a name so it does not render blank', () => {
    walletStore.programmableTokens = {
      [PROGRAMMABLE_UNIT]: { unit: PROGRAMMABLE_UNIT, name: 'Test123', quantity: '10' },
    };
    const row = useHoldingsValuation().holdings.value.find(r => r.unit === PROGRAMMABLE_UNIT);
    expect(row!.ticker).toBe('Test123');
  });

  it('keeps locked token holdings out of the portfolio total', () => {
    walletStore.programmableTokens = {
      [PROGRAMMABLE_UNIT]: { unit: PROGRAMMABLE_UNIT, name: 'Test123', quantity: '10' },
    };
    const { holdings, totals } = useHoldingsValuation();
    const row = holdings.value.find(r => r.unit === PROGRAMMABLE_UNIT);
    expect(row!.value).toBe(0);
    expect(totals.value.usd).toBe(0);
  });

  it('gives spendable and locked rows of the same unit distinct keys', () => {
    walletStore.tokens = {
      [SPENDABLE_UNIT]: { unit: SPENDABLE_UNIT, name: 'Dual', quantity: '5' },
    };
    walletStore.programmableTokens = {
      [SPENDABLE_UNIT]: { unit: SPENDABLE_UNIT, name: 'Dual', quantity: '7' },
    };

    const rows = useHoldingsValuation().holdings.value.filter(r => r.unit === SPENDABLE_UNIT);
    expect(rows).toHaveLength(2);
    // v-data-table keys on rowKey; identical keys collide and drop a row.
    expect(new Set(rows.map(r => r.rowKey)).size).toBe(2);
    expect(rows.some(r => r.isProgrammable)).toBe(true);
    expect(rows.some(r => !r.isProgrammable)).toBe(true);
  });

  it('every row carries a rowKey, so item-key never resolves to undefined', () => {
    walletStore.tokens = {
      [SPENDABLE_UNIT]: { unit: SPENDABLE_UNIT, name: 'Plain', quantity: '5' },
    };
    walletStore.programmableTokens = {
      [PROGRAMMABLE_UNIT]: { unit: PROGRAMMABLE_UNIT, name: 'Test123', quantity: '10' },
    };
    const rows = useHoldingsValuation().holdings.value;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(r => typeof r.rowKey === 'string' && r.rowKey.length > 0)).toBe(true);
  });

  it('surfaces locked ADA as its own row, keyed apart from spendable ADA', () => {
    walletStore.programmableLockedLovelace = '2500000';

    const rows = useHoldingsValuation().holdings.value.filter(r => r.unit === 'lovelace');
    const locked = rows.find(r => r.isProgrammable);

    expect(locked, 'locked lovelace produced no row').toBeDefined();
    expect(locked!.rowKey).toBe('lovelace#locked');
    // 6 decimals — the row must read 2.5 ADA, not 2500000.
    expect(locked!.balance).toBe(2.5);
  });

  it('prices locked ADA at the native rate and counts it in the portfolio total', () => {
    walletStore.programmableLockedLovelace = '2500000';

    const { holdings, totals } = useHoldingsValuation();
    const locked = holdings.value.find(r => r.unit === 'lovelace' && r.isProgrammable);

    // It is the user's ADA at the native price — zeroing it would understate holdings.
    expect(locked!.price).toBe(0.4);
    expect(locked!.value).toBeCloseTo(1.0);
    expect(totals.value.usd).toBeCloseTo(1.0);
  });

  it('still leaves locked TOKENS unpriced — position at the PLB address proves nothing', () => {
    walletStore.programmableTokens = {
      [PROGRAMMABLE_UNIT]: { unit: PROGRAMMABLE_UNIT, name: 'Test123', quantity: '10' },
    };
    const { holdings, totals } = useHoldingsValuation();
    const row = holdings.value.find(r => r.unit === PROGRAMMABLE_UNIT);

    expect(row!.price).toBe(0);
    expect(row!.value).toBe(0);
    expect(totals.value.usd).toBe(0);
  });

  it('renders no locked-ADA row when nothing is locked', () => {
    walletStore.programmableLockedLovelace = '0';

    const rows = useHoldingsValuation().holdings.value;
    expect(rows.find(r => r.unit === 'lovelace' && r.isProgrammable)).toBeUndefined();
  });

  it('drops zero-quantity entries rather than rendering an empty row', () => {
    walletStore.programmableTokens = {
      [PROGRAMMABLE_UNIT]: { unit: PROGRAMMABLE_UNIT, name: 'Test123', quantity: '0' },
    };
    expect(useHoldingsValuation().holdings.value.find(r => r.unit === PROGRAMMABLE_UNIT)).toBeUndefined();
  });
});
