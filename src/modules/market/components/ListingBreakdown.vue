<template>
  <div class="listing-breakdown" data-testid="listing-breakdown">
    <dl class="listing-breakdown__rows glass-tier">
      <div class="listing-breakdown__row" data-testid="breakdown-price">
        <dt class="t-caption">{{ t('common.price') }}</dt>
        <dd class="t-body-sm g-num">{{ ada(price) }} ADA</dd>
      </div>
      <div class="listing-breakdown__row" data-testid="breakdown-fee">
        <dt class="t-caption">{{ t('nftMarket.breakdown.fee') }}</dt>
        <dd class="t-body-sm g-num">{{ ada(fee) }} ADA</dd>
      </div>
      <template v-if="royalties.length > 0">
        <div
          v-for="(royalty, index) in royalties"
          :key="`${index}:${royalty.address}`"
          class="listing-breakdown__row listing-breakdown__row--sub"
          data-testid="breakdown-royalty"
        >
          <dt class="t-caption" :title="royalty.address">{{ t('nftMarket.breakdown.royalty', { address: shortAddress(royalty.address) }) }}</dt>
          <dd class="t-body-sm g-num">{{ ada(royalty.lovelace) }} ADA</dd>
        </div>
        <div class="listing-breakdown__row" data-testid="breakdown-royalties-total">
          <dt class="t-caption">{{ t('nftMarket.breakdown.royalties', { percent: royaltyPercent }) }}</dt>
          <dd class="t-body-sm g-num">{{ ada(royaltiesTotal) }} ADA</dd>
        </div>
      </template>
      <div class="listing-breakdown__row listing-breakdown__row--total" data-testid="breakdown-receive">
        <dt class="t-body-sm">{{ t('nftMarket.breakdown.youReceive') }}</dt>
        <dd class="t-heading g-num">{{ ada(sellerReceives) }} ADA</dd>
      </div>
      <div v-if="deposit != null" class="listing-breakdown__row" data-testid="breakdown-deposit">
        <dt class="t-caption">{{ t('nftMarket.breakdown.depositLocked') }}</dt>
        <dd class="t-body-sm g-num">{{ ada(deposit) }} ADA</dd>
      </div>
      <div v-if="networkFee != null" class="listing-breakdown__row" data-testid="breakdown-network-fee">
        <dt class="t-caption">{{ t('signTx.networkFee') }}</dt>
        <dd class="t-body-sm g-num">{{ ada(networkFee) }} ADA</dd>
      </div>
    </dl>
    <p v-if="deposit != null" class="listing-breakdown__note t-caption" data-testid="breakdown-deposit-hint">
      {{ t('nftMarket.breakdown.depositHint') }}
    </p>

    <!-- Royalties the listing leaves out, said in plain words: the creators will not be paid these. -->
    <p v-for="(entry, index) in leftOut.tooSmall" :key="`small:${index}`" class="listing-breakdown__note t-caption" data-testid="breakdown-dropped-small">
      {{ t('nftMarket.breakdown.droppedTooSmall', { amount: ada(entry.lovelace), address: shortAddress(entry.address) }) }}
    </p>
    <p v-for="(entry, index) in leftOut.tooMany" :key="`many:${index}`" class="listing-breakdown__note t-caption" data-testid="breakdown-dropped-many">
      {{ t('nftMarket.breakdown.droppedTooMany', { amount: ada(entry.lovelace), address: shortAddress(entry.address), max: MAX_ROYALTIES }) }}
    </p>
    <p v-if="invalidRecipients > 0" class="listing-breakdown__note t-caption" data-testid="breakdown-invalid">
      {{ tc('nftMarket.breakdown.invalidRecipients', invalidRecipients, { count: invalidRecipients }) }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { classifyDroppedRoyalties, shareOfPrice } from '@/modules/market/utils/listingPreview';
import i18n, { getLocaleCode } from '@/plugins/i18n';
import { useTranslation } from '@/shared/composables/useTranslation';
import { formatLovelaceAsAda, formatPercentOfFraction } from '@/shared/utils/format';
import { MAX_ROYALTIES } from '@/utils/nftMarketDeployments';

/**
 * How a price splits: the price, Gero's fee, each creator royalty with its recipient and the
 * total as the share of the price it effectively is (never the rate the collection asks), and
 * what the seller receives. Shown live while the seller types (a preview) and again on the
 * review of what the worker verified, which adds the deposit (locked with the NFT, coming back
 * when it sells or the seller unlists: not money returned now) and the network fee. Royalties the listing leaves out are said plainly, a royalty too small to pay apart from
 * one beyond the recipient limit; an entry of zero lovelace owed nothing and is not mentioned.
 * Amounts are exact: bigint lovelace in, ADA text out.
 */
const props = withDefaults(defineProps<{
  price: bigint;
  fee: bigint;
  /** The royalty entries as paid, each with its own amount. */
  royalties: readonly { address: string; lovelace: bigint }[];
  sellerReceives: bigint;
  /** Entries left out of the listing, from the preview or the worker. */
  dropped?: readonly { address: string; lovelace: bigint }[];
  /** The least a royalty output may hold: what tells "too small" from "did not fit". */
  minUtxo?: bigint;
  invalidRecipients?: number;
  /** The listing's own lovelace, returned to the seller. Known once the worker has built the transaction. */
  deposit?: bigint | null;
  networkFee?: bigint | null;
}>(), { dropped: () => [], minUtxo: () => 0n, invalidRecipients: 0, deposit: null, networkFee: null });

const { t, tc } = useTranslation();

const ada = (lovelace: bigint): string => formatLovelaceAsAda(lovelace);
const shortAddress = (address: string): string => (address.length > 30 ? `${address.slice(0, 15)}…${address.slice(-8)}` : address);

const royaltiesTotal = computed(() => props.royalties.reduce((sum, royalty) => sum + royalty.lovelace, 0n));
const royaltyPercent = computed(() =>
  formatPercentOfFraction(shareOfPrice(royaltiesTotal.value, props.price), getLocaleCode(i18n.locale)),
);
const leftOut = computed(() => classifyDroppedRoyalties(props.dropped, props.minUtxo));
</script>

<style scoped lang="scss">
.listing-breakdown__rows {
  margin: 0;
  padding: var(--g-s-3);
  border-radius: var(--g-r-card);
}

.listing-breakdown__row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--g-s-3);
  padding: var(--g-s-1) 0;

  dt {
    color: var(--g-text-2);
    min-width: 0;
    overflow-wrap: anywhere;
  }

  dd {
    margin: 0;
    color: var(--g-text-1);
    text-align: right;
    flex-shrink: 0;
  }
}

.listing-breakdown__row--sub {
  padding-left: var(--g-s-3);
}

// What the seller keeps: the line the eye goes to.
.listing-breakdown__row--total {
  margin-top: var(--g-s-1);
  padding-top: var(--g-s-2);
  border-top: 1px solid var(--g-hairline-2);

  dt {
    color: var(--g-text-1);
  }
}

.listing-breakdown__note {
  margin: var(--g-s-2) 0 0;
  color: var(--g-text-2);
}
</style>
