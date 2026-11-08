// The collectibles gallery. The NFTs the wallet has listed are locked at the market contract, so
// the sync leaves them out of the wallet's collections; where Gero's market is available the
// gallery adds them back, so a seller still sees what they listed (and can edit its price or take
// it down), and marks the collections that hold listed NFTs. With the market off the gallery is
// exactly the store's collections, as it always was.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';
import type { OwnListing } from '@/chrome/nftMarket/ownListings';
import { i18nPlugin } from '@/plugins/i18n';
import { Blockchain, Network, WalletType } from '@/models/types';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { walletStore } from '@/stores/walletStore';

// BaseDialog is a v-dialog (teleported); a plain wrapper keeps the content in the test's DOM.
vi.mock('@/shared/dialogs/BaseDialog.vue', () => ({
  default: { props: ['isOpen'], emits: ['close'], template: `<div v-if="isOpen" data-test="dialog"><slot /></div>` },
}));

import CollectiblesTab from './CollectiblesTab.vue';

enableAutoUnmount(afterEach);

const POLICY_CATS = 'cd'.repeat(28);
const POLICY_APES = 'ef'.repeat(28);
const CAT_1 = `${POLICY_CATS}436174${'31'}`; // "Cat1"
const CAT_2 = `${POLICY_CATS}436174${'32'}`; // "Cat2"
const APE_1 = `${POLICY_APES}417065${'31'}`; // "Ape1"

const item = (unit: string, name: string) => ({
  unit,
  name,
  img: `https://img.example/${name}`,
  policy_id: unit.slice(0, 56),
  asset_name: unit.slice(56),
  fingerprint: `asset1${name}`,
  quantity: '1',
  metadata: null,
  onchain_metadata: null,
});

const storeListing = (unit: string, price: string): OwnListing =>
  ({
    ref: `${unit.slice(56)}${'11'.repeat(30)}#0`,
    unit,
    datum: { owner: 'aa'.repeat(28), sellerAddress: 'addr_test1seller', price, royalties: [], buyer: null },
    depositLovelace: '1550000',
    deploymentVersion: 1,
  }) as unknown as OwnListing;

function render() {
  return mount(CollectiblesTab, {
    attachTo: document.body,
    global: { plugins: [createTestVuetify(), i18nPlugin], stubs: { 'v-pagination': true } },
  });
}

type Wrapper = ReturnType<typeof render>;
const cardNames = (wrapper: Wrapper) => wrapper.findAll('.collection-name-glass').map((n) => n.text());
const cardFor = (wrapper: Wrapper, name: string) => wrapper.findAll('.nft-collection-card').find((c) => c.text().includes(name))!;
const listedBadge = (card: ReturnType<typeof cardFor>) => card.find('[data-testid="collection-listed-badge"]');

beforeEach(() => {
  walletStore.loggedWallet = { id: 1, chain: Blockchain.CARDANO, network: Network.PREPROD, type: WalletType.Normal } as never;
  featureFlagsStore.state.flags.isNftMarketEnabled = true;
  walletStore.collections = {
    [POLICY_CATS]: { name: 'Cats', img: 'https://img.example/cats', quantity: 1, isScam: false, items: [item(CAT_1, 'Cat1')] },
  };
  walletStore.listedListings = [];
});
afterEach(() => {
  featureFlagsStore.state.flags.isNftMarketEnabled = false;
  walletStore.loggedWallet = null;
  walletStore.collections = {};
  walletStore.listedListings = [];
  document.body.replaceChildren();
});

describe('CollectiblesTab', () => {
  it('shows the wallet\'s collections as they are when nothing is listed', () => {
    const wrapper = render();
    expect(cardNames(wrapper)).toEqual(['Cats']);
    expect(listedBadge(cardFor(wrapper, 'Cats')).exists()).toBe(false);
  });

  it('shows a collection made only of listed NFTs, with the price it is listed at', () => {
    walletStore.listedListings = [storeListing(APE_1, '120000000')];
    const wrapper = render();

    expect(cardNames(wrapper).sort()).toEqual(['Ape1', 'Cats']);
    expect(listedBadge(cardFor(wrapper, 'Ape1')).text()).toBe('Listed · 120 tADA');
    expect(listedBadge(cardFor(wrapper, 'Cats')).exists()).toBe(false);
  });

  it('counts the listed NFTs of a collection that holds others', () => {
    walletStore.listedListings = [storeListing(CAT_2, '90500000')];
    const wrapper = render();
    // Two cats now: one held, one listed. The card says how many are listed.
    expect(cardNames(wrapper)).toEqual(['Cats']);
    expect(wrapper.get('.quantity-chip').text()).toContain('2');
    expect(listedBadge(cardFor(wrapper, 'Cats')).text()).toBe('1 listed');
  });

  it('says how many when several NFTs of a collection are listed', () => {
    walletStore.listedListings = [storeListing(CAT_2, '90500000'), storeListing(`${POLICY_CATS}436174${'33'}`, '70000000')];
    expect(listedBadge(cardFor(render(), 'Cats')).text()).toBe('2 listed');
  });

  it('follows the store: a listing that goes away takes its NFT and badge with it', async () => {
    walletStore.listedListings = [storeListing(APE_1, '120000000')];
    const wrapper = render();
    expect(cardNames(wrapper)).toHaveLength(2);

    walletStore.listedListings = [];
    await flushPromises();
    expect(cardNames(wrapper)).toEqual(['Cats']);
  });

  it('keeps the listed NFTs, and their badge, with the market switched off', () => {
    walletStore.listedListings = [storeListing(APE_1, '120000000')];
    featureFlagsStore.state.flags.isNftMarketEnabled = false;
    const wrapper = render();
    expect(cardNames(wrapper).sort()).toEqual(['Ape1', 'Cats']);
    expect(listedBadge(cardFor(wrapper, 'Ape1')).text()).toBe('Listed · 120 tADA');
  });

  it('is exactly the store\'s collections on a network with no market', () => {
    walletStore.listedListings = [storeListing(APE_1, '120000000')];
    walletStore.loggedWallet = { id: 1, chain: Blockchain.CARDANO, network: Network.MAINNET, type: WalletType.Normal } as never;
    const wrapper = render();
    expect(cardNames(wrapper)).toEqual(['Cats']);
    expect(wrapper.find('[data-testid="collection-listed-badge"]').exists()).toBe(false);
  });

  it('opens the collection with its listed NFTs among the items', async () => {
    walletStore.listedListings = [storeListing(CAT_2, '90500000')];
    const wrapper = render();
    await cardFor(wrapper, 'Cats').trigger('click');
    await flushPromises();

    const names = wrapper.findAll('.token-image').map((c) => c.text());
    expect(names).toHaveLength(2);
    expect(wrapper.find('[data-testid="token-listed-badge"]').text()).toBe('Listed · 90.5 tADA');
  });
});
