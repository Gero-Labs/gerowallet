<template>
  <BaseDialog
    :is-open="isOpen"
    size="sm"
    :min-height="0"
    height="auto"
    :title="t('midnight.swap.withdrawTitle')"
    :loading="busy"
    @close="close()"
  >
    <div class="swap-withdraw">
      <p class="t-body swap-withdraw__body">{{ t('midnight.swap.withdrawBody', { amount: givesText }) }}</p>
      <SwapRows :panel="false" :rows="rows" />
      <SwapBanner v-if="error" tone="error">{{ error }}</SwapBanner>
      <SwapPasswordField v-model="password" :is-prf-wallet="isPrfWallet" :disabled="busy" @submit="withdraw()" />
      <div class="swap-withdraw__actions">
        <GButton :disabled="busy" @click="close()">{{ t('midnight.swap.keep') }}</GButton>
        <GButton tier="destructive" :disabled="!canWithdraw" :loading="busy" data-test="swap-withdraw-confirm" @click="withdraw()">
          {{ t('midnight.swap.withdrawShort') }}
        </GButton>
      </div>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { MIDNIGHT_DUST_FEE_ESTIMATE_DISPLAY } from '@/chains/midnight/midnightFeeEstimate';
import type { MidnightSwapOfferRecord } from '@/chains/midnight/midnightSwapRecords';
import { injectMidnightSwap } from './swapContext';
import { minutesLeft, swapLegText } from './swapTokens';
import SwapRows, { type SwapRow } from './SwapRows.vue';
import SwapBanner from './SwapBanner.vue';
import SwapPasswordField from './SwapPasswordField.vue';

const props = defineProps<{ isOpen: boolean; record: MidnightSwapOfferRecord | null }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'withdrawn', txHash: string): void }>();
const { t } = useTranslation();
const swap = injectMidnightSwap();
const { isPrfWallet, network, now } = swap;

const password = ref('');
const busy = ref(false);
const error = ref('');
watch(() => props.isOpen, (open) => { if (open) { password.value = ''; error.value = ''; } });

const givesText = computed(() => props.record?.gives.map(leg => swapLegText(leg, network.value)).join(', ') ?? '');
const rows = computed<SwapRow[]>(() => [
  { label: t('midnight.swap.networkFee'), value: t('midnight.swap.feeAbout', { fee: MIDNIGHT_DUST_FEE_ESTIMATE_DISPLAY }) },
  { label: t('midnight.swap.letExpire'), value: t('midnight.swap.letExpireIn', { n: props.record ? minutesLeft(props.record.expiresAt, now.value) : 0 }), tone: 'muted' },
]);
const canWithdraw = computed(() => !busy.value && !!props.record && (isPrfWallet.value || !!password.value));

function close() {
  if (busy.value) return;
  emit('close');
}

async function withdraw() {
  if (!canWithdraw.value || !props.record) return;
  busy.value = true;
  error.value = '';
  try {
    const credential = await swap.credential(password.value);
    const txHash = await swap.withdrawOffer(props.record.offerId, credential);
    password.value = '';
    emit('withdrawn', txHash);
  } catch (e) {
    error.value = e instanceof Error && e.message ? e.message : t('midnight.swap.error.generic');
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped lang="scss">
.swap-withdraw {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding-top: var(--g-s-3);
}

.swap-withdraw__body {
  margin: 0;
}

.swap-withdraw__actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--g-s-2);
}
</style>
