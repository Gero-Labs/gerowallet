<template>
  <BaseDialog
    :isOpen="open"
    :title="t('card.enjoyZeroFeesUntil')"
    :subtitle="t('card.getStartedFree')"
    :width="900"
    :min-height="0"
    @close="emit('close')"
  >
    <template #art>
      <IsoScene name="hero" />
    </template>

    <div class="card-fees">
      <section class="card-fees__tiers" aria-labelledby="card-fees-tiers">
        <p id="card-fees-tiers" class="card-fees__banner">
          <v-icon small>mdi-star-circle-outline</v-icon>
          <span>
            {{ t('card.startingMayFirst') }} <strong>{{ t('card.geroHolders') }}</strong>
            {{ t('card.willEnjoyTokenIncentives') }}
          </span>
        </p>
        <article v-for="tier in tiers" :key="tier.name" class="card-fees__tier glass-tier">
          <div class="card-fees__tier-head">
            <h3 class="t-body-lg">{{ tier.name }}</h3>
            <span class="t-body-sm">
              <span class="card-fees__price g-num">{{ tier.price }}</span> {{ t('card.inGero') }}
            </span>
          </div>
          <ul class="card-fees__benefits">
            <li v-for="benefit in tier.benefits" :key="benefit">
              <v-icon small>mdi-check</v-icon>
              {{ benefit }}
            </li>
          </ul>
        </article>
      </section>

      <section class="card-fees__table-wrap" aria-labelledby="card-fees-standard">
        <h3 id="card-fees-standard" class="t-body-lg">{{ t('card.standardFees') }}</h3>
        <table class="card-fees__table">
          <thead>
            <tr>
              <th scope="col">{{ t('card.feeType') }}</th>
              <th scope="col" class="card-fees__num">{{ t('card.fee') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="fee in fees" :key="fee.label">
              <td>{{ fee.label }}</td>
              <td class="card-fees__num g-num">{{ fee.value }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>

    <p class="card-fees__footer t-caption">
      <v-icon small>mdi-wallet-outline</v-icon>
      {{ t('card.tierDetectedAutomatically') }}
    </p>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import IsoScene from '@/shared/components/iso/IsoScene.vue';

withDefaults(defineProps<{ open?: boolean }>(), { open: false });
const emit = defineEmits<{ (e: 'close'): void }>();

const { t } = useTranslation();

// $GERO holder tiers and the standard fee schedule. Amounts are the published card terms.
const tiers = computed(() => [
  { name: t('card.babyGero'), price: '€15', benefits: [t('card.freeAtmWithdrawals'), t('card.noMonthlyFee')] },
  { name: t('card.geroPro'), price: '€50', benefits: [t('card.basicPlus'), t('card.allEuIntPosFeesWaived')] },
  { name: t('card.gerobanga'), price: '€200', benefits: [t('card.allFeesWaived')] },
]);

const fees = computed(() => [
  { label: t('card.cardIssuance'), value: '€3' },
  { label: t('card.monthlyFee'), value: `€3 ${t('card.physicalVirtual')}` },
  { label: t('card.topUpAdaEur'), value: '1.5%' },
  { label: t('card.atmWithdrawalEu'), value: '€1.50' },
  { label: t('card.atmWithdrawalIntl'), value: '2% + €2' },
  { label: t('card.posPurchasesEu'), value: '0.5% + €0.15' },
  { label: t('card.posPurchasesIntl'), value: '2.0% + €0.75' },
  { label: t('card.fxConversionMarkup'), value: '1%' },
  { label: t('card.transactionDecline'), value: '€0.50' },
  { label: t('card.replacementCard'), value: `+€5 (${t('card.expressShipping')} +€10)` },
]);
</script>

<style lang="scss" scoped>
.card-fees {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr));
  gap: var(--g-s-5);
  padding: var(--g-s-4) var(--g-s-2) 0;
}

.card-fees__tiers {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
}

.card-fees__banner {
  display: flex;
  gap: var(--g-s-3);
  align-items: flex-start;
  margin: 0;
  padding: var(--g-s-3) var(--g-s-4);
  border-radius: var(--g-r-control);
  background: color-mix(in srgb, var(--g-accent) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--g-accent) 22%, transparent);
  color: var(--g-text-1);
  font-size: 13px;

  .v-icon {
    color: var(--g-accent);
  }
}

.card-fees__tier {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  padding: var(--g-s-3) var(--g-s-4);

  h3 {
    margin: 0;
  }
}

.card-fees__tier-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-2);
}

.card-fees__price {
  color: var(--g-text-1);
  font-weight: 600;
}

.card-fees__benefits {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
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

.card-fees__table-wrap {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);

  h3 {
    margin: 0;
  }
}

.card-fees__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;

  th {
    padding: var(--g-s-2) var(--g-s-3);
    text-align: left;
    border-bottom: 1px solid var(--g-hairline-2);
    color: var(--g-text-3);
    font-size: 11px;
    font-weight: 550;
  }

  td {
    padding: var(--g-s-2) var(--g-s-3);
    border-bottom: 1px solid var(--g-hairline-1);
    color: var(--g-text-2);
  }

  .card-fees__num {
    text-align: right;
  }

  td.card-fees__num {
    color: var(--g-text-1);
  }
}

.card-fees__footer {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  margin: var(--g-s-4) var(--g-s-2) 0;
}
</style>
