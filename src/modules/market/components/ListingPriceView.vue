<template>
  <div class="listing-price-view">
    <!-- A reprice: the price it replaces. -->
    <dl v-if="currentPrice != null" class="listing-price-view__old glass-tier">
      <div class="listing-price-view__hint" :data-testid="`${testid}-old-price`">
        <dt class="t-caption">{{ t('nftMarket.reprice.current') }}</dt>
        <dd class="t-body-sm g-num">{{ ada(currentPrice) }} ADA</dd>
      </div>
    </dl>

    <!-- The collection floor and the NFT's last sale: hints for choosing a price. -->
    <dl v-if="f.floorLovelace !== null || f.lastSaleLovelace !== null" class="listing-price-view__hints">
      <div v-if="f.floorLovelace !== null" class="listing-price-view__hint listing-price-view__hint--column" :data-testid="`${testid}-floor`">
        <dt class="t-caption">{{ t('portfolio.floorPrice') }}</dt>
        <dd class="t-body-sm g-num">{{ ada(f.floorLovelace) }} ADA</dd>
      </div>
      <div v-if="f.lastSaleLovelace !== null" class="listing-price-view__hint listing-price-view__hint--column" :data-testid="`${testid}-last-sale`">
        <dt class="t-caption">{{ t('portfolio.lastSale') }}</dt>
        <dd class="t-body-sm g-num">{{ ada(f.lastSaleLovelace) }} ADA</dd>
      </div>
    </dl>

    <v-text-field
      :model-value="f.priceText"
      :label="t('common.price')"
      inputmode="decimal"
      variant="outlined"
      density="comfortable"
      autocomplete="off"
      suffix="ADA"
      :error-messages="f.priceErrors"
      :disabled="busy"
      :data-testid="`${testid}-price`"
      @update:model-value="f.onPriceInput($event)"
      @keydown.enter="emit('submit')"
    />

    <!-- The terms the royalties come from. A listing is never priced without them. -->
    <p v-if="!isReprice && f.royaltiesState === 'loading'" class="t-caption listing-price-view__note" :data-testid="`${testid}-royalties-loading`">
      {{ t('nftMarket.list.royaltiesLoading') }}
    </p>
    <div v-else-if="!isReprice && f.royaltiesState === 'failed'" class="listing-price-view__note">
      <v-alert type="error" variant="tonal" density="compact" :data-testid="`${testid}-royalties-error`">
        {{ t('nftMarket.error.royaltiesUnreadable') }}
      </v-alert>
      <GButton tier="tertiary" compact class="mt-2" :data-testid="`${testid}-royalties-retry`" @click="f.market.load()">
        {{ t('common.tryAgain') }}
      </GButton>
    </div>

    <v-alert v-if="f.unavailableText" type="error" variant="tonal" density="compact" class="mt-2" :data-testid="`${testid}-unavailable`">
      {{ f.unavailableText }}
    </v-alert>
    <v-alert v-else-if="f.termsErrorText" type="error" variant="tonal" density="compact" class="mt-2" :data-testid="`${testid}-terms-error`">
      {{ f.termsErrorText }}
    </v-alert>

    <ListingBreakdown
      v-if="f.preview"
      class="mt-3"
      :price="f.preview.price"
      :fee="f.preview.fee"
      :royalties="f.preview.royalties"
      :seller-receives="f.preview.sellerReceives"
      :dropped="f.preview.dropped"
      :invalid-recipients="f.preview.invalidRecipients"
      :min-utxo="f.minUtxo"
    />

    <!-- Royalties above the usual limit: the seller sees what they cost and agrees, or the listing waits. -->
    <div v-if="f.needsConfirmation && f.confirmation" class="listing-price-view__confirm" :data-testid="`${testid}-royalty-warning`">
      <v-alert type="warning" variant="tonal" density="compact">{{ t(isReprice ? 'nftMarket.reprice.royaltyConfirmation' : 'nftMarket.error.royaltyConfirmation') }}</v-alert>
      <v-checkbox
        v-model="f.confirmed"
        :label="t('nftMarket.list.royaltyConfirm', { amount: f.confirmation.ada, percent: f.confirmation.percent })"
        density="compact"
        hide-details
        color="var(--g-accent)"
        :data-testid="`${testid}-royalty-confirm`"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import ListingBreakdown from '@/modules/market/components/ListingBreakdown.vue';
import type { ListingPriceForm } from '@/modules/market/composables/useListingPriceForm';
import { useTranslation } from '@/shared/composables/useTranslation';
import { formatLovelaceAsAda } from '@/shared/utils/format';

/**
 * The price step of a sheet that asks the seller what an NFT should cost, shared by the list sheet
 * (and its edit-price form) and the move-to-Gero sheet so the three price the same way: the price
 * field with its errors, the floor and last-sale hints, the live breakdown of how the price splits
 * (ListingBreakdown, a PREVIEW; the review shows what the worker verified), the royalty terms'
 * loading and failure states, and the agreement the seller gives to royalties above the usual
 * limit. All state and arithmetic is the form's (useListingPriceForm); this is only its view. The
 * sheet around it keeps what differs: its title, its buttons, the flow, the credentials.
 *
 * Test ids are `<testid>-price`, `-floor`, `-last-sale`, `-old-price`, `-royalties-loading`,
 * `-royalties-error`, `-royalties-retry`, `-unavailable`, `-terms-error`, `-royalty-warning`
 * and `-royalty-confirm`.
 */
const props = defineProps<{
  form: ListingPriceForm;
  /** The prefix of every test id: the sheet's own. */
  testid: string;
  /** The sheet is preparing or signing: the price cannot change. */
  busy: boolean;
  /**
   * A reprice prices a listing whose royalties are fixed, so the collection's terms are not waited
   * for; if the kept royalties are above the usual limit at the new price it asks, in its own words.
   */
  isReprice?: boolean;
  /** A reprice: the price it replaces, shown above the field. */
  currentPrice?: bigint | null;
}>();

const emit = defineEmits<{ (e: 'submit'): void }>();

const { t } = useTranslation();
// One reactive view of the form (a plain object of refs): the template reads and writes it like state.
const f = reactive(props.form);
const ada = (lovelace: bigint): string => formatLovelaceAsAda(lovelace);
</script>

<style scoped lang="scss">
.listing-price-view__old {
  margin: 0 0 var(--g-s-3);
  padding: var(--g-s-2) var(--g-s-3);
  border-radius: var(--g-r-card);
}

.listing-price-view__hint {
  display: flex;
  justify-content: space-between;
  gap: var(--g-s-3);

  dt {
    color: var(--g-text-2);
  }

  dd {
    margin: 0;
    color: var(--g-text-1);
  }
}

// The collection floor and the NFT's last sale sit side by side, each label over its figure.
.listing-price-view__hints {
  display: flex;
  gap: var(--g-s-4);
  margin: 0 0 var(--g-s-3);
}

.listing-price-view__hint--column {
  flex: 1 1 0;
  flex-direction: column;
  gap: 0;
}

.listing-price-view__note {
  margin: 0 0 var(--g-s-2);
  color: var(--g-text-2);
}

.listing-price-view__confirm {
  margin-top: var(--g-s-3);
}
</style>
