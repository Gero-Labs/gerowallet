import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { Cardano } from '@cardano-sdk/core';
// @ts-ignore: tsconfig ships no `*.vue` shim; vite resolves this fine.
import TxApprovalIntents from './TxApprovalIntents.vue';
import { buildTxApprovalSummary, type ApprovalListedInput, type TxApprovalSummary } from '@/shared/utils/txApprovalSummary';

vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

// Echo the key, its arguments and the plural count, so a row's copy and what it was given can be asserted.
const $t = (key: string, args?: Record<string, unknown>, plural?: number) =>
  `${key}${args ? `|${JSON.stringify(args)}` : ''}${plural === undefined ? '' : `|plural=${plural}`}`;

const NFT = `${'b'.repeat(56)}${Buffer.from('Gero Cat #7').toString('hex')}`;
const OTHER_NFT = `${'c'.repeat(56)}${Buffer.from('Gero Cat #8').toString('hex')}`;

/** A summary of an empty transaction, from the real builder, with the given fields overridden. */
function summaryWith(over: Partial<TxApprovalSummary> = {}): TxApprovalSummary {
  const tx = { id: '0'.repeat(64), body: { inputs: [], outputs: [], fee: 170_000n }, witness: {} } as unknown as Cardano.Tx;
  const base = buildTxApprovalSummary(tx, {
    paymentAddresses: new Set(), changeAddresses: new Set(), ownPaymentKeyHashes: new Set(), ownStakeKeyHashes: new Set(),
    ownRewardAccounts: new Set(), ownDrepKeyHashes: new Set(), ownCcHotKeyHashes: new Set(), walletNetworkId: Cardano.NetworkId.Testnet,
    resolveAsset: () => ({ name: 'Token', decimals: 0 }), ownListings: new Map(), listingScriptHashes: new Set(),
  });
  return { ...base, ...over };
}

const listed = (ref: string, unit: string, label: string, priceLovelace: bigint): ApprovalListedInput => ({ ref, unit, label, priceLovelace });

const mountWith = (summary: TxApprovalSummary) => mount(TxApprovalIntents, {
  props: { summary, networkAck: false },
  global: { config: { globalProperties: mockGlobalProperties({ $t }) }, stubs: { 'v-icon': true, 'v-checkbox': true } },
});

describe('TxApprovalIntents: Gero market listings', () => {
  it('shows "Spends your listing" with the NFT, its listed price and the full unit', () => {
    const w = mountWith(summaryWith({ listedInputs: [listed(`${'a1'.repeat(32)}#0`, NFT, 'Gero Cat #7', 25_000_000n)] }));
    const row = w.find('[data-testid="tx-intent-listing-spend"]');
    expect(row.exists()).toBe(true);
    expect(row.text()).toContain('signTx.spendsYourListing');
    expect(row.text()).toContain('signTx.listedFor|{"name":"Gero Cat #7","price":"25.00"}');
    // The policy id and name, in full, so the NFT can be checked rather than trusted by its label.
    expect(row.text()).toContain(NFT);
  });

  it('draws the spend in the warning tone, not a chip', () => {
    const w = mountWith(summaryWith({ listedInputs: [listed(`${'a1'.repeat(32)}#0`, NFT, 'Gero Cat #7', 25_000_000n)] }));
    const row = w.find('[data-testid="tx-intent-listing-spend"]');
    expect(row.find('v-icon-stub').attributes('color')).toBe('warning');
    expect(row.find('.warning--text').text()).toBe('signTx.spendsYourListing');
    expect(row.find('.v-chip').exists()).toBe(false);
  });

  it('shows one row per spent listing, each with its own price', () => {
    const w = mountWith(summaryWith({
      listedInputs: [
        listed(`${'a1'.repeat(32)}#0`, NFT, 'Gero Cat #7', 25_000_000n),
        listed(`${'c3'.repeat(32)}#2`, OTHER_NFT, 'Gero Cat #8', 7_500_000n),
      ],
    }));
    const rows = w.findAll('[data-testid="tx-intent-listing-spend"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain('"price":"25.00"');
    expect(rows[1].text()).toContain('"name":"Gero Cat #8","price":"7.50"');
    // The explanation is given once for the group.
    expect(w.findAll('[data-testid="tx-intent-listing-spend-hint"]')).toHaveLength(1);
  });

  it('shows "Creates a market listing", with the count when there are several', () => {
    const one = mountWith(summaryWith({ createsListing: true, createdListingCount: 1 }));
    const row = one.find('[data-testid="tx-intent-creates-listing"]');
    expect(row.exists()).toBe(true);
    expect(row.text()).toContain('signTx.createsMarketListing|{"count":1}|plural=1');
    expect(row.find('v-icon-stub').attributes('color')).toBe('warning');
    expect(row.find('.warning--text').exists()).toBe(true);

    const three = mountWith(summaryWith({ createsListing: true, createdListingCount: 3 }));
    expect(three.find('[data-testid="tx-intent-creates-listing"]').text()).toContain('signTx.createsMarketListing|{"count":3}|plural=3');
  });

  it('shows both a spend and a creation for a reprice, ahead of every other effect', () => {
    const w = mountWith(summaryWith({
      listedInputs: [listed(`${'a1'.repeat(32)}#0`, NFT, 'Gero Cat #7', 25_000_000n)],
      createsListing: true,
      createdListingCount: 1,
      referenceInputCount: 1,
      hasMetadata: true,
    }));
    const text = w.text();
    expect(text.indexOf('signTx.spendsYourListing')).toBeGreaterThan(-1);
    expect(text.indexOf('signTx.createsMarketListing')).toBeGreaterThan(-1);
    expect(text.indexOf('signTx.spendsYourListing')).toBeLessThan(text.indexOf('signTx.referenceInputs'));
    expect(text.indexOf('signTx.createsMarketListing')).toBeLessThan(text.indexOf('signTx.includesMetadata'));
    expect(w.find('[data-testid="tx-intent-creates-listing-hint"]').exists()).toBe(true);
  });

  it('opens the effects block for a market effect alone', () => {
    expect(mountWith(summaryWith({ createsListing: true, createdListingCount: 1 })).find('.tx-intents').exists()).toBe(true);
    expect(mountWith(summaryWith({ listedInputs: [listed(`${'a1'.repeat(32)}#0`, NFT, 'n', 5_000_000n)] })).find('.tx-intents').exists()).toBe(true);
  });

  it('shows nothing about listings, and no effects block, for a transaction that touches none', () => {
    const w = mountWith(summaryWith());
    expect(w.find('[data-testid="tx-intent-listing-spend"]').exists()).toBe(false);
    expect(w.find('[data-testid="tx-intent-creates-listing"]').exists()).toBe(false);
    expect(w.find('.tx-intents').exists()).toBe(false);
    expect(w.text()).not.toContain('signTx.spendsYourListing');
    expect(w.text()).not.toContain('signTx.createsMarketListing');
  });
});
