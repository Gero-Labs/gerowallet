<template>
  <div ref="root" class="mswap">
    <header class="mswap__header">
      <GButton
        tier="tertiary"
        compact
        class="mswap__back"
        :aria-label="view.name === 'share' ? t('common.close') : t('common.back')"
        data-test="swap-back"
        @click="back()"
      >
        <v-icon size="18" aria-hidden="true">{{ view.name === 'share' ? 'mdi-close' : 'mdi-chevron-left' }}</v-icon>
      </GButton>
      <h1 class="t-body-lg mswap__title">{{ title }}</h1>
      <span v-if="takeLeft" class="mswap__left t-caption g-num">
        <v-icon size="12" aria-hidden="true">mdi-timer-outline</v-icon>{{ takeLeft }}
      </span>
      <SwapNetBadge v-else :label="t('midnight.swap.preprod')" />
    </header>

    <main class="mswap__body">
      <template v-if="view.name === 'home'">
        <div class="mswap__choices">
          <button type="button" class="glass-tier mswap__choice" data-test="swap-choice-make" @click="go({ name: 'make' })">
            <span class="mswap__choice-icon" aria-hidden="true"><v-icon size="20">mdi-plus</v-icon></span>
            <span class="mswap__choice-text">
              <span class="t-body mswap__choice-title">{{ t('midnight.swap.make.title') }}</span>
              <span class="t-caption">{{ t('midnight.swap.make.sub') }}</span>
            </span>
            <v-icon size="16" color="var(--g-text-3)" aria-hidden="true">mdi-chevron-right</v-icon>
          </button>
          <button type="button" class="glass-tier mswap__choice" data-test="swap-choice-take" @click="go({ name: 'open' })">
            <span class="mswap__choice-icon" aria-hidden="true"><v-icon size="20">mdi-qrcode-scan</v-icon></span>
            <span class="mswap__choice-text">
              <span class="t-body mswap__choice-title">{{ t('midnight.swap.take.title') }}</span>
              <span class="t-caption">{{ t('midnight.swap.take.sub') }}</span>
            </span>
            <v-icon size="16" color="var(--g-text-3)" aria-hidden="true">mdi-chevron-right</v-icon>
          </button>
        </div>
        <SwapYourOffers @open="record => go({ name: 'status', offerId: record.offerId })" />
        <SwapOpenOffers @take="offer => go({ name: 'take', offer })" @make="go({ name: 'make' })" />
      </template>

      <SwapMakeForm v-else-if="view.name === 'make'" @created="record => go({ name: 'share', offerId: record.offerId })" />

      <SwapShareView v-else-if="view.name === 'share' && record" :record="record" />

      <SwapOfferStatusView
        v-else-if="view.name === 'status' && record"
        :record="record"
        @show-code="go({ name: 'share', offerId: record.offerId })"
        @withdraw="withdrawing = record"
        @history="router.push('/activity')"
      />

      <SwapOpenView v-else-if="view.name === 'open'" @offer="offer => go({ name: 'take', offer })" />

      <SwapTakeFlow
        v-else-if="view.name === 'take'"
        :offer="view.offer ?? ''"
        @back="back()"
        @done="go({ name: 'home' })"
        @history="router.push('/activity')"
        @heading="value => (takeHeading = value)"
      />
    </main>

    <footer v-if="view.name === 'share'" class="mswap__footer">
      <GButton tier="primary" block data-test="swap-share-done" @click="view.offerId && go({ name: 'status', offerId: view.offerId })">
        {{ t('common.done') }}
      </GButton>
    </footer>

    <SwapWithdrawDialog :is-open="!!withdrawing" :record="withdrawing" @close="withdrawing = null" @withdrawn="withdrawing = null" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import GButton from '@/shared/components/GButton/GButton.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import type { MidnightSwapOfferRecord } from '@/chains/midnight/midnightSwapRecords';
import { provideMidnightSwap } from '@/modules/midnight/swap/swapContext';
import { midnightSwapAvailable } from '@/modules/midnight/swap/useMidnightSwap';
import SwapNetBadge from '@/modules/midnight/swap/SwapNetBadge.vue';
import SwapMakeForm from '@/modules/midnight/swap/SwapMakeForm.vue';
import SwapShareView from '@/modules/midnight/swap/SwapShareView.vue';
import SwapOfferStatusView from '@/modules/midnight/swap/SwapOfferStatusView.vue';
import SwapOpenView from '@/modules/midnight/swap/SwapOpenView.vue';
import SwapTakeFlow from '@/modules/midnight/swap/SwapTakeFlow.vue';
import SwapYourOffers from '@/modules/midnight/swap/SwapYourOffers.vue';
import SwapOpenOffers from '@/modules/midnight/swap/SwapOpenOffers.vue';
import SwapWithdrawDialog from '@/modules/midnight/swap/SwapWithdrawDialog.vue';

type View =
  | { name: 'home' }
  | { name: 'make' }
  | { name: 'share'; offerId: string }
  | { name: 'status'; offerId: string }
  | { name: 'open' }
  | { name: 'take'; offer: string };

const { t } = useTranslation();
const router = useRouter();
const swap = provideMidnightSwap();

// The route is gated too (router.ts); a wallet or network switch while here goes home.
watch(midnightSwapAvailable, (available) => { if (!available) void router.replace('/'); }, { immediate: true });

const view = ref<View & { offerId?: string; offer?: string }>({ name: 'home' });
const history: View[] = [];
const takeHeading = ref<{ title: string; left: string }>({ title: '', left: '' });
const withdrawing = ref<MidnightSwapOfferRecord | null>(null);

const record = computed(() => (view.value.offerId ? swap.offers.value.find(r => r.offerId === view.value.offerId) ?? null : null));
const takeLeft = computed(() => (view.value.name === 'take' ? takeHeading.value.left : ''));
const title = computed(() => {
  switch (view.value.name) {
    case 'make': return t('midnight.swap.make.title');
    case 'share': return t('midnight.swap.share.title');
    case 'status': return t('midnight.swap.status.title');
    case 'open': return t('midnight.swap.take.title');
    case 'take': return takeHeading.value.title || t('midnight.swap.review.title');
    default: return t('midnight.swap.title');
  }
});

function go(next: View) {
  // A created offer, a shared one and a finished swap lead back to the swap home, not into the form or the code again.
  const fromShare = view.value.name === 'share' && next.name === 'status';
  const fromMake = view.value.name === 'make' && next.name === 'share';
  if (next.name === 'home' || fromShare || fromMake) history.length = 0;
  else history.push(view.value);
  view.value = next;
}

/**
 * Each screen starts at its top. The panel scrolls one container for every
 * page, so a long screen (the make form) would leave the next one scrolled
 * under the panel's sticky header.
 */
const root = ref<HTMLElement | null>(null);
watch(() => view.value, async () => {
  await nextTick();
  for (let el = root.value?.parentElement ?? null; el; el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY !== 'visible') { el.scrollTop = 0; break; }
  }
});

function back() {
  if (view.value.name === 'home') { void router.push('/'); return; }
  view.value = history.pop() ?? { name: 'home' };
}
</script>

<style scoped lang="scss">
.mswap {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.mswap__header {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-3) var(--g-s-4);
  border-bottom: 1px solid var(--g-hairline-1);
}

.mswap__back {
  min-width: var(--g-btn-h-compact);
  padding: 0 var(--g-s-2);
}

.mswap__title {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  font-weight: 600;
}

/* A chip: a justified solid. */
.mswap__left {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 var(--g-s-2);
  border-radius: var(--g-r-chip);
  border: 1px solid var(--g-hairline-2);
  background: var(--g-raised);
  color: var(--g-text-1);
}

.mswap__body {
  flex: 1 1 auto;
  padding: var(--g-s-4);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.mswap__footer {
  padding: var(--g-s-3) var(--g-s-4) var(--g-s-4);
}

.mswap__choices {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}

.mswap__choice {
  width: 100%;
  min-height: 64px;
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  padding: 14px;
  border: 0;
  border-radius: var(--g-r-card);
  text-align: left;
  color: var(--g-text-2);
  cursor: pointer;
}

.mswap__choice:focus-visible {
  outline: 2px solid var(--g-accent);
  outline-offset: 2px;
}

/* An icon tile: a justified solid. */
.mswap__choice-icon {
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  border-radius: var(--g-r-control);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--g-accent);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-2);
}

.mswap__choice-text {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mswap__choice-title {
  color: var(--g-text-1);
  font-weight: 600;
}
</style>
