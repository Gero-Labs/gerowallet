<template>
  <BaseDialog
    size="sm"
    :isOpen="modelValue"
    :title="t('gomining.buyMiner')"
    :img="assts.depositSvg"
    img-color="var(--g-accent)"
    :min-height="0"
    :loading="submitting"
    :persistent="submitting"
    @close="close()"
  >
    <v-card-text v-if="collection" class="px-5 pt-1 pb-5 gm-buy">
      <!-- What is being bought -->
      <div class="glass-tier gm-buy__preview">
        <v-img :src="collection.imageUrl" width="72" height="72" class="gm-buy__image" alt="">
          <template #placeholder>
            <div class="gm-buy__placeholder"><v-icon size="28">mdi-pickaxe</v-icon></div>
          </template>
        </v-img>
        <div class="gm-buy__meta">
          <span class="t-body-lg gm-buy__name">{{ collection.name }}</span>
          <span class="t-caption g-num">
            {{ $t('gomining.hashrateValue', { value: collection.hashrate }) }} · {{ $t('gomining.efficiencyValue', { value: formatUsd(collection.efficiency) }) }}
          </span>
          <span class="t-caption g-num gm-buy__available">{{ $t('gomining.availableCount', { count: collection.available }) }}</span>
        </div>
      </div>

      <!-- Quantity -->
      <div class="gm-buy__qty" role="group" :aria-label="t('gomining.quantity')">
        <span class="t-label">{{ $t('gomining.quantity') }}</span>
        <div class="gm-buy__stepper">
          <v-btn
            icon
            variant="text"
            size="small"
            :disabled="quantity <= 1"
            :aria-label="t('gomining.decreaseQuantity')"
            :title="t('gomining.decreaseQuantity')"
            @click="quantity = Math.max(1, quantity - 1)"
          >
            <v-icon size="small">mdi-minus</v-icon>
          </v-btn>
          <span class="t-heading g-num gm-buy__qty-value" aria-live="polite">{{ quantity }}</span>
          <v-btn
            icon
            variant="text"
            size="small"
            :disabled="quantity >= collection.available"
            :aria-label="t('gomining.increaseQuantity')"
            :title="t('gomining.increaseQuantity')"
            @click="quantity = Math.min(collection.available, quantity + 1)"
          >
            <v-icon size="small">mdi-plus</v-icon>
          </v-btn>
        </div>
      </div>

      <!-- Price -->
      <dl class="gm-summary">
        <div class="t-body-sm gm-summary__row">
          <dt class="g-num">{{ quantity }} × {{ collection.price.toFixed(2) }} {{ collection.currency }}</dt>
          <dd class="g-num">{{ totalPrice }} {{ collection.currency }}</dd>
        </div>
        <div class="t-body-sm gm-summary__row gm-summary__row--total">
          <dt>{{ $t('gomining.totalCost') }}</dt>
          <dd class="g-num">{{ totalPrice }} {{ collection.currency }}</dd>
        </div>
      </dl>

      <div class="t-body-sm gm-notice">
        <v-icon size="small">mdi-information-outline</v-icon>
        <span class="gm-notice__text">{{ $t('gomining.buyRedirectNote') }}</span>
      </div>

      <div class="gm-buy__nav">
        <GButton tier="secondary" :disabled="submitting" @click="close()">{{ $t('common.cancel') }}</GButton>
        <GButton tier="primary" :loading="submitting" @click="submit()">
          <v-icon size="small" start>mdi-open-in-new</v-icon>
          {{ $t('gomining.proceedToCheckout') }}
        </GButton>
      </div>
    </v-card-text>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import goMiningApi, { type GoMiningCollection } from '@/api/gomining-api';
import { useTranslation } from '@/shared/composables/useTranslation';
import { formatUsd } from '@/shared/utils/format';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import assts from '@/utils/assets';

const props = defineProps<{
  modelValue: boolean;
  userId: string;
  collection: GoMiningCollection | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const { t } = useTranslation();

const quantity = ref(1);
const submitting = ref(false);

const totalPrice = computed(() => {
  if (!props.collection) return '0.00';
  return (props.collection.price * quantity.value).toFixed(2);
});

function close() {
  quantity.value = 1;
  emit('update:modelValue', false);
}

async function submit() {
  if (!props.collection) return;
  submitting.value = true;
  try {
    const result = await goMiningApi.initPayment(props.userId, props.collection.id, quantity.value);
    // Open the GoMining checkout page in a new tab
    window.open(result.paymentUrl, '_blank');
    close();
  } catch (error) {
    console.error('⛏ GoMining: payment init failed', error);
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped lang="scss">
/* Sits above BaseDialog's decorative rings, which are positioned. */
.gm-buy {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
}

.gm-buy__preview {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  padding: var(--g-s-3);
}

.gm-buy__image {
  flex: 0 0 auto;
  border-radius: var(--g-r-control);
  background: var(--g-hairline-1);
}

.gm-buy__placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--g-text-3);
}

.gm-buy__meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.gm-buy__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gm-buy__available {
  color: var(--g-success);
}

.gm-buy__qty {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.gm-buy__stepper {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
}

.gm-buy__qty-value {
  min-width: 32px;
  text-align: center;
}

/* ── Summary ────────────────────────────────────────────── */
.gm-summary {
  display: flex;
  flex-direction: column;
  margin: 0;
}

.gm-summary__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-3);
  padding: var(--g-s-2) 0;
  border-top: 1px solid var(--g-hairline-1);
}

.gm-summary__row dt {
  color: var(--g-text-3);
}

.gm-summary__row dd {
  margin: 0;
  color: var(--g-text-1);
  text-align: right;
}

.gm-summary__row--total dt {
  color: var(--g-text-1);
}

.gm-summary__row--total dd {
  font-weight: 600;
}

/* ── Notice ─────────────────────────────────────────────── */
.gm-notice {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-2) var(--g-s-3);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  color: var(--g-text-2);
}

.gm-notice .v-icon {
  flex: 0 0 auto;
  color: inherit;
}

.gm-notice__text {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.gm-buy__nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
}
</style>
