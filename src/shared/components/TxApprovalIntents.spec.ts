import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { Cardano } from '@cardano-sdk/core';
// @ts-ignore: tsconfig ships no `*.vue` shim; vite resolves this fine.
import TxApprovalIntents from './TxApprovalIntents.vue';
import {
  buildTxApprovalSummary,
  createdListingWarns,
  type ApprovalCreatedListing,
  type ApprovalListedInput,
  type TxApprovalSummary,
} from '@/shared/utils/txApprovalSummary';

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
    resolveAsset: () => ({ name: 'Token', decimals: 0 }), ownListings: new Map(), listingScriptHashes: new Set(), listingFees: new Map(),
  });
  return { ...base, ...over };
}

const listed = (ref: string, unit: string, label: string, priceLovelace: bigint, nftLeavesWallet = false): ApprovalListedInput =>
  ({ ref, unit, label, priceLovelace, nftLeavesWallet });

/** A created listing that is the wallet's own, at 25 ADA, nothing else to say. */
const createdListing = (over: Partial<ApprovalCreatedListing> = {}): ApprovalCreatedListing => ({
  outputIndex: 0,
  datum: 'ok',
  priceLovelace: 25_000_000n,
  royaltyCount: 0,
  royaltyTotalLovelace: 0n,
  sellerShareLovelace: 23_500_000n,
  ownerIsOwn: true,
  sellerIsOwn: true,
  hasBuyer: false,
  paysSomeoneElse: false,
  tooManyRoyalties: false,
  highRoyalties: false,
  lowSellerShare: false,
  ...over,
});

/** The summary fields the builder derives from the created listings and the spent ones. */
const withMarket = (listings: ApprovalCreatedListing[], inputs: ApprovalListedInput[] = [], rest: Partial<TxApprovalSummary> = {}): TxApprovalSummary =>
  summaryWith({
    listedInputs: inputs,
    createdListings: listings,
    createsListing: listings.length > 0,
    createdListingCount: listings.length,
    requiresMarketAck: listings.some(createdListingWarns) || inputs.some((l) => l.nftLeavesWallet),
    ...rest,
  });

// A checkbox that reports what the user does, as Vuetify's would.
const CHECKBOX = {
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: '<input type="checkbox" class="stub-checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
};

const mountWith = (summary: TxApprovalSummary, props: Record<string, unknown> = {}) => mount(TxApprovalIntents, {
  props: { summary, networkAck: false, ...props },
  global: { config: { globalProperties: mockGlobalProperties({ $t }) }, stubs: { 'v-icon': true, 'v-checkbox': CHECKBOX } },
});

const SPEND = () => listed(`${'a1'.repeat(32)}#0`, NFT, 'Gero Cat #7', 25_000_000n);

describe('TxApprovalIntents: spending an own Gero listing', () => {
  it('shows "Spends your listing" with the NFT, its listed price and the full unit', () => {
    const w = mountWith(withMarket([], [SPEND()]));
    const row = w.find('[data-testid="tx-intent-listing-spend"]');
    expect(row.exists()).toBe(true);
    expect(row.text()).toContain('signTx.spendsYourListing');
    expect(row.text()).toContain('signTx.listedFor|{"name":"Gero Cat #7","price":"25.00"}');
    // The policy id and name, in full, so the NFT can be checked rather than trusted by its label.
    expect(row.text()).toContain(NFT);
  });

  it('draws the spend in the warning tone, not a chip', () => {
    const w = mountWith(withMarket([], [SPEND()]));
    const row = w.find('[data-testid="tx-intent-listing-spend"]');
    expect(row.find('v-icon-stub').attributes('color')).toBe('warning');
    expect(row.find('.warning--text').text()).toBe('signTx.spendsYourListing');
    expect(row.find('.v-chip').exists()).toBe(false);
  });

  it('says the NFT stays with the wallet, and asks for nothing, when it lands in an own output', () => {
    const w = mountWith(withMarket([], [SPEND()]));
    expect(w.find('[data-testid="tx-intent-listing-spend-hint"]').text()).toBe('signTx.spendsYourListingHint');
    expect(w.find('[data-testid="tx-intent-listing-nft-leaves"]').exists()).toBe(false);
    expect(w.find('[data-testid="tx-market-risk-banner"]').exists()).toBe(false);
  });

  it('warns in the error tone, drops the reassuring hint and asks for acknowledgement when the NFT leaves the wallet', () => {
    const w = mountWith(withMarket([], [listed(`${'a1'.repeat(32)}#0`, NFT, 'Gero Cat #7', 25_000_000n, true)]));
    const row = w.find('[data-testid="tx-intent-listing-spend"]');
    expect(row.find('v-icon-stub').attributes('color')).toBe('error');
    const leaves = w.find('[data-testid="tx-intent-listing-nft-leaves"]');
    expect(leaves.text()).toBe('signTx.listingNftLeaves');
    expect(leaves.classes()).toContain('error--text');
    expect(w.find('[data-testid="tx-intent-listing-spend-hint"]').exists()).toBe(false);
    expect(w.find('[data-testid="tx-market-risk-banner"]').exists()).toBe(true);
  });

  it('shows one row per spent listing, each with its own price, and the hint once for the group', () => {
    const w = mountWith(withMarket([], [SPEND(), listed(`${'c3'.repeat(32)}#2`, OTHER_NFT, 'Gero Cat #8', 7_500_000n)]));
    const rows = w.findAll('[data-testid="tx-intent-listing-spend"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain('"price":"25.00"');
    expect(rows[1].text()).toContain('"name":"Gero Cat #8","price":"7.50"');
    expect(w.findAll('[data-testid="tx-intent-listing-spend-hint"]')).toHaveLength(1);
  });

  it('keeps the hint off the group as soon as one of the NFTs leaves', () => {
    const w = mountWith(withMarket([], [SPEND(), listed(`${'c3'.repeat(32)}#2`, OTHER_NFT, 'Gero Cat #8', 7_500_000n, true)]));
    expect(w.findAll('[data-testid="tx-intent-listing-nft-leaves"]')).toHaveLength(1);
    expect(w.find('[data-testid="tx-intent-listing-spend-hint"]').exists()).toBe(false);
  });
});

describe('TxApprovalIntents: creating a Gero listing', () => {
  it('shows the price, what the seller keeps and the reassuring hint for the wallet\'s own plain listing', () => {
    const w = mountWith(withMarket([createdListing()]));
    const row = w.find('[data-testid="tx-intent-creates-listing"]');
    expect(row.exists()).toBe(true);
    expect(row.text()).toContain('signTx.createsMarketListing');
    expect(row.text()).toContain('signTx.listingPrice|{"price":"25.00"}');
    expect(row.text()).toContain('signTx.listingSellerReceives|{"amount":"23.50"}');
    expect(row.find('v-icon-stub').attributes('color')).toBe('warning');
    expect(row.find('.warning--text').exists()).toBe(true);
    // Benign only because owner and seller are the wallet's and nothing warns.
    expect(row.find('[data-testid="tx-intent-creates-listing-hint"]').text()).toBe('signTx.createsMarketListingHint');
    expect(row.find('.error--text').exists()).toBe(false);
    expect(w.find('[data-testid="tx-market-risk-banner"]').exists()).toBe(false);
  });

  it('says so, in the error tone, and asks for acknowledgement when the owner is not the wallet', () => {
    const w = mountWith(withMarket([createdListing({ ownerIsOwn: false, paysSomeoneElse: true })]));
    const row = w.find('[data-testid="tx-intent-creates-listing"]');
    const line = row.find('[data-testid="tx-intent-listing-owner-not-you"]');
    expect(line.text()).toBe('signTx.listingOwnerNotYou');
    expect(line.classes()).toContain('error--text');
    expect(row.find('v-icon-stub').attributes('color')).toBe('error');
    expect(row.find('[data-testid="tx-intent-creates-listing-hint"]').exists()).toBe(false);
    expect(w.find('[data-testid="tx-market-risk-banner"]').exists()).toBe(true);
  });

  it('says so when the seller (who is paid) is not the wallet', () => {
    const w = mountWith(withMarket([createdListing({ sellerIsOwn: false, paysSomeoneElse: true })]));
    const line = w.find('[data-testid="tx-intent-listing-seller-not-you"]');
    expect(line.text()).toBe('signTx.listingSellerNotYou');
    expect(line.classes()).toContain('error--text');
    expect(w.find('[data-testid="tx-intent-listing-owner-not-you"]').exists()).toBe(false);
    expect(w.find('[data-testid="tx-market-risk-banner"]').exists()).toBe(true);
  });

  it('shows no price for terms that cannot be read, and names why: a datum hash, none, or not a listing', () => {
    const unreadable = (datum: 'datumHash' | 'missing' | 'undecodable'): ApprovalCreatedListing => createdListing({
      datum, priceLovelace: null, royaltyTotalLovelace: null, sellerShareLovelace: null, ownerIsOwn: false, sellerIsOwn: false, paysSomeoneElse: true,
    });
    for (const [datum, key] of [['datumHash', 'signTx.listingDatumHash'], ['missing', 'signTx.listingDatumMissing'], ['undecodable', 'signTx.listingDatumUnreadable']] as const) {
      const w = mountWith(withMarket([unreadable(datum)]));
      const row = w.find('[data-testid="tx-intent-creates-listing"]');
      const line = row.find('[data-testid="tx-intent-listing-datum-problem"]');
      expect(line.text()).toBe(key);
      expect(line.classes()).toContain('error--text');
      expect(row.text()).not.toContain('signTx.listingPrice');
      expect(row.text()).not.toContain('signTx.listingOwnerNotYou');
      expect(row.find('[data-testid="tx-intent-creates-listing-hint"]').exists()).toBe(false);
      expect(w.find('[data-testid="tx-market-risk-banner"]').exists()).toBe(true);
    }
  });

  it('shows the royalty count and total, plain when modest', () => {
    const w = mountWith(withMarket([createdListing({ royaltyCount: 2, royaltyTotalLovelace: 4_000_000n })]));
    const line = w.find('[data-testid="tx-intent-listing-royalties"]');
    expect(line.text()).toBe('signTx.listingRoyalties|{"count":2,"total":"4.00"}|plural=2');
    expect(line.classes()).not.toContain('error--text');
    expect(w.find('[data-testid="tx-market-risk-banner"]').exists()).toBe(false);
  });

  it('shows no royalty line for none', () => {
    expect(mountWith(withMarket([createdListing()])).find('[data-testid="tx-intent-listing-royalties"]').exists()).toBe(false);
  });

  it('warns about too many payees, royalties above the cap, and a seller share at the floor', () => {
    const tooMany = mountWith(withMarket([createdListing({ royaltyCount: 4, royaltyTotalLovelace: 4_000_000n, tooManyRoyalties: true })]));
    expect(tooMany.find('[data-testid="tx-intent-listing-too-many-royalties"]').text()).toBe('signTx.listingTooManyRoyalties|{"max":3}');
    expect(tooMany.find('[data-testid="tx-intent-listing-royalties"]').classes()).toContain('error--text');
    expect(tooMany.find('[data-testid="tx-market-risk-banner"]').exists()).toBe(true);

    const high = mountWith(withMarket([createdListing({ royaltyCount: 1, royaltyTotalLovelace: 11_000_000n, highRoyalties: true })]));
    expect(high.find('[data-testid="tx-intent-listing-high-royalties"]').text()).toBe('signTx.listingHighRoyalties|{"percent":10}');
    expect(high.find('[data-testid="tx-market-risk-banner"]').exists()).toBe(true);

    const low = mountWith(withMarket([createdListing({ sellerShareLovelace: 1_500_000n, lowSellerShare: true })]));
    expect(low.find('[data-testid="tx-intent-listing-low-share"]').text()).toBe('signTx.listingLowShare');
    expect(low.find('[data-testid="tx-intent-listing-low-share"]').classes()).toContain('error--text');
    expect(low.find('[data-testid="tx-market-risk-banner"]').exists()).toBe(true);
  });

  it('notes a private listing without asking for anything', () => {
    const w = mountWith(withMarket([createdListing({ hasBuyer: true })]));
    expect(w.find('[data-testid="tx-intent-listing-private"]').text()).toBe('signTx.listingPrivate');
    expect(w.find('[data-testid="tx-market-risk-banner"]').exists()).toBe(false);
  });

  it('shows one block per created listing, each judged on its own terms', () => {
    const w = mountWith(withMarket([createdListing(), createdListing({ outputIndex: 2, ownerIsOwn: false, paysSomeoneElse: true })]));
    const rows = w.findAll('[data-testid="tx-intent-creates-listing"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].find('[data-testid="tx-intent-creates-listing-hint"]').exists()).toBe(true);
    expect(rows[1].find('[data-testid="tx-intent-listing-owner-not-you"]').exists()).toBe(true);
    expect(rows[1].find('[data-testid="tx-intent-creates-listing-hint"]').exists()).toBe(false);
  });
});

describe('TxApprovalIntents: the market acknowledgement', () => {
  const risky = () => withMarket([createdListing({ ownerIsOwn: false, paysSomeoneElse: true })]);

  it('shows the blocking banner with its checkbox only when the summary requires it', () => {
    const banner = mountWith(risky()).find('[data-testid="tx-market-risk-banner"]');
    expect(banner.text()).toContain('signTx.marketRiskTitle');
    expect(banner.text()).toContain('signTx.marketRiskBody');
    expect(banner.find('.stub-checkbox').exists()).toBe(true);
    expect(mountWith(withMarket([createdListing()])).find('[data-testid="tx-market-risk-banner"]').exists()).toBe(false);
  });

  it('reflects the acknowledgement the parent holds and reports a tick', async () => {
    const unchecked = mountWith(risky(), { marketAck: false });
    expect((unchecked.find('.stub-checkbox').element as HTMLInputElement).checked).toBe(false);
    await unchecked.find('.stub-checkbox').setValue(true);
    expect(unchecked.emitted('update:marketAck')).toEqual([[true]]);
    expect((mountWith(risky(), { marketAck: true }).find('.stub-checkbox').element as HTMLInputElement).checked).toBe(true);
  });
});

describe('TxApprovalIntents: Gero market listings, in general', () => {
  it('shows both a spend and a creation for a reprice, ahead of every other effect', () => {
    const w = mountWith(withMarket([createdListing()], [SPEND()], { referenceInputCount: 1, hasMetadata: true }));
    const text = w.text();
    expect(text.indexOf('signTx.spendsYourListing')).toBeGreaterThan(-1);
    expect(text.indexOf('signTx.createsMarketListing')).toBeGreaterThan(-1);
    expect(text.indexOf('signTx.spendsYourListing')).toBeLessThan(text.indexOf('signTx.referenceInputs'));
    expect(text.indexOf('signTx.createsMarketListing')).toBeLessThan(text.indexOf('signTx.includesMetadata'));
  });

  it('opens the effects block for a market effect alone', () => {
    expect(mountWith(withMarket([createdListing()])).find('.tx-intents').exists()).toBe(true);
    expect(mountWith(withMarket([], [SPEND()])).find('.tx-intents').exists()).toBe(true);
  });

  it('shows nothing about listings, no effects block and no banner, for a transaction that touches none', () => {
    const w = mountWith(summaryWith());
    expect(w.find('[data-testid="tx-intent-listing-spend"]').exists()).toBe(false);
    expect(w.find('[data-testid="tx-intent-creates-listing"]').exists()).toBe(false);
    expect(w.find('[data-testid="tx-market-risk-banner"]').exists()).toBe(false);
    expect(w.find('.tx-intents').exists()).toBe(false);
    expect(w.text()).not.toContain('signTx.spendsYourListing');
    expect(w.text()).not.toContain('signTx.createsMarketListing');
  });
});
