// The "Stuck on a closed marketplace" card (NFT rescue, Portfolio -> Collectibles): one row per
// stuck item with a checkbox, at most LEGACY_CANCEL_MAX picked, and the picked refs handed to the
// cancel dialog. The listings composable is replaced by refs the test owns; the copy is the real
// English table, so a mistyped key shows up as a raw key in the assertions.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import type { Ref } from 'vue';
import { createTestVuetify } from '@test/helpers/vuetify';
import type { LegacyListingItem } from '@/api/legacy-listings-api';

const listings = vi.hoisted(
  () =>
    ({}) as {
      items: Ref<LegacyListingItem[]>;
      meta: Ref<Map<string, { name: string; image?: string }>>;
      loading: Ref<boolean>;
      refresh: Mock<() => Promise<void>>;
      forget: Mock<(refs: string[]) => void>;
    },
);

vi.mock('@/shared/composables/useLegacyListings', async () => {
  const { computed, ref } = await import('vue');
  listings.items = ref([]);
  listings.meta = ref(new Map());
  listings.loading = ref(false);
  listings.refresh = vi.fn<() => Promise<void>>(() => Promise.resolve());
  listings.forget = vi.fn<(refs: string[]) => void>();
  return {
    useLegacyListings: () => ({
      items: listings.items,
      meta: listings.meta,
      count: computed(() => listings.items.value.length),
      loading: listings.loading,
      refresh: listings.refresh,
      forget: listings.forget,
    }),
  };
});

import LegacyListingsCard from './LegacyListingsCard.vue';
import { legacyRef } from '@/api/legacy-listings-api';

enableAutoUnmount(afterEach);

const unitOf = (n: number) => 'cd'.repeat(28) + '4e46540' + n.toString(16).padStart(2, '0');

function item(n: number, over: Partial<LegacyListingItem> = {}): LegacyListingItem {
  return {
    txHash: n.toString(16).padStart(2, '0').repeat(32),
    outputIndex: 0,
    contract: 'legacy_v3',
    kind: 'listing',
    ownerPkh: 'aa'.repeat(28),
    lovelace: '1361960',
    assets: [{ unit: unitOf(n), quantity: '1' }],
    ...over,
  };
}

function render() {
  return mount(LegacyListingsCard, { attachTo: document.body, global: { plugins: [createTestVuetify()] } });
}

const rowsOf = (wrapper: ReturnType<typeof render>) => wrapper.findAll('[data-testid="legacy-row"]');
const boxesOf = (wrapper: ReturnType<typeof render>) => wrapper.findAll('input[type="checkbox"]');
const isChecked = (box: { element: Element }) => (box.element as HTMLInputElement).checked;

describe('LegacyListingsCard', () => {
  beforeEach(() => {
    listings.items.value = [];
    listings.meta.value = new Map();
    listings.loading.value = false;
    listings.refresh.mockClear();
    listings.forget.mockClear();
  });
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('lists listings with name and ADA, offers as "Offer, X ADA locked"', () => {
    const listing = item(1);
    const offer = item(2, { kind: 'offer', contract: 'legacy_v2', lovelace: '25000000', assets: [] });
    listings.items.value = [listing, offer];
    listings.meta.value = new Map([[listing.assets[0]!.unit, { name: 'Equine Pioneer 04601', image: 'https://img.example/1.png' }]]);

    const wrapper = render();
    const rows = rowsOf(wrapper);

    expect(wrapper.text()).toContain('Stuck on a closed marketplace');
    expect(wrapper.text()).toContain('Gero charges nothing for this.');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain('Equine Pioneer 04601');
    expect(rows[0]!.text()).toContain('1.36196 ADA locked');
    expect(rows[0]!.findComponent({ name: 'VImg' }).props('src')).toBe('https://img.example/1.png');
    // An offer holds only ADA: an ADA icon, no NFT name, no NFT image.
    expect(rows[1]!.text()).toContain('Offer, 25 ADA locked');
    expect(rows[1]!.find('[data-testid="legacy-ada-icon"]').exists()).toBe(true);
    expect(rows[1]!.findComponent({ name: 'VImg' }).exists()).toBe(false);
    expect(rows[1]!.text()).not.toContain(unitOf(2).slice(0, 8));
  });

  it('shows a neutral tile for a listing without an image, and names it by its asset', () => {
    const listing = item(3);
    listings.items.value = [listing];
    listings.meta.value = new Map([[listing.assets[0]!.unit, { name: 'No Picture Yet' }]]);

    const row = rowsOf(render())[0]!;

    expect(row.text()).toContain('No Picture Yet');
    expect(row.find('[data-testid="legacy-tile-placeholder"]').exists()).toBe(true);
    expect(row.findComponent({ name: 'VImg' }).exists()).toBe(false);
  });

  it('falls back to a shortened unit while the names are still being looked up', () => {
    const listing = item(4);
    listings.items.value = [listing];

    const row = rowsOf(render())[0]!;

    expect(row.text()).toContain(listing.assets[0]!.unit.slice(0, 16));
  });

  it('stops selection at 10 and shows the max hint', async () => {
    listings.items.value = Array.from({ length: 12 }, (_, index) => item(index + 1));
    const wrapper = render();

    expect(boxesOf(wrapper)).toHaveLength(12);
    for (const box of boxesOf(wrapper).slice(0, 10)) await box.setValue(true);

    expect(boxesOf(wrapper).slice(0, 10).every(isChecked)).toBe(true);
    // The eleventh and twelfth cannot be picked: their checkboxes are disabled.
    expect(boxesOf(wrapper).slice(10).every((box) => box.attributes('disabled') !== undefined)).toBe(true);
    // Picked ones stay enabled, so one can be put back.
    expect(boxesOf(wrapper).slice(0, 10).every((box) => box.attributes('disabled') === undefined)).toBe(true);
    expect(wrapper.text()).toContain('Up to 10 items per transaction');

    await boxesOf(wrapper)[0]!.setValue(false);
    expect(boxesOf(wrapper).slice(10).every((box) => box.attributes('disabled') === undefined)).toBe(true);
  });

  it('does not show the max hint when every item fits in one transaction', () => {
    listings.items.value = [item(1), item(2)];

    expect(render().text()).not.toContain('Up to 10 items per transaction');
  });

  it('emits the selected refs to the dialog, in list order, and stays off until something is picked', async () => {
    const items = [item(1), item(2), item(3)];
    listings.items.value = items;
    const wrapper = render();
    const button = () => wrapper.get('[data-testid="legacy-get-back"]');

    expect(button().text()).toBe('Get back selected');
    expect(button().attributes('disabled')).toBeDefined();

    // Picked third then first: the refs still come out in list order.
    await boxesOf(wrapper)[2]!.setValue(true);
    await boxesOf(wrapper)[0]!.setValue(true);
    expect(button().attributes('disabled')).toBeUndefined();
    await button().trigger('click');

    expect(wrapper.emitted('get-back')).toEqual([[[legacyRef(items[0]!), legacyRef(items[2]!)]]]);
  });

  it('drops a selected item from the selection when it leaves the list', async () => {
    const items = [item(1), item(2)];
    listings.items.value = items;
    const wrapper = render();
    await boxesOf(wrapper)[0]!.setValue(true);
    await boxesOf(wrapper)[1]!.setValue(true);

    // The first was just cancelled: the list forgets it.
    listings.items.value = [items[1]!];
    await wrapper.vm.$nextTick();
    await wrapper.get('[data-testid="legacy-get-back"]').trigger('click');

    expect(wrapper.emitted('get-back')).toEqual([[[legacyRef(items[1]!)]]]);
  });

  it('looks the list up again when it mounts, and shows a spinner beside the title while it loads', async () => {
    listings.items.value = [item(1)];
    listings.loading.value = true;
    const wrapper = render();

    expect(listings.refresh).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[role="status"]').exists()).toBe(true);

    listings.loading.value = false;
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
  });
});
