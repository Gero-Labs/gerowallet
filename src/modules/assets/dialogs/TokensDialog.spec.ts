// A collection's NFTs, and what the wallet can do with one. Where Gero's market is available the
// NFTs the wallet has listed carry a "Listed · {price} ADA" badge, and the detail of an NFT offers
// the market's actions: List for one that is not listed, Edit price and Unlist for one that is.
// The sheets themselves have their own specs; here they are stubs that show what they were given.
// The copy is the real English table, so a mistyped key shows up as a raw key in the assertions.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';
import type { OwnListing } from '@/chrome/nftMarket/ownListings';
import { Blockchain, Network, WalletType } from '@/models/types';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { walletStore } from '@/stores/walletStore';
import { i18nPlugin } from '@/plugins/i18n';

const POLICY = 'cd'.repeat(28);
const LISTED_UNIT = `${POLICY}4c6973746564`; // "Listed"
const FREE_UNIT = `${POLICY}46726565`; // "Free"
const CIP68_100_UNIT = `${'ef'.repeat(28)}000643b0${'41'.repeat(4)}`;
const LISTING_REF = `${'11'.repeat(32)}#0`;

// BaseDialog is a v-dialog (teleported); a plain wrapper keeps the content in the test's DOM.
vi.mock('@/shared/dialogs/BaseDialog.vue', () => ({
  default: {
    props: ['isOpen', 'title'],
    emits: ['close'],
    template: `<div v-if="isOpen" data-test="dialog"><h2>{{ title }}</h2><button data-test="dialog-close" @click="$emit('close')">x</button><slot /></div>`,
  },
}));
vi.mock('@/modules/market/dialogs/ListNftDialog.vue', () => ({
  default: {
    props: ['isOpen', 'unit', 'existing'],
    emits: ['close'],
    template: `<div data-test="list-dialog" :data-open="String(isOpen)" :data-unit="unit" :data-existing="existing ? existing.ref : ''"><button data-test="list-dialog-close" @click="$emit('close')">x</button></div>`,
  },
}));
vi.mock('@/modules/market/dialogs/UnlistNftDialog.vue', () => ({
  default: {
    props: ['isOpen', 'existing'],
    emits: ['close'],
    template: `<div data-test="unlist-dialog" :data-open="String(isOpen)" :data-existing="existing ? existing.ref : ''"><button data-test="unlist-dialog-close" @click="$emit('close')">x</button></div>`,
  },
}));

vi.mock('@/modules/market/components/CollectionListings.vue', () => ({
  default: {
    props: ['policyId'],
    template: `<div data-test="collection-listings" :data-policy="policyId" />`,
  },
}));

import TokensDialog from './TokensDialog.vue';

enableAutoUnmount(afterEach);

const item = (unit: string, name: string, extra: Record<string, unknown> = {}) => ({
  unit,
  name,
  img: `https://img.example/${name}`,
  policy_id: unit.slice(0, 56),
  asset_name: unit.slice(56),
  fingerprint: `asset1${name}`,
  quantity: '1',
  onchain_metadata: { image: 'ipfs://x', mediaType: 'image/png' },
  ...extra,
});

const storeListing = (unit: string, price = '120000000'): OwnListing =>
  ({
    ref: LISTING_REF,
    unit,
    datum: { owner: 'aa'.repeat(28), sellerAddress: 'addr_test1seller', price, royalties: [], buyer: null },
    depositLovelace: '1550000',
    deploymentVersion: 1,
  }) as unknown as OwnListing;

const COLLECTION = {
  name: 'Cool Cats',
  quantity: 2,
  description: 'Cats',
  items: [item(LISTED_UNIT, 'Listed'), item(FREE_UNIT, 'Free')],
};

function render(modalData: Record<string, unknown> | undefined = COLLECTION) {
  return mount(TokensDialog, {
    attachTo: document.body,
    props: { modalData: modalData as never },
    global: {
      // AssetDetails writes its copy with the global $t, as the app installs it.
      plugins: [createTestVuetify(), i18nPlugin],
      stubs: { ExplorerLink: true, CopyButton: true },
    },
  });
}

type Wrapper = ReturnType<typeof render>;
const cards = (wrapper: Wrapper) => wrapper.findAll('.token-image');
const cardFor = (wrapper: Wrapper, name: string) => cards(wrapper).find((c) => c.text().includes(name))!;
const badgeOf = (card: ReturnType<typeof cardFor>) => card.find('[data-testid="token-listed-badge"]');

beforeEach(() => {
  walletStore.loggedWallet = { id: 1, chain: Blockchain.CARDANO, network: Network.PREPROD, type: WalletType.Normal } as never;
  walletStore.listedListings = [storeListing(LISTED_UNIT)];
  featureFlagsStore.state.flags.isNftMarketEnabled = true;
});
afterEach(() => {
  featureFlagsStore.state.flags.isNftMarketEnabled = false;
  walletStore.loggedWallet = null;
  walletStore.listedListings = [];
  document.body.replaceChildren();
});

describe('the listed badge', () => {
  it('marks an NFT the wallet has listed with its price, and leaves the others alone', () => {
    const wrapper = render();
    expect(badgeOf(cardFor(wrapper, 'Listed')).text()).toBe('Listed · 120 ADA');
    expect(badgeOf(cardFor(wrapper, 'Free')).exists()).toBe(false);
  });

  it('shows the price exactly, to the lovelace', () => {
    walletStore.listedListings = [storeListing(LISTED_UNIT, '1234567891')];
    expect(badgeOf(cardFor(render(), 'Listed')).text()).toBe('Listed · 1,234.567891 ADA');
  });

  it('shows nothing while the market is off', () => {
    featureFlagsStore.state.flags.isNftMarketEnabled = false;
    expect(badgeOf(cardFor(render(), 'Listed')).exists()).toBe(false);
  });

  it('shows nothing for a wallet the market is not offered to', () => {
    walletStore.loggedWallet = { id: 1, chain: Blockchain.CARDANO, network: Network.PREPROD, type: WalletType.Watch } as never;
    expect(badgeOf(cardFor(render(), 'Listed')).exists()).toBe(false);
  });

  it('follows the store: a listing that goes away takes its badge with it', async () => {
    const wrapper = render();
    walletStore.listedListings = [];
    await flushPromises();
    expect(badgeOf(cardFor(wrapper, 'Listed')).exists()).toBe(false);
  });
});

describe('the actions of an NFT', () => {
  async function open(wrapper: Wrapper, name: string) {
    await cardFor(wrapper, name).trigger('click');
    await flushPromises();
  }
  const actions = (wrapper: Wrapper) => wrapper.find('[data-testid="asset-market-actions"]');

  it('offers List for an NFT that is not listed, and nothing else', async () => {
    const wrapper = render();
    await open(wrapper, 'Free');

    expect(wrapper.get('[data-testid="asset-list"]').text()).toBe('List for sale');
    expect(wrapper.find('[data-testid="asset-edit-price"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="asset-unlist"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="asset-listed-status"]').exists()).toBe(false);
  });

  it('offers Edit price and Unlist for a listed NFT, with its price, and no List', async () => {
    const wrapper = render();
    await open(wrapper, 'Listed');

    expect(wrapper.get('[data-testid="asset-listed-status"]').text()).toBe('Listed · 120 ADA');
    expect(wrapper.get('[data-testid="asset-edit-price"]').text()).toBe('Edit price');
    expect(wrapper.get('[data-testid="asset-unlist"]').text()).toBe('Unlist');
    expect(wrapper.find('[data-testid="asset-list"]').exists()).toBe(false);
  });

  it('offers nothing while the market is off', async () => {
    featureFlagsStore.state.flags.isNftMarketEnabled = false;
    const wrapper = render();
    await open(wrapper, 'Free');
    expect(actions(wrapper).exists()).toBe(false);
  });

  it('offers nothing to a watch wallet', async () => {
    walletStore.loggedWallet = { id: 1, chain: Blockchain.CARDANO, network: Network.PREPROD, type: WalletType.Watch } as never;
    const wrapper = render();
    await open(wrapper, 'Free');
    expect(actions(wrapper).exists()).toBe(false);
  });

  it('offers nothing on a network with no reviewed deployment', async () => {
    walletStore.loggedWallet = { id: 1, chain: Blockchain.CARDANO, network: Network.MAINNET, type: WalletType.Normal } as never;
    const wrapper = render();
    await open(wrapper, 'Free');
    expect(actions(wrapper).exists()).toBe(false);
  });

  it('offers nothing for a CIP-68 reference token: only the (222) user token is listed', async () => {
    const wrapper = render({ ...COLLECTION, items: [item(CIP68_100_UNIT, 'Reference')] });
    await open(wrapper, 'Reference');
    expect(actions(wrapper).exists()).toBe(false);
  });

  it('opens the list sheet for that NFT, a new listing', async () => {
    const wrapper = render();
    expect(wrapper.find('[data-test="list-dialog"]').exists()).toBe(false);
    await open(wrapper, 'Free');
    await wrapper.get('[data-testid="asset-list"]').trigger('click');
    await flushPromises();

    const dialog = wrapper.get('[data-test="list-dialog"]');
    expect(dialog.attributes('data-open')).toBe('true');
    expect(dialog.attributes('data-unit')).toBe(FREE_UNIT);
    expect(dialog.attributes('data-existing')).toBe('');
  });

  it('opens the same sheet for the listing when the price is edited', async () => {
    const wrapper = render();
    await open(wrapper, 'Listed');
    await wrapper.get('[data-testid="asset-edit-price"]').trigger('click');
    await flushPromises();

    const dialog = wrapper.get('[data-test="list-dialog"]');
    expect(dialog.attributes('data-unit')).toBe(LISTED_UNIT);
    expect(dialog.attributes('data-existing')).toBe(LISTING_REF);
  });

  it('opens the unlist sheet for the listing', async () => {
    const wrapper = render();
    await open(wrapper, 'Listed');
    await wrapper.get('[data-testid="asset-unlist"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-test="unlist-dialog"]').attributes('data-existing')).toBe(LISTING_REF);
    expect(wrapper.find('[data-test="list-dialog"]').exists()).toBe(false);
  });

  it('takes a sheet away when it is closed, so the next one starts clean', async () => {
    const wrapper = render();
    await open(wrapper, 'Free');
    await wrapper.get('[data-testid="asset-list"]').trigger('click');
    await wrapper.get('[data-test="list-dialog-close"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="list-dialog"]').exists()).toBe(false);
  });

  it('keeps the NFT on screen after a listing lands: the sheet\'s own done screen must outlive the store catching up', async () => {
    const wrapper = render();
    await open(wrapper, 'Free');
    await wrapper.get('[data-testid="asset-list"]').trigger('click');
    // The sync reports the new listing while the list sheet is still showing its result.
    walletStore.listedListings = [storeListing(LISTED_UNIT), storeListing(FREE_UNIT)];
    await flushPromises();

    expect(wrapper.find('[data-test="list-dialog"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="asset-listed-status"]').exists()).toBe(true);
  });
});

describe('the collection\'s listings', () => {
  const toggle = (wrapper: Wrapper) => wrapper.find('[data-testid="tokens-view"]');
  const forSale = (wrapper: Wrapper) => wrapper.get('[data-testid="tokens-view-sale"]');
  const yours = (wrapper: Wrapper) => wrapper.get('[data-testid="tokens-view-yours"]');
  const listingsOf = (wrapper: Wrapper) => wrapper.find('[data-test="collection-listings"]');

  it('starts on the wallet\'s own NFTs and offers the collection\'s listings beside them', () => {
    const wrapper = render();
    expect(toggle(wrapper).exists()).toBe(true);
    expect(yours(wrapper).text()).toBe('In your wallet');
    expect(forSale(wrapper).text()).toBe('For sale');
    expect(cards(wrapper)).toHaveLength(2);
    expect(listingsOf(wrapper).exists()).toBe(false);
  });

  it('shows the listings of this collection\'s policy, in place of the NFTs, when For sale is picked', async () => {
    const wrapper = render();
    await forSale(wrapper).trigger('click');
    await flushPromises();

    expect(listingsOf(wrapper).attributes('data-policy')).toBe(POLICY);
    expect(cards(wrapper)).toHaveLength(0);

    await yours(wrapper).trigger('click');
    await flushPromises();
    expect(listingsOf(wrapper).exists()).toBe(false);
    expect(cards(wrapper)).toHaveLength(2);
  });

  it('is there for a wallet that can only look: a watch wallet browses', async () => {
    walletStore.loggedWallet = { id: 1, chain: Blockchain.CARDANO, network: Network.PREPROD, type: WalletType.Watch } as never;
    const wrapper = render();
    await forSale(wrapper).trigger('click');
    await flushPromises();
    expect(listingsOf(wrapper).exists()).toBe(true);
  });

  it('is not there while the market is off', () => {
    featureFlagsStore.state.flags.isNftMarketEnabled = false;
    expect(toggle(render()).exists()).toBe(false);
  });

  it('is not there on a network with no reviewed deployment', () => {
    walletStore.loggedWallet = { id: 1, chain: Blockchain.CARDANO, network: Network.MAINNET, type: WalletType.Normal } as never;
    expect(toggle(render()).exists()).toBe(false);
  });

  it('is not there for a collection whose policy is not known', () => {
    const wrapper = render({ name: 'Nameless', items: [{ ...item(FREE_UNIT, 'Free'), policy_id: undefined }] });
    expect(toggle(wrapper).exists()).toBe(false);
  });

  it('is hidden while one NFT\'s detail is on screen, and the way back lands on the NFTs', async () => {
    const wrapper = render();
    await forSale(wrapper).trigger('click');
    await yours(wrapper).trigger('click');
    await cardFor(wrapper, 'Free').trigger('click');
    await flushPromises();
    expect(toggle(wrapper).exists()).toBe(false);
  });

  it('starts on the NFTs again each time the dialog opens', async () => {
    const wrapper = render();
    await forSale(wrapper).trigger('click');
    await wrapper.setProps({ modalData: undefined });
    await wrapper.setProps({ modalData: COLLECTION as never });
    await flushPromises();
    expect(listingsOf(wrapper).exists()).toBe(false);
    expect(cards(wrapper)).toHaveLength(2);
  });
});
