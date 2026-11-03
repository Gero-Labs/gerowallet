// The breakdown of a price: what the buyer pays, what Gero takes, what each creator is paid, and
// what the seller keeps. It is shown live while the seller types a price (a preview) and again,
// with the deposit and network fee, on the review of what the worker verified, so a figure that
// is wrong here is wrong in front of the signature. Every amount is exact (bigint lovelace); the
// copy is the real English table, so a mistyped key shows up as a raw key.
import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import ListingBreakdown from './ListingBreakdown.vue';

enableAutoUnmount(afterEach);

const ADA = 1_000_000n;
const MIN_UTXO = 1_155_080n;
const CREATOR_A = `addr_test1qz${'a'.repeat(40)}ac4f9d2e`;
const CREATOR_B = `addr_test1qz${'b'.repeat(40)}b7e6a1c3`;
const SHORT_A = 'addr_test1qzaaa…ac4f9d2e';
const SHORT_B = 'addr_test1qzbbb…b7e6a1c3';

type Props = InstanceType<typeof ListingBreakdown>['$props'];
const render = (props: Partial<Props> = {}) =>
  mount(ListingBreakdown, {
    props: {
      price: 100n * ADA,
      fee: 1_500_000n,
      royalties: [{ address: CREATOR_A, lovelace: 5n * ADA }],
      sellerReceives: 93_500_000n,
      minUtxo: MIN_UTXO,
      ...props,
    },
  });

const row = (wrapper: ReturnType<typeof render>, id: string) => wrapper.get(`[data-testid="breakdown-${id}"]`).text();

describe('ListingBreakdown', () => {
  it('shows 100 ADA with a 5% royalty as price 100, fee 1.5, royalty 5 and 93.5 for the seller', () => {
    const wrapper = render();
    expect(row(wrapper, 'price')).toBe('Price100 ADA');
    expect(row(wrapper, 'fee')).toBe('Gero fee1.5 ADA');
    expect(row(wrapper, 'royalties-total')).toBe('Royalties, 5% of the price5 ADA');
    expect(row(wrapper, 'receive')).toBe('You receive93.5 ADA');
  });

  it('names each royalty recipient with its own amount, the address shortened', () => {
    const wrapper = render({
      royalties: [{ address: CREATOR_A, lovelace: 5n * ADA }, { address: CREATOR_B, lovelace: 2_500_000n }],
      sellerReceives: 91n * ADA,
    });
    const rows = wrapper.findAll('[data-testid="breakdown-royalty"]').map((r) => r.text());
    expect(rows).toEqual([`Royalty to ${SHORT_A}5 ADA`, `Royalty to ${SHORT_B}2.5 ADA`]);
    expect(row(wrapper, 'royalties-total')).toBe('Royalties, 7.5% of the price7.5 ADA');
  });

  it('shows the royalty as the share of the price it effectively is, not the rate the collection asks', () => {
    // A 1% royalty with a 15 ADA minimum on 100 ADA takes 15%.
    const wrapper = render({ royalties: [{ address: CREATOR_A, lovelace: 15n * ADA }], sellerReceives: 83_500_000n });
    expect(row(wrapper, 'royalties-total')).toBe('Royalties, 15% of the price15 ADA');
  });

  it('has no royalty rows for a collection without royalties', () => {
    const wrapper = render({ royalties: [], sellerReceives: 98_500_000n });
    expect(wrapper.find('[data-testid="breakdown-royalty"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="breakdown-royalties-total"]').exists()).toBe(false);
    expect(row(wrapper, 'receive')).toBe('You receive98.5 ADA');
  });

  it('keeps every digit of an exact amount, and shows a negative share as it is', () => {
    const wrapper = render({ price: 1_234_567_891n, fee: 5_000_000n, royalties: [], sellerReceives: -500_000n });
    expect(row(wrapper, 'price')).toBe('Price1,234.567891 ADA');
    expect(row(wrapper, 'receive')).toBe('You receive-0.5 ADA');
  });

  describe('the deposit and the network fee', () => {
    it('are shown only once the worker has built the transaction', () => {
      const preview = render();
      expect(preview.find('[data-testid="breakdown-deposit"]').exists()).toBe(false);
      expect(preview.find('[data-testid="breakdown-network-fee"]').exists()).toBe(false);

      const verified = render({ deposit: 1_550_000n, networkFee: 213_445n });
      expect(row(verified, 'deposit')).toBe('Your deposit, returned to you1.55 ADA');
      expect(row(verified, 'network-fee')).toBe('Network Fee0.213445 ADA');
      expect(verified.text()).toContain('It comes back to you when it sells or when you unlist it.');
    });

    it('shows a deposit of zero rather than hiding it', () => {
      expect(row(render({ deposit: 0n }), 'deposit')).toBe('Your deposit, returned to you0 ADA');
    });
  });

  describe('royalties that were left out', () => {
    it('says a royalty under min-UTxO is too small to pay, and to whom it was owed', () => {
      const wrapper = render({ dropped: [{ address: CREATOR_B, lovelace: 500_000n }] });
      const notice = wrapper.get('[data-testid="breakdown-dropped-small"]').text();
      expect(notice).toBe(`A royalty of 0.5 ADA to ${SHORT_B} is too small to pay out, so it is left out.`);
      expect(wrapper.find('[data-testid="breakdown-dropped-many"]').exists()).toBe(false);
    });

    it('says a royalty beyond three recipients was left out for that reason, not for being small', () => {
      const wrapper = render({ dropped: [{ address: CREATOR_B, lovelace: 2n * ADA }] });
      expect(wrapper.get('[data-testid="breakdown-dropped-many"]').text()).toBe(
        `A royalty of 2 ADA to ${SHORT_B} is left out. A listing can pay at most 3 royalty recipients.`,
      );
      expect(wrapper.find('[data-testid="breakdown-dropped-small"]').exists()).toBe(false);
    });

    it('tells the two apart in one list', () => {
      const wrapper = render({ dropped: [{ address: CREATOR_A, lovelace: 700_000n }, { address: CREATOR_B, lovelace: 3n * ADA }] });
      expect(wrapper.findAll('[data-testid="breakdown-dropped-small"]')).toHaveLength(1);
      expect(wrapper.findAll('[data-testid="breakdown-dropped-many"]')).toHaveLength(1);
    });

    it('does not mention an entry of zero lovelace: nothing was owed', () => {
      const wrapper = render({ dropped: [{ address: CREATOR_B, lovelace: 0n }] });
      expect(wrapper.find('[data-testid="breakdown-dropped-small"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="breakdown-dropped-many"]').exists()).toBe(false);
    });

    it('says how many royalty recipients had no usable address', () => {
      expect(render({ invalidRecipients: 1 }).get('[data-testid="breakdown-invalid"]').text()).toBe(
        '1 royalty recipient has no valid address and is left out.',
      );
      expect(render({ invalidRecipients: 2 }).get('[data-testid="breakdown-invalid"]').text()).toBe(
        '2 royalty recipients have no valid address and are left out.',
      );
      expect(render({ invalidRecipients: 0 }).find('[data-testid="breakdown-invalid"]').exists()).toBe(false);
    });

    it('says nothing when nothing was left out', () => {
      const wrapper = render();
      for (const id of ['dropped-small', 'dropped-many', 'invalid']) {
        expect(wrapper.find(`[data-testid="breakdown-${id}"]`).exists(), id).toBe(false);
      }
    });
  });
});
