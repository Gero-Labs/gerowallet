<template>
  <div class="swap-status">
    <section class="glass-panel swap-status__card" :aria-label="t('midnight.swap.status.offer')">
      <div class="swap-status__head">
        <span class="t-label">{{ t('midnight.swap.status.offer') }}</span>
        <SwapStatusChip :status="status" />
      </div>
      <div class="t-heading g-num" data-test="swap-status-terms">{{ termsText }}</div>
      <div v-if="status === 'open'" class="swap-status__time">
        <SwapTimeBar :created-at="record.createdAt" :expires-at="record.expiresAt" :now="now" countdown />
      </div>
    </section>

    <template v-if="status === 'open' || status === 'withdrawing'">
      <SwapBanner tone="warning">{{ t('midnight.swap.spendCancelsShort', { token: givesSymbol }) }}</SwapBanner>
      <GButton v-if="status === 'open'" block data-test="swap-show-code" @click="emit('show-code')">{{ t('midnight.swap.showCode') }}</GButton>
      <SwapBanner v-if="status === 'withdrawing'" tone="info">{{ t('midnight.swap.withdrawSent') }}</SwapBanner>
    </template>

    <template v-else-if="status === 'taken'">
      <SwapBanner tone="success">{{ t('midnight.swap.takenDone', { get: wantsText, give: givesText }) }}</SwapBanner>
      <GButton block @click="emit('history')">{{ t('midnight.swap.viewHistory') }}</GButton>
    </template>

    <SwapBanner v-else-if="status === 'cancelled'" tone="error">
      {{ record.withdrawTxHash ? t('midnight.swap.withdrawn') : t('midnight.swap.cancelledSpent', { token: givesSymbol }) }}
    </SwapBanner>

    <SwapBanner v-else tone="info">{{ t('midnight.swap.error.expired') }}</SwapBanner>

    <GButton v-if="status === 'open'" tier="destructive" block data-test="swap-withdraw" @click="emit('withdraw')">
      {{ t('midnight.swap.withdraw') }}
    </GButton>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import type { MidnightSwapOfferRecord } from '@/chains/midnight/midnightSwapRecords';
import { injectMidnightSwap } from './swapContext';
import { swapDisplayStatus } from './swapStatus';
import { swapLegText, swapTokenInfo } from './swapTokens';
import SwapStatusChip from './SwapStatusChip.vue';
import SwapBanner from './SwapBanner.vue';
import SwapTimeBar from './SwapTimeBar.vue';

const props = defineProps<{ record: MidnightSwapOfferRecord }>();
const emit = defineEmits<{ (e: 'show-code'): void; (e: 'withdraw'): void; (e: 'history'): void }>();
const { t } = useTranslation();
const { now, network } = injectMidnightSwap();

const status = computed(() => swapDisplayStatus(props.record, now.value));
const givesText = computed(() => props.record.gives.map(leg => swapLegText(leg, network.value)).join(', '));
const wantsText = computed(() => props.record.wants.map(leg => swapLegText(leg, network.value)).join(', '));
const termsText = computed(() => `${givesText.value} → ${wantsText.value}`);
const givesSymbol = computed(() => swapTokenInfo(props.record.gives[0]?.tokenType ?? '', network.value).symbol);
</script>

<style scoped lang="scss">
.swap-status {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
}

.swap-status__card {
  padding: var(--g-s-4);
  border-radius: var(--g-r-card);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.swap-status__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
</style>
