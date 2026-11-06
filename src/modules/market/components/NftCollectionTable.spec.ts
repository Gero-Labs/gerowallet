// The Portfolio's default NFT table. The NFTs the wallet has listed on Gero's market are locked at
// the contract, not held: "Held" counts only what is in the wallet, and a collection with listed
// NFTs says so in its name cell, so a collection whose only NFT is listed reads "Held 0" and
// "1 listed", never "Held 1". The copy is the real English table.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';
import { i18nPlugin } from '@/plugins/i18n';
import type { NftCollectionDisplay } from '@/modules/market/composables/useNftMarketData';

const rows = vi.hoisted(() => ({ value: [] as unknown[] }));
vi.mock('@/modules/market/composables/useNftMarketData', async () => {
  const { ref: vueRef } = await import('vue');
  const collections = vueRef(rows.value);
  rows.value = collections as unknown as unknown[];
  return { useNftMarketData: () => ({ collections, loading: vueRef(false), fetchUserNftCollections: vi.fn() }) };
});

import NftCollectionTable from './NftCollectionTable.vue';

enableAutoUnmount(afterEach);

const POLICY_A = 'cd'.repeat(28);
const POLICY_B = 'ef'.repeat(28);
const row = (policyId: string, name: string, extra: Partial<NftCollectionDisplay> = {}): NftCollectionDisplay => ({
  policyId,
  policyIdShort: policyId.slice(0, 12) + '...',
  name,
  img: '',
  quantity: 1,
  listedCount: 0,
  isScam: false,
  description: '',
  floorPriceLovelace: null,
  lastSalePriceLovelace: null,
  totalVolumeLovelace: null,
  saleCount: null,
  floorValueLovelace: null,
  ...extra,
});

function render(data: NftCollectionDisplay[]) {
  (rows.value as unknown as { value: NftCollectionDisplay[] }).value = data;
  return mount(NftCollectionTable, {
    global: { plugins: [createTestVuetify(), i18nPlugin], stubs: { CopyButton: true, ExplorerLink: true } },
  });
}

type Wrapper = ReturnType<typeof render>;
const rowFor = (wrapper: Wrapper, name: string) => wrapper.findAll('tbody tr').find((tr) => tr.text().includes(name))!;
const cells = (tr: ReturnType<typeof rowFor>) => tr.findAll('td').map((td) => td.text());

describe('NftCollectionTable: held and listed', () => {
  it('counts only the NFTs in the wallet as held', () => {
    const wrapper = render([row(POLICY_A, 'Cats', { quantity: 3 })]);
    const held = cells(rowFor(wrapper, 'Cats'))[2];
    expect(held).toBe('3');
    expect(wrapper.find('[data-testid="nft-table-listed-badge"]').exists()).toBe(false);
  });

  it('a collection whose only NFT is listed reads Held 0 with a listed marker', () => {
    const wrapper = render([row(POLICY_A, 'Apes', { quantity: 0, listedCount: 1 })]);
    const tr = rowFor(wrapper, 'Apes');
    expect(cells(tr)[2]).toBe('0');
    expect(tr.get('[data-testid="nft-table-listed-badge"]').text()).toBe('1 listed');
  });

  it('marks the collection with how many are listed, and keeps what is held beside it', () => {
    const wrapper = render([row(POLICY_A, 'Cats', { quantity: 2, listedCount: 3 }), row(POLICY_B, 'Dogs', { quantity: 4 })]);
    const cats = rowFor(wrapper, 'Cats');
    expect(cells(cats)[2]).toBe('2');
    expect(cats.get('[data-testid="nft-table-listed-badge"]').text()).toBe('3 listed');
    expect(rowFor(wrapper, 'Dogs').find('[data-testid="nft-table-listed-badge"]').exists()).toBe(false);
  });

  it('shows the floor value that includes the listed NFTs, beside the marker', () => {
    const wrapper = render([row(POLICY_A, 'Cats', { quantity: 0, listedCount: 2, floorPriceLovelace: 10_000_000, floorValueLovelace: 20_000_000 })]);
    const tr = rowFor(wrapper, 'Cats');
    expect(tr.text()).toContain('20');
    expect(tr.find('[data-testid="nft-table-listed-badge"]').exists()).toBe(true);
  });
});
