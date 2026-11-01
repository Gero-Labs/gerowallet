<template>
  <v-alert
    v-if="warning"
    type="warning"
    variant="tonal"
    rounded
    class="ma-2"
    role="alert"
    data-testid="holdings-warning"
  >
    <div class="t-body font-weight-bold">{{ t('holdingsCheck.title') }}</div>
    <div class="t-body">{{ t('holdingsCheck.body') }}</div>
    <div v-if="chainTotal" class="t-body mt-1" data-testid="holdings-warning-chain-total">
      {{ t('holdingsCheck.chainTotal', { amount: chainTotal }) }}
    </div>
  </v-alert>
</template>

<script setup lang="ts">
/**
 * Shown when an independent indexer contradicts the holdings Gero's backend
 * reported (chrome/holdingsCheck.ts): what could be disproved is already hidden,
 * and the balance must not be relied on until the warning clears.
 */
import { computed } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { useTranslation } from '@/shared/composables/useTranslation';
import { baseUnitsToDecimalString } from '@/shared/utils/amount';
import networks from '@/utils/networks';

const { t } = useTranslation();

const warning = computed(() => {
  const current = walletStore.holdingsWarning;
  return current && current.walletId === walletStore.loggedWallet?.id ? current : null;
});

const chainTotal = computed(() => {
  const total = warning.value?.chainTotal;
  if (!total) return '';
  const wallet = walletStore.loggedWallet;
  return `${baseUnitsToDecimalString(total, 6)} ${networks.resolveCurrencyTicker(wallet?.chain, wallet?.network)}`;
});
</script>
