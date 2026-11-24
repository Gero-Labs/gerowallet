<template>
  <!-- Gero's open-offers list: absent while Nexus does not serve it for this network. -->
  <section v-if="geroListAvailable" class="swap-board" :aria-labelledby="headingId">
    <div class="swap-board__head">
      <component :is="table ? 'h2' : 'div'" :id="headingId" :class="table ? 't-body-lg swap-board__title' : 't-label'">
        {{ t('midnight.swap.open.title') }}
      </component>
    </div>
    <SwapSegmented v-model="direction" :options="directionOptions" :aria-label="t('midnight.swap.open.direction')" />
    <ul v-if="rows.length" class="swap-board__list" :aria-label="t('midnight.swap.open.title')">
      <li v-for="row in rows" :key="row.offer.offerId">
        <button type="button" class="glass-tier swap-board__row" :disabled="opening === row.offer.offerId" @click="open(row.offer)">
          <span class="swap-board__line">
            <span class="t-body-lg g-num swap-board__get">{{ row.get }}</span>
            <span class="t-body-sm g-num">{{ t('midnight.swap.open.for', { pay: row.pay }) }}</span>
          </span>
          <span class="swap-board__line t-caption">
            <span class="g-num">{{ row.rate }}</span>
            <span v-if="row.left" class="g-num">{{ t('midnight.swap.open.left', { n: row.left }) }}</span>
          </span>
        </button>
      </li>
    </ul>
    <div v-else class="glass-panel swap-board__empty">
      <span class="t-body">{{ t('midnight.swap.open.empty') }}</span>
      <GButton compact @click="emit('make')">{{ t('midnight.swap.make.title') }}</GButton>
    </div>
    <SwapBanner v-if="error" tone="error">{{ error }}</SwapBanner>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import type { MidnightOpenOffer } from '@/api/midnightSwapWire';
import { injectMidnightSwap } from './swapContext';
import { minutesLeft, NIGHT_TOKEN_TYPE, nightTicker, swapLegText, swapRateText } from './swapTokens';
import SwapSegmented from './SwapSegmented.vue';
import SwapBanner from './SwapBanner.vue';

withDefaults(defineProps<{ table?: boolean }>(), { table: false });
const emit = defineEmits<{ (e: 'take', offer: string): void; (e: 'make'): void }>();
const { t } = useTranslation();
const swap = injectMidnightSwap();
const { openOffers, geroListAvailable, network, now } = swap;
const headingId = useId();

/** `get`: offers that give NIGHT; `pay`: offers that ask for it. */
const direction = ref<'get' | 'pay'>('get');
const directionOptions = computed(() => [
  { value: 'get' as const, label: t('midnight.swap.open.getNight', { night: nightTicker(network.value) }) },
  { value: 'pay' as const, label: t('midnight.swap.open.payNight', { night: nightTicker(network.value) }) },
]);

const rows = computed(() => openOffers.value
  .filter(offer => (direction.value === 'get'
    ? offer.gives.some(leg => leg.tokenType === NIGHT_TOKEN_TYPE)
    : offer.wants.some(leg => leg.tokenType === NIGHT_TOKEN_TYPE)))
  .filter(offer => offer.expiresAt === null || offer.expiresAt > now.value)
  .map(offer => ({
    offer,
    // The taker's view: what the maker gives is what the taker gets.
    get: offer.gives.map(leg => swapLegText(leg, network.value)).join(', '),
    pay: offer.wants.map(leg => swapLegText(leg, network.value)).join(', '),
    rate: offer.gives.length === 1 && offer.wants.length === 1 ? swapRateText(offer.gives[0], offer.wants[0], network.value) : '',
    left: offer.expiresAt ? minutesLeft(offer.expiresAt, now.value) : 0,
  })));

const opening = ref('');
const error = ref('');
async function open(offer: MidnightOpenOffer) {
  opening.value = offer.offerId;
  error.value = '';
  try {
    const text = await swap.openOfferString(offer);
    if (text) emit('take', text);
    else error.value = t('midnight.swap.error.gone');
  } finally {
    opening.value = '';
  }
}
</script>

<style scoped lang="scss">
.swap-board {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}

.swap-board__title {
  margin: 0;
}

.swap-board__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}

.swap-board__row {
  width: 100%;
  padding: var(--g-s-3);
  border-radius: var(--g-r-card);
  border: 0;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  text-align: left;
  color: inherit;
  cursor: pointer;
}

.swap-board__row:focus-visible {
  outline: 2px solid var(--g-accent);
  outline-offset: 2px;
}

.swap-board__line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-2);
}

.swap-board__get {
  color: var(--g-text-1);
}

.swap-board__empty {
  padding: var(--g-s-6) var(--g-s-4);
  border-radius: var(--g-r-card);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--g-s-3);
  text-align: center;
}
</style>
