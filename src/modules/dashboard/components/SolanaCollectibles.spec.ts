// The Solana collectibles: held NFTs as collections, an NFT's detail, and Send only for the
// NFTs Gero can move.
import * as Vue from 'vue';
import { createTestVuetify } from '@test/helpers/vuetify';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/stores/walletStore', () => ({
  walletStore: Vue.reactive({ loggedWallet: { network: 'Devnet' }, solana: { tokens: [] as unknown[] }, solanaNfts: {} as Record<string, unknown> }),
}));
vi.mock('@/utils/assets', () => ({ default: { resolveIcon: (url: string) => `proxy:${url}`, fallbackImage: vi.fn() } }));
vi.mock('@/shared/dialogs/BaseDialog.vue', () => ({
  default: { props: ['isOpen', 'title'], template: '<div v-if="isOpen" class="dialog"><h2 class="dialog-title">{{ title }}</h2><slot /></div>' },
}));
vi.mock('@/shared/components/CopyButton.vue', () => ({ default: { template: '<span />' } }));
vi.mock('@/shared/components/GButton/GButton.vue', () => ({
  default: { emits: ['click'], template: '<button type="button" @click="$emit(\'click\')"><slot /></button>' },
}));
vi.mock('@/modules/transactions/dialogs/SolanaSendDialog.vue', () => ({
  default: { name: 'SolanaSendDialog', props: ['modelValue', 'nftMint'], template: '<div class="send-dialog" />' },
}));

import SolanaCollectibles from './SolanaCollectibles.vue';
import { walletStore } from '@/stores/walletStore';

const A = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const B = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const C = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const COLL = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';

const nft = (mint: string, fields: Record<string, unknown> = {}) => ({
  mint, standard: 'nonFungible', name: null, symbol: null, image: null, animationUrl: null, description: null, externalUrl: null,
  collection: null, attributes: [], sellerFeeBasisPoints: null, offChain: true, fetchedAt: 0, ...fields,
});

function render() {
  return mount(SolanaCollectibles as unknown as Parameters<typeof mount>[0], {
    global: { plugins: [createTestVuetify()], mocks: { $t: (key: string, args?: Record<string, unknown>) => (args?.['count'] ? `${key}:${args['count']}` : key) } },
  });
}

enableAutoUnmount(afterEach);

describe('SolanaCollectibles', () => {
  beforeEach(() => {
    const store = walletStore as unknown as { solana: unknown; solanaNfts: unknown };
    store.solana = { tokens: [A, B, C].map((mint) => ({ mint, amount: '1', decimals: 0 })) };
    store.solanaNfts = {
      [A]: nft(A, { name: 'Lad #2', image: 'https://arweave.net/2.png', collection: { address: COLL, verified: true } }),
      [B]: nft(B, { name: 'Lad #1', collection: { address: COLL, verified: true } }),
      // Unverified, and programmable.
      [C]: nft(C, { name: 'Free <b>mint</b>', standard: 'programmableNonFungible', description: 'Claim at evil.example', attributes: [{ traitType: 'Rarity', value: 'Legendary' }] }),
    };
  });

  it('groups a verified collection, shows unverified NFTs alone, and loads images through the proxy', () => {
    const w = render();
    expect(w.find(`[data-test="sol-collection-${COLL}"]`).text()).toContain('Lad');
    expect(w.find(`[data-test="sol-collection-${COLL}"]`).text()).toContain('solana.nft.items:2');
    expect(w.find(`[data-test="sol-collection-${C}"]`).text()).toContain('solana.nft.unverified');
    expect(w.find(`[data-test="sol-collection-${COLL}"] img`).attributes('src')).toBe('proxy:https://arweave.net/2.png');
  });

  it('opens a collection, then an NFT, and sends it', async () => {
    const w = render();
    await w.find(`[data-test="sol-collection-${COLL}"]`).trigger('click');
    await w.find(`[data-test="sol-nft-${B}"]`).trigger('click');
    expect(w.find('[data-test="sol-nft-detail"]').text()).toContain(B);
    await w.find('[data-test="sol-nft-send"]').trigger('click');
    await flushPromises();
    const send = w.findComponent({ name: 'SolanaSendDialog' });
    expect(send.props('modelValue')).toBe(true);
    expect(send.props('nftMint')).toBe(B);
  });

  it('shows third-party text as text, warns on an unverified NFT and offers no Send for a programmable one', async () => {
    const w = render();
    await w.find(`[data-test="sol-collection-${C}"]`).trigger('click');
    const detail = w.find('[data-test="sol-nft-detail"]');
    expect(w.find('.dialog-title').text()).toBe('Free <b>mint</b>');
    expect(w.find('.dialog b').exists()).toBe(false);
    expect(detail.text()).toContain('solana.nft.unverifiedHint');
    expect(detail.text()).toContain('Legendary');
    expect(w.find('[data-test="sol-nft-send"]').exists()).toBe(false);
    expect(w.find('[data-test="sol-nft-programmable"]').exists()).toBe(true);
  });

  it('lists only NFTs still held', () => {
    (walletStore as unknown as { solana: unknown }).solana = { tokens: [{ mint: A, amount: '1', decimals: 0 }] };
    const w = render();
    expect(w.find(`[data-test="sol-collection-${COLL}"]`).text()).not.toContain('solana.nft.items');
    expect(w.find(`[data-test="sol-collection-${C}"]`).exists()).toBe(false);
  });
});
