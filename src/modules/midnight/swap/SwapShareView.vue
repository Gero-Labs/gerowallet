<template>
  <div class="swap-share" :class="{ 'swap-share--wide': wide }">
    <SwapOfferQr :offer="record.offer" />
    <div class="swap-share__side">
      <SwapRows :panel="!wide" :rows="rows" :aria-label="t('midnight.swap.status.offer')" />
      <div class="swap-share__actions">
        <GButton data-test="swap-copy" @click="copy()">
          <v-icon start size="16" aria-hidden="true">{{ copied ? 'mdi-check' : 'mdi-content-copy' }}</v-icon>
          {{ copied ? t('midnight.swap.copied') : t('midnight.swap.copyCode') }}
        </GButton>
        <GButton data-test="swap-save" @click="save()">
          <v-icon start size="16" aria-hidden="true">mdi-download</v-icon>
          {{ t('midnight.swap.saveFile') }}
        </GButton>
      </div>
      <div v-if="geroListAvailable && record.status === 'open'" class="swap-share__list">
      <GButton
        block
        :disabled="!!record.listed || listing"
        :loading="listing"
        data-test="swap-list"
        @click="list()"
      >
        <v-icon start size="16" aria-hidden="true">{{ record.listed ? 'mdi-check' : 'mdi-storefront-outline' }}</v-icon>
        {{ record.listed ? t('midnight.swap.listed') : t('midnight.swap.listWithGero') }}
      </GButton>
      <SwapHint :text="t('midnight.swap.hint.listWithGero')" />
      </div>
      <SwapBanner v-if="listError" tone="error">{{ listError }}</SwapBanner>
      <p class="t-caption swap-share__note">{{ t('midnight.swap.anyone') }} <SwapHint :text="t('midnight.swap.hint.share')" /></p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { swapOfferFileName } from '@/chains/midnight/midnightSwapOffer';
import type { MidnightSwapOfferRecord } from '@/chains/midnight/midnightSwapRecords';
import { injectMidnightSwap } from './swapContext';
import { countdownText, swapLegText } from './swapTokens';
import SwapOfferQr from './SwapOfferQr.vue';
import SwapRows, { type SwapRow } from './SwapRows.vue';
import SwapBanner from './SwapBanner.vue';
import SwapHint from './SwapHint.vue';

const props = withDefaults(defineProps<{ record: MidnightSwapOfferRecord; wide?: boolean }>(), { wide: false });
const { t } = useTranslation();
const swap = injectMidnightSwap();
const { now, network, geroListAvailable } = swap;

const rows = computed<SwapRow[]>(() => [
  ...props.record.gives.map(leg => ({ label: t('midnight.swap.youGive'), value: swapLegText(leg, network.value) })),
  ...props.record.wants.map(leg => ({ label: t('midnight.swap.youReceive'), value: swapLegText(leg, network.value) })),
  { label: t('midnight.swap.expiresInRow'), value: countdownText(props.record.expiresAt, now.value), test: 'swap-countdown' },
]);

const copied = ref(false);
async function copy() {
  try {
    await navigator.clipboard.writeText(props.record.offer);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2_000);
  } catch {
    copied.value = false;
  }
}

function save() {
  const blob = new Blob([`${props.record.offer}\n`], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = swapOfferFileName(props.record.offerId);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

const listing = ref(false);
const listError = ref('');
async function list() {
  listing.value = true;
  listError.value = '';
  try {
    await swap.listWithGero(props.record);
  } catch (e) {
    listError.value = e instanceof Error ? e.message : t('midnight.swap.error.generic');
  } finally {
    listing.value = false;
  }
}
</script>

<style scoped lang="scss">
.swap-share {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--g-s-3);
}

.swap-share--wide {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--g-s-5);
  align-items: start;
}

.swap-share__side {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  min-width: 0;
}

.swap-share__actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--g-s-2);
}

.swap-share__note {
  margin: 0;
}

.swap-share__list {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}
</style>
