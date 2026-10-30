// The "Stuck on a closed marketplace" card (NFT rescue, Portfolio -> Collectibles): one row per
// stuck item with a checkbox, one marketplace version at a time and at most that version's cap
// picked (legacyCancelMax), and the picked refs handed to the cancel dialog. The listings composable is replaced by refs the test owns; the copy is the real
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

/** `n` stuck items at the older contract: the one whose cancel takes fewer items per transaction. */
const v2 = (n: number, over: Partial<LegacyListingItem> = {}) => item(n, { contract: 'legacy_v2', ...over });

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
  describe('one marketplace version per transaction', () => {
    const VERSION_HINT = 'Items from the other marketplace version go back in a separate transaction';
    const disabled = (box: { attributes: (name: string) => string | undefined }) => box.attributes('disabled') !== undefined;

    it('disables the other contract once one item is selected and shows the version hint', async () => {
      // List order: v3, v2, v3, v2.
      listings.items.value = [item(1), v2(2), item(3), v2(4)];
      const wrapper = render();

      // Nothing picked: every row is open to a pick and there is nothing to explain yet.
      expect(boxesOf(wrapper).some(disabled)).toBe(false);
      expect(wrapper.find('[data-testid="legacy-version-hint"]').exists()).toBe(false);

      await boxesOf(wrapper)[0]!.setValue(true);

      expect(boxesOf(wrapper).map(disabled)).toEqual([false, true, false, true]);
      expect(rowsOf(wrapper).map((row) => row.classes('legacy-card__row--blocked'))).toEqual([false, true, false, true]);
      expect(wrapper.get('[data-testid="legacy-version-hint"]').text()).toBe(VERSION_HINT);

      // The same from the other side: a v2 pick closes the v3 rows.
      await boxesOf(wrapper)[0]!.setValue(false);
      await boxesOf(wrapper)[1]!.setValue(true);
      expect(boxesOf(wrapper).map(disabled)).toEqual([true, false, true, false]);
      expect(wrapper.get('[data-testid="legacy-version-hint"]').text()).toBe(VERSION_HINT);
    });

    it('says nothing about versions when the list holds only the selected contract', async () => {
      listings.items.value = [v2(1), v2(2)];
      const wrapper = render();

      await boxesOf(wrapper)[0]!.setValue(true);

      expect(boxesOf(wrapper).some(disabled)).toBe(false);
      expect(wrapper.find('[data-testid="legacy-version-hint"]').exists()).toBe(false);
      expect(wrapper.text()).not.toContain(VERSION_HINT);
    });

    it('clearing the selection re-enables every item and drops the version hint', async () => {
      listings.items.value = [item(1), v2(2), item(3), v2(4)];
      const wrapper = render();
      await boxesOf(wrapper)[0]!.setValue(true);
      await boxesOf(wrapper)[2]!.setValue(true);
      expect(boxesOf(wrapper).filter(disabled)).toHaveLength(2);

      // One pick left: still locked to its contract.
      await boxesOf(wrapper)[0]!.setValue(false);
      expect(boxesOf(wrapper).map(disabled)).toEqual([false, true, false, true]);
      expect(wrapper.find('[data-testid="legacy-version-hint"]').exists()).toBe(true);

      await boxesOf(wrapper)[2]!.setValue(false);

      expect(boxesOf(wrapper).some(disabled)).toBe(false);
      expect(rowsOf(wrapper).some((row) => row.classes('legacy-card__row--blocked'))).toBe(false);
      expect(wrapper.find('[data-testid="legacy-version-hint"]').exists()).toBe(false);
      expect(wrapper.get('[data-testid="legacy-get-back"]').attributes('disabled')).toBeDefined();
    });

    it('lets the selection move to the other contract once it is emptied', async () => {
      listings.items.value = [item(1), v2(2)];
      const wrapper = render();
      await boxesOf(wrapper)[0]!.setValue(true);
      await boxesOf(wrapper)[0]!.setValue(false);
      await boxesOf(wrapper)[1]!.setValue(true);
      await wrapper.get('[data-testid="legacy-get-back"]').trigger('click');

      expect(wrapper.emitted('get-back')).toEqual([[[legacyRef(listings.items.value[1]!)]]]);
    });

    it('ignores a pick of the other contract even if a checkbox reports one', async () => {
      const items = [item(1), v2(2)];
      listings.items.value = items;
      const wrapper = render();
      await boxesOf(wrapper)[0]!.setValue(true);

      // The blocked row's checkbox cannot be clicked, but its handler must not trust that.
      wrapper.findAllComponents({ name: 'VCheckboxBtn' })[1]!.vm.$emit('update:modelValue', true);
      await wrapper.vm.$nextTick();
      await wrapper.get('[data-testid="legacy-get-back"]').trigger('click');

      expect(wrapper.emitted('get-back')).toEqual([[[legacyRef(items[0]!)]]]);
    });

    it('drops the lock when the only selected item leaves the list', async () => {
      const items = [item(1), v2(2)];
      listings.items.value = items;
      const wrapper = render();
      await boxesOf(wrapper)[0]!.setValue(true);
      expect(disabled(boxesOf(wrapper)[1]!)).toBe(true);

      // The v3 item was just cancelled: its selection goes with it, and so does the lock.
      listings.items.value = [items[1]!];
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      expect(boxesOf(wrapper).some(disabled)).toBe(false);
      expect(wrapper.find('[data-testid="legacy-version-hint"]').exists()).toBe(false);
    });
  });

  describe('per-contract caps', () => {
    it('caps selection at 6 for legacy_v2 items and shows "Up to 6 items per transaction"', async () => {
      listings.items.value = Array.from({ length: 8 }, (_, index) => v2(index + 1));
      const wrapper = render();

      for (const box of boxesOf(wrapper).slice(0, 5)) await box.setValue(true);
      // One slot left: the limit has not been hit, so it is not mentioned.
      expect(wrapper.find('[data-testid="legacy-max-hint"]').exists()).toBe(false);
      expect(boxesOf(wrapper).slice(5).some((box) => box.attributes('disabled') !== undefined)).toBe(false);

      await boxesOf(wrapper)[5]!.setValue(true);

      expect(boxesOf(wrapper).slice(0, 6).every(isChecked)).toBe(true);
      // The seventh and eighth cannot be picked; the picked ones stay switchable.
      expect(boxesOf(wrapper).slice(6).every((box) => box.attributes('disabled') !== undefined)).toBe(true);
      expect(boxesOf(wrapper).slice(0, 6).every((box) => box.attributes('disabled') === undefined)).toBe(true);
      expect(wrapper.get('[data-testid="legacy-max-hint"]').text()).toBe('Up to 6 items per transaction');

      await boxesOf(wrapper)[0]!.setValue(false);
      expect(boxesOf(wrapper).slice(6).every((box) => box.attributes('disabled') === undefined)).toBe(true);
      expect(wrapper.find('[data-testid="legacy-max-hint"]').exists()).toBe(false);
    });

    it('caps selection at 10 for legacy_v3 items', async () => {
      // Twelve v3 items with a v2 one between them: only the v3 count against the v3 cap.
      listings.items.value = [...Array.from({ length: 6 }, (_, index) => item(index + 1)), v2(50), ...Array.from({ length: 6 }, (_, index) => item(index + 7))];
      const wrapper = render();
      const v3Boxes = () => boxesOf(wrapper).filter((_, index) => index !== 6);

      for (const box of v3Boxes().slice(0, 10)) await box.setValue(true);

      expect(v3Boxes().slice(0, 10).every(isChecked)).toBe(true);
      expect(v3Boxes().slice(10).every((box) => box.attributes('disabled') !== undefined)).toBe(true);
      expect(wrapper.get('[data-testid="legacy-max-hint"]').text()).toBe('Up to 10 items per transaction');
    });

    it('does not show the max hint when the selection filled the cap but nothing more of that contract is left', async () => {
      // Six v2 items fill the v2 cap exactly; the twelve v3 items are another transaction's business.
      listings.items.value = [...Array.from({ length: 6 }, (_, index) => v2(index + 1)), ...Array.from({ length: 12 }, (_, index) => item(index + 20))];
      const wrapper = render();

      for (const box of boxesOf(wrapper).slice(0, 6)) await box.setValue(true);

      expect(boxesOf(wrapper).slice(0, 6).every(isChecked)).toBe(true);
      expect(wrapper.find('[data-testid="legacy-max-hint"]').exists()).toBe(false);
      // The other version is still said to go separately.
      expect(wrapper.find('[data-testid="legacy-version-hint"]').exists()).toBe(true);
    });

    it('shows both hints when the cap is hit and the other contract is listed too', async () => {
      listings.items.value = [...Array.from({ length: 7 }, (_, index) => v2(index + 1)), item(40)];
      const wrapper = render();

      for (const box of boxesOf(wrapper).slice(0, 6)) await box.setValue(true);

      expect(wrapper.find('[data-testid="legacy-max-hint"]').text()).toBe('Up to 6 items per transaction');
      expect(wrapper.find('[data-testid="legacy-version-hint"]').exists()).toBe(true);
    });

    it('emits only the capped, same-contract refs in list order', async () => {
      const items = [item(1), v2(2), item(3), v2(4), item(5)];
      listings.items.value = items;
      const wrapper = render();

      await boxesOf(wrapper)[4]!.setValue(true);
      await boxesOf(wrapper)[0]!.setValue(true);
      await boxesOf(wrapper)[2]!.setValue(true);
      await wrapper.get('[data-testid="legacy-get-back"]').trigger('click');

      expect(wrapper.emitted('get-back')).toEqual([[[legacyRef(items[0]!), legacyRef(items[2]!), legacyRef(items[4]!)]]]);
    });
  });
});
