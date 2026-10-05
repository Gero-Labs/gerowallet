<template>
  <div class="card-status">
    <!-- An issued card: balance and controls -->
    <section v-if="hasCard" class="card-balance glass-panel" aria-labelledby="card-balance-label">
      <div class="card-balance__head">
        <span id="card-balance-label" class="t-label">{{ t('card.totalBalance') }}</span>
        <span class="card-balance__chips">
          <CardChip>{{ typeLabel }}<template v-if="last4"> •••• {{ last4 }}</template></CardChip>
          <CardChip v-if="activating" tone="accent" icon="mdi-progress-clock">{{ t('card.trackerActivating') }}</CardChip>
          <CardChip v-else-if="blocked" tone="error" icon="mdi-lock-outline">{{ t('card.blocked') }}</CardChip>
        </span>
      </div>

      <div class="card-balance__figures">
        <span class="t-display g-num">{{ balanceText }}</span>
        <span class="t-body g-num">≈ {{ adaText }} ADA</span>
      </div>

      <div class="card-balance__actions">
        <GButton tier="primary" @click="emit('top-up')">{{ t('card.topUp') }}</GButton>
        <GButton tier="secondary" @click="emit('manage')">{{ t('card.cardControls') }}</GButton>
        <v-btn
          icon
          outlined
          class="card-balance__eye"
          :loading="detailsLoading"
          :aria-label="showCardDetails ? t('card.hideCardDetails') : t('card.showCardDetails')"
          :aria-pressed="showCardDetails ? 'true' : 'false'"
          @click="emit('toggle-card-visibility')"
        >
          <v-icon>{{ showCardDetails ? 'mdi-eye-off-outline' : 'mdi-eye-outline' }}</v-icon>
        </v-btn>
      </div>

      <hr class="card-balance__rule" />
      <div class="card-balance__foot">
        <span class="t-caption g-num">{{ rateLine }}</span>
        <GButton v-if="canOrder" tier="tertiary" compact @click="emit('open-order-card-flow')">
          {{ t('card.orderAnotherCard') }}
        </GButton>
      </div>
    </section>

    <!-- An order that has no card yet -->
    <OrderTracker
      v-else-if="card && tracker"
      :card="card"
      :view="tracker"
      :expires-at="expiresAt"
      @pay="emit('complete-payment')"
      @order-new="emit('open-order-card-flow')"
      @activated="emit('activated', $event)"
    />

    <!-- The empty slot: order a card -->
    <section v-else class="card-order glass-panel" aria-labelledby="card-order-title">
      <IsoScene name="hero" class="card-order__art" />
      <h2 id="card-order-title" class="t-heading">{{ t('card.getYourGeroCard') }}</h2>
      <p class="t-body">{{ t('card.spendCryptoAnywhere') }}</p>
      <CardChip tone="accent" icon="mdi-tag-outline" clickable @click="emit('show-promotion-modal')">
        {{ t('card.enjoyZeroFeesUntil') }}
      </CardChip>
      <ul class="card-order__checks">
        <li><v-icon small>mdi-check</v-icon>{{ t('card.zeroMonthlyFees') }}</li>
        <li><v-icon small>mdi-check</v-icon>{{ t('card.zeroAdaEurFees') }}</li>
      </ul>
      <GButton tier="primary" @click="emit('open-order-card-flow')">{{ t('card.orderNewCard') }}</GButton>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { CardInfo } from '@/models/card';
import { useTranslation } from '@/shared/composables/useTranslation';
import type { OrderTrackerView } from '@/modules/wallet/utils/cardOrderTracker';
import { adaFigure, cardMoney } from '@/modules/wallet/utils/cardFormat';
import GButton from '@/shared/components/GButton/GButton.vue';
import IsoScene from '@/shared/components/iso/IsoScene.vue';
import CardChip from '../ui/CardChip.vue';
import OrderTracker from './OrderTracker.vue';

const props = withDefaults(defineProps<{
  /** The carousel slot in view; undefined or an empty placeholder for the "order a card" slot. */
  card?: CardInfo;
  tracker?: OrderTrackerView;
  expiresAt?: string;
  canOrder?: boolean;
  showCardDetails?: boolean;
  detailsLoading?: boolean;
  /** EUR per ADA (the provider's sell rate). */
  exchangeRate?: number;
  /** The card was just activated and is waiting for the provider to confirm. */
  activating?: boolean;
}>(), {
  card: undefined,
  tracker: undefined,
  expiresAt: undefined,
  canOrder: false,
  showCardDetails: false,
  detailsLoading: false,
  exchangeRate: 0,
  activating: false,
});

const emit = defineEmits<{
  (e: 'top-up'): void;
  (e: 'manage'): void;
  (e: 'toggle-card-visibility'): void;
  (e: 'open-order-card-flow'): void;
  (e: 'complete-payment'): void;
  (e: 'show-promotion-modal'): void;
  (e: 'activated', cardUuid: string | null): void;
}>();

const { t } = useTranslation();

const hasCard = computed(() => !!props.card?.cardData?.card_uuid);

// The per-card balance call is authoritative; the card list's own `balance` shows meanwhile.
const amount = computed<number | null>(() => {
  const live = props.card?.cardBalance?.currentBalance?.amount;
  if (typeof live === 'number' && Number.isFinite(live)) return live;
  const listed = parseFloat(String(props.card?.cardData?.balance ?? ''));
  return Number.isFinite(listed) ? listed : null;
});

const currency = computed(
  () => props.card?.cardBalance?.currentBalance?.currencyCode || props.card?.cardData?.currency || 'EUR',
);

const balanceText = computed(() => (amount.value === null ? '—' : cardMoney(amount.value, currency.value)));
const adaText = computed(() =>
  amount.value === null || !(props.exchangeRate > 0) ? '—' : adaFigure(amount.value / props.exchangeRate),
);
const rateLine = computed(() =>
  props.exchangeRate > 0 ? t('card.rateLine', { rate: cardMoney(props.exchangeRate, currency.value) }) : '',
);

const blocked = computed(
  () => props.card?.cardBalance?.state === 'BLOCKED' || props.card?.cardData?.card_status === 'TEMPORARY_BLOCKED',
);
const typeLabel = computed(() =>
  props.card?.cardData?.own_type === 'physical' ? t('card.typePhysical') : t('card.typeVirtual'),
);
const last4 = computed(() => String(props.card?.cardData?.pan ?? '').replace(/\D/g, '').slice(-4));
</script>

<style lang="scss" scoped>
.card-status {
  display: flex;
  width: 100%;
}

.card-balance,
.card-order {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  width: 100%;
  padding: var(--g-s-5);
}

.card-balance__head,
.card-balance__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-2);
}

.card-balance__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-2);
}

.card-balance__figures {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}

.card-balance__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--g-s-3);
}

.card-balance__eye {
  border-color: var(--g-hairline-2);

  .v-icon {
    color: var(--g-text-2);
  }
}

.card-balance__rule {
  border: 0;
  height: 1px;
  margin: 0;
  background: var(--g-hairline-1);
}

.card-order {
  align-items: flex-start;

  h2,
  p {
    margin: 0;
  }
}

.card-order__art {
  max-width: 280px;
}

.card-order__checks {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
  color: var(--g-text-2);

  li {
    display: flex;
    align-items: center;
    gap: var(--g-s-2);
  }

  .v-icon {
    color: var(--g-accent);
  }
}
</style>
