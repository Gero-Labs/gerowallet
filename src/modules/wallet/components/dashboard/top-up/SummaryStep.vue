<template>
  <div class="topup-summary">
    <dl class="topup-summary__rows glass-tier">
      <div class="topup-summary__row">
        <dt>{{ t('card.transferAmount') }}</dt>
        <dd class="g-num">₳{{ ada }} ADA</dd>
      </div>
      <div class="topup-summary__row">
        <dt>{{ t('card.transferFee') }}</dt>
        <dd class="g-num">₳{{ zero }} ADA</dd>
      </div>
      <div class="topup-summary__row is-total">
        <dt>{{ t('card.totalSpend') }}</dt>
        <dd class="g-num">₳{{ ada }} ADA</dd>
      </div>
      <div class="topup-summary__row is-total">
        <dt>{{ t('card.cardWillReceiveExactly') }}</dt>
        <dd class="g-num topup-summary__receive">{{ eur }} EUR</dd>
      </div>
    </dl>

    <CardAddressRow v-if="depositAddress" :label="t('card.payTo')" :address="depositAddress" />
    <div v-else-if="addressLoading" class="g-skeleton topup-summary__address-skeleton" aria-hidden="true"></div>
    <p v-else class="topup-summary__error t-body-sm" role="alert">{{ t('errors.invalidAddress') }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { adaFigure, cardMoney } from '@/modules/wallet/utils/cardFormat';
import CardAddressRow from '../../ui/CardAddressRow.vue';

const props = defineProps<{
  adaAmount: string;
  eurAmount: string;
  /** The card's deposit address, fetched and validated by the caller; absent when unusable. */
  depositAddress?: string;
  addressLoading: boolean;
}>();

const { t } = useTranslation();

const ada = computed(() => adaFigure(parseFloat(props.adaAmount) || 0));
const eur = computed(() => cardMoney(parseFloat(props.eurAmount) || 0));
const zero = adaFigure(0);
</script>

<style lang="scss" scoped>
.topup-summary {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
}

.topup-summary__rows {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: var(--g-s-2) var(--g-s-4);
}

.topup-summary__row {
  display: flex;
  justify-content: space-between;
  gap: var(--g-s-3);
  padding: var(--g-s-2) 0;
  font-size: 13px;

  dt {
    color: var(--g-text-3);
  }

  dd {
    margin: 0;
    color: var(--g-text-1);
  }

  &.is-total {
    border-top: 1px solid var(--g-hairline-1);

    dt {
      color: var(--g-text-1);
    }

    dd {
      font-weight: 600;
    }
  }

  &.is-total + .is-total {
    border-top: 0;
  }
}

.topup-summary__receive {
  color: var(--g-success);
}

.topup-summary__address-skeleton {
  height: 76px;
}

.topup-summary__error {
  margin: 0;
  color: var(--g-error);
}
</style>
