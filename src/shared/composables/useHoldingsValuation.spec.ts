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
import { tokenMetadataStore } from '@/stores/tokenMetadataStore';
import { useHoldingsValuation } from './useHoldingsValuation';
import { REALFI_ASSETS } from '@/modules/realfi/assets';

const PROGRAMMABLE_UNIT = '8f85b5bbdee80ace3a9f75140818d8fd0f9d9672802c4006e0bee92654657374313233';
const SPENDABLE_UNIT = 'aaaabbbbccccddddeeeeffff00001111222233334444555566667777';

function resetStore() {
  walletStore.loggedWallet = { chain: 'Cardano', network: 'Preview' };
  walletStore.utxos = [];
  walletStore.collateral = null;
  walletStore.tokens = {};
  walletStore.programmableTokens = {};
  walletStore.programmableLockedLovelace = '0';
  walletStore.listedListings = [];
  tokenMetadataStore.tokens = {};
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

// The wallet's own Gero NFT market listings hold lovelace too (the deposit that returns to the
// seller): the user's, not Gero-spendable, inside no spendable figure. Like the locked CIP-113
// ADA it is a row of its own, keyed apart from spendable ADA and from the CIP-113 row, priced at
// the native rate and counted in the portfolio total.
describe('useHoldingsValuation — own listing deposits', () => {
  beforeEach(resetStore);

  /** The wallet's own listings holding these deposits: the locked total is derived from them. */
  const listedWith = (...deposits: string[]) => {
    walletStore.listedListings = deposits.map((depositLovelace, i) => ({
      ref: `${String(i + 1).repeat(64)}#0`,
      unit: `${'a'.repeat(56)}${i.toString(16).padStart(2, '0')}`,
      datum: { owner: '0'.repeat(56), sellerAddress: 'addr_test1seller', price: 100_000_000n, royalties: [], buyer: null },
      depositLovelace,
      deploymentVersion: 1,
    }));
  };

  it('surfaces the listed lovelace as its own row, keyed apart from spendable ADA', () => {
    listedWith('3500000');

    const rows = useHoldingsValuation().holdings.value.filter(r => r.unit === 'lovelace');
    const listed = rows.find(r => r.isListed);

    expect(listed, 'listed lovelace produced no row').toBeDefined();
    expect(listed!.rowKey).toBe('lovelace#listed');
    expect(listed!.balance).toBe(3.5);
    expect(listed!.isProgrammable).toBe(false);
  });

  it('prices it at the native rate and counts it in the portfolio total', () => {
    listedWith('2500000');

    const { holdings, totals } = useHoldingsValuation();
    const listed = holdings.value.find(r => r.isListed);

    expect(listed!.price).toBe(0.4);
    expect(listed!.value).toBeCloseTo(1.0);
    expect(totals.value.usd).toBeCloseTo(1.0);
  });

  it('keeps it apart from the locked CIP-113 ADA row', () => {
    walletStore.programmableLockedLovelace = '2500000';
    listedWith('1000000');

    const rows = useHoldingsValuation().holdings.value.filter(r => r.unit === 'lovelace');

    expect(rows.map(r => r.rowKey).sort()).toEqual(['lovelace#listed', 'lovelace#locked']);
    expect(rows.find(r => r.isListed)!.balance).toBe(1);
    expect(rows.find(r => r.isProgrammable)!.balance).toBe(2.5);
  });

  it('names it "ADA in your listings", so it never reads as a second unlabeled ADA row', () => {
    listedWith('3500000');
    walletStore.programmableLockedLovelace = '2500000';
    walletStore.utxos = [];

    const rows = useHoldingsValuation().holdings.value.filter(r => r.unit === 'lovelace');
    const listed = rows.find(r => r.isListed)!;

    expect(listed.name).toBe('ADA in your listings');
    // Still ADA: the ticker, and so every place that matches on it, is unchanged.
    expect(listed.ticker).toBe('ADA');
    // The CIP-113 row keeps its own wording.
    expect(rows.find(r => r.isProgrammable)!.name).not.toBe('ADA in your listings');
  });

  it('sums the deposits of every listing into the one row', () => {
    listedWith('2000000', '1500000');
    expect(useHoldingsValuation().holdings.value.find(r => r.isListed)!.balance).toBe(3.5);
  });

  it('renders no listed-ADA row when nothing is listed, or the stored value is unreadable', () => {
    listedWith('0');
    expect(useHoldingsValuation().holdings.value.find(r => r.isListed)).toBeUndefined();

    listedWith('not-a-number');
    expect(useHoldingsValuation().holdings.value.find(r => r.isListed)).toBeUndefined();
  });
});

// RealFi's USDrf/sUSDrf are canonical but new at launch, so neither the market API nor
// DexHunter vouches for them. The portfolio's verified-only filter (the mainnet
// default) would otherwise hide a user's staked balance from their own holdings.
// Issue 1267: a token at the PLB address counts as CIP-113 only when the registry lists its
// policy. Anything else is shown as an ordinary unverified token, still locked.
describe('useHoldingsValuation — CIP-113 registry', () => {
  beforeEach(resetStore);

  const UNREGISTERED_UNIT = 'd'.repeat(56) + '41495244524f50';
  const held = (unit: string, cip113Registered?: boolean) => ({
    unit, name: unit.slice(56), quantity: '10', policy_id: unit.slice(0, 56), isProgrammable: true,
    ...(cip113Registered === undefined ? {} : { cip113Registered }),
  });

  it('marks the token the registry lists, and only that one', () => {
    walletStore.programmableTokens = {
      [PROGRAMMABLE_UNIT]: held(PROGRAMMABLE_UNIT, true),
      [UNREGISTERED_UNIT]: held(UNREGISTERED_UNIT, false),
    };

    const { holdings } = useHoldingsValuation();
    expect(holdings.value.find(r => r.unit === PROGRAMMABLE_UNIT)?.cip113Registered).toBe(true);
    const spam = holdings.value.find(r => r.unit === UNREGISTERED_UNIT);
    expect(spam?.cip113Registered).toBe(false);
    expect(spam?.isProgrammable).toBe(true);
  });

  it('shows an unregistered locked token as unverified whatever its metadata says', () => {
    tokenMetadataStore.tokens = { [UNREGISTERED_UNIT]: { verified: true } };
    walletStore.programmableTokens = { [UNREGISTERED_UNIT]: held(UNREGISTERED_UNIT) };

    const { holdings } = useHoldingsValuation();
    expect(holdings.value.find(r => r.unit === UNREGISTERED_UNIT)?.verified).toBe(false);
  });

  it('leaves the same token spendable elsewhere as verified as its metadata says', () => {
    tokenMetadataStore.tokens = { [UNREGISTERED_UNIT]: { verified: true } };
    walletStore.tokens = { [UNREGISTERED_UNIT]: { quantity: '3', policy_id: 'd'.repeat(56) } };

    const { holdings } = useHoldingsValuation();
    const row = holdings.value.find(r => r.unit === UNREGISTERED_UNIT);
    expect(row?.verified).toBe(true);
    expect(row?.cip113Registered).toBe(false);
  });
});

describe('useHoldingsValuation — RealFi assets', () => {
  beforeEach(resetStore);

  it('counts USDrf and sUSDrf as verified before any market source lists them', () => {
    const { usdr, susdr } = REALFI_ASSETS.mainnet;
    walletStore.loggedWallet = { chain: 'Cardano', network: 'Mainnet' };
    walletStore.tokens = {
      [usdr]: { unit: usdr, name: 'USDrf', quantity: '1000000' },
      [susdr]: { unit: susdr, name: 'sUSDrf', quantity: '1000000' },
      [SPENDABLE_UNIT]: { unit: SPENDABLE_UNIT, name: 'Unlisted', quantity: '5' },
    };

    const rows = useHoldingsValuation().holdings.value;

    expect(rows.find(r => r.unit === usdr)?.verified).toBe(true);
    expect(rows.find(r => r.unit === susdr)?.verified).toBe(true);
    // The allowlist is exactly these assets — an unlisted token stays unverified.
    expect(rows.find(r => r.unit === SPENDABLE_UNIT)?.verified).toBe(false);
  });
});
