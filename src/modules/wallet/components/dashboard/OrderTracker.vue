<template>
  <section class="order-tracker glass-panel" :aria-labelledby="titleId">
    <!-- The order can no longer complete -->
    <template v-if="view.ended">
      <div class="order-tracker__head">
        <IsoScene name="attention" class="order-tracker__art" />
        <div class="order-tracker__title">
          <CardChip tone="error">{{ view.ended === 'expired' ? t('card.expired') : t('card.rejected') }}</CardChip>
          <h2 :id="titleId" class="t-heading">
            {{ view.ended === 'expired' ? t('card.paymentExpired') : t('card.cardRejected') }}
          </h2>
        </div>
      </div>
      <p class="t-body">
        {{ view.ended === 'expired' ? t('card.paymentExpiredMessage') : t('card.cardRejectedMessage') }}
      </p>
      <div class="order-tracker__actions">
        <GButton tier="primary" @click="emit('order-new')">{{ t('card.orderNewCard') }}</GButton>
      </div>
    </template>

    <template v-else>
      <div class="order-tracker__head">
        <IsoScene :name="physical ? 'shipping' : 'virtual'" class="order-tracker__art" />
        <div class="order-tracker__title">
          <span class="t-label">{{ physical ? t('card.physicalCardOrder') : t('card.virtualCardOrder') }}</span>
          <h2 :id="titleId" class="t-heading">{{ physical ? t('card.trackerTitlePhysical') : t('card.trackerTitleVirtual') }}</h2>
          <span v-if="physical" class="t-body-sm">{{ t('card.estimatedDelivery') }}</span>
        </div>
      </div>

      <ol class="order-tracker__stages">
        <li v-for="(stage, i) in view.stages" :key="stage.id" :class="`is-${stage.state}`" :aria-current="stage.state === 'current' ? 'step' : undefined">
          <span class="order-tracker__rail" aria-hidden="true">
            <span class="order-tracker__dot">
              <v-icon v-if="stage.state === 'done'" x-small>mdi-check</v-icon>
            </span>
            <span v-if="i < view.stages.length - 1" class="order-tracker__line"></span>
          </span>
          <span class="order-tracker__stage">
            <span class="order-tracker__stage-label">{{ stageLabel(stage.id) }}</span>
            <span v-if="stage.state === 'current' && stageNote(stage.id)" class="t-caption">{{ stageNote(stage.id) }}</span>
          </span>
        </li>
      </ol>

      <div v-if="view.needsPayment" class="order-tracker__pay">
        <span v-if="countdown" class="t-body-sm order-tracker__countdown">
          <v-icon small>mdi-clock-outline</v-icon>
          {{ t('card.addressValidFor', { time: countdown }) }}
        </span>
        <GButton tier="primary" @click="emit('pay')">{{ t('card.completePayment') }}</GButton>
      </div>

      <CardActivationPanel
        v-if="view.canActivate"
        :order-uuid="card.cardData.order_uuid"
        class="order-tracker__activate"
        @activated="emit('activated', $event)"
      />

      <p class="order-tracker__note t-caption">
        <v-icon x-small>mdi-refresh</v-icon>
        {{ t('card.trackerAutoRefresh') }}
      </p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { CardInfo } from '@/models/card';
import { useTranslation } from '@/shared/composables/useTranslation';
import type { OrderStageId, OrderTrackerView } from '@/modules/wallet/utils/cardOrderTracker';
import GButton from '@/shared/components/GButton/GButton.vue';
import IsoScene from '@/shared/components/iso/IsoScene.vue';
import CardChip from '../ui/CardChip.vue';
import CardActivationPanel from './CardActivationPanel.vue';

const props = defineProps<{
  card: CardInfo;
  view: OrderTrackerView;
  /** When the delivery-fee deposit address expires (ISO time), if known. */
  expiresAt?: string;
}>();

const emit = defineEmits<{
  (e: 'pay'): void;
  (e: 'order-new'): void;
  (e: 'activated', cardUuid: string | null): void;
}>();

const { t } = useTranslation();

const physical = computed(() => props.card.cardData.own_type === 'physical');
const titleId = computed(() => `order-tracker-${props.card.cardData.order_uuid}`);

function stageLabel(id: OrderStageId): string {
  switch (id) {
    case 'placed': return t('card.trackerPlaced');
    case 'paid': return t('card.trackerPaid');
    case 'dispatched': return t('card.trackerDispatched');
    case 'activated': return t('card.trackerActivated');
    default: return t('card.trackerReady');
  }
}

function stageNote(id: OrderStageId): string {
  if (id === 'paid') {
    if (props.view.paymentDetected) return t('card.trackerPaymentDetected');
    if (props.view.needsPayment) return t('card.trackerAwaitingPayment');
  }
  if (id === 'dispatched') return props.view.canActivate ? t('card.trackerOnItsWay') : t('card.trackerPreparing');
  if (id === 'activated') return t('card.trackerActivating');
  if (id === 'ready' && !physical.value) return t('card.trackerIssuing');
  return '';
}

// Time left on the one-time deposit address, so nobody pays an address that is about to rotate.
const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | null = null;

const countdown = computed(() => {
  if (!props.expiresAt) return '';
  const left = Date.parse(props.expiresAt) - now.value;
  if (!(left > 0)) return '';
  const minutes = Math.floor(left / 60000);
  const seconds = Math.floor((left % 60000) / 1000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
});

watch(
  () => props.view.needsPayment && !!props.expiresAt,
  ticking => {
    if (clock) clearInterval(clock);
    clock = ticking ? setInterval(() => { now.value = Date.now(); }, 1000) : null;
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (clock) clearInterval(clock);
});
</script>

<style lang="scss" scoped>
.order-tracker {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-5);
  width: 100%;

  p {
    margin: 0;
  }
}

.order-tracker__head {
  display: flex;
  align-items: center;
  gap: var(--g-s-4);
}

.order-tracker__art {
  width: 128px;
  flex: none;
}

.order-tracker__title {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--g-s-1);

  h2 {
    margin: 0;
  }
}

.order-tracker__stages {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    display: grid;
    grid-template-columns: 24px 1fr;
    gap: var(--g-s-3);
  }
}

.order-tracker__rail {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.order-tracker__dot {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  flex: none;
  border-radius: var(--g-r-pill);
  border: 1px solid var(--g-hairline-3);
}

.order-tracker__line {
  flex: 1;
  width: 1px;
  min-height: 16px;
  background: var(--g-hairline-2);
}

.order-tracker__stage {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 0 var(--g-s-3);
}

.order-tracker__stage-label {
  font-size: 14px;
  color: var(--g-text-3);
}

.is-done {
  .order-tracker__dot {
    border-color: transparent;
    background: var(--g-success-fill);

    .v-icon {
      color: var(--g-success);
    }
  }

  .order-tracker__line {
    background: var(--g-success);
  }

  .order-tracker__stage-label {
    color: var(--g-text-2);
  }
}

.is-current {
  .order-tracker__dot {
    border-color: var(--g-accent);
    box-shadow: inset 0 0 0 4px var(--g-canvas), inset 0 0 0 10px var(--g-accent);
  }

  .order-tracker__stage-label {
    color: var(--g-text-1);
    font-weight: 550;
  }
}

.order-tracker__pay {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
}

.order-tracker__countdown {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);
  font-variant-numeric: tabular-nums;
}

.order-tracker__activate {
  padding-top: var(--g-s-4);
  border-top: 1px solid var(--g-hairline-1);
}

.order-tracker__note {
  display: flex;
  align-items: center;
  gap: var(--g-s-1);
}

.order-tracker__actions {
  display: flex;
  gap: var(--g-s-2);
}
</style>
