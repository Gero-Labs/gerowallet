<template>
  <div class="d-flex flex-wrap flex-grow-1">
    <div class="dswap">
      <div class="dswap__titlebar">
        <h1 class="t-title dswap__title">{{ t('midnight.swap.title') }}</h1>
        <SwapNetBadge :label="t('midnight.swap.preprodOnly')" />
      </div>
      <div class="dswap__rule" aria-hidden="true"></div>

      <div class="dswap__grid">
        <section class="glass-panel dswap__card" :aria-labelledby="makeId">
          <div class="dswap__card-head">
            <h2 :id="makeId" class="t-body-lg dswap__card-title">{{ t('midnight.swap.make.title') }}</h2>
            <SwapHint :text="t('midnight.swap.hint.make')" />
          </div>
          <SwapMakeForm compact @created="record => (sharing = record.offerId)" />
        </section>

        <div class="dswap__side">
          <section class="glass-panel dswap__card" :aria-labelledby="takeId" @dragover.prevent @drop.prevent="onDrop">
            <div class="dswap__card-head">
              <h2 :id="takeId" class="t-body-lg dswap__card-title">{{ t('midnight.swap.take.title') }}</h2>
              <SwapHint :text="t('midnight.swap.hint.take')" />
            </div>
            <div class="dswap__drop">
              <span class="dswap__drop-icon" aria-hidden="true"><v-icon size="20">mdi-file-download-outline</v-icon></span>
              <span class="t-body-sm dswap__drop-text">
                {{ t('midnight.swap.open.dropFile') }}
                <SwapHint :text="t('midnight.swap.hint.offerFile')" />
              </span>
              <GButton compact data-test="swap-desk-paste" @click="openTake('paste')">{{ t('midnight.swap.open.pasteCode') }}</GButton>
              <GButton compact data-test="swap-desk-scan" @click="openTake('scan')">{{ t('midnight.swap.open.scanQr') }}</GButton>
            </div>
            <SwapBanner v-if="dropError" tone="error">{{ dropError }}</SwapBanner>
          </section>

          <section class="glass-panel dswap__card">
            <SwapYourOffers
              table
              @open="record => (statusOf = record.offerId)"
              @show-code="record => (sharing = record.offerId)"
              @withdraw="record => (withdrawing = record)"
            />
            <SwapBanner v-if="hasOpenOffer" tone="warning">{{ t('midnight.swap.spendCancelsAny') }}</SwapBanner>
          </section>

          <section v-if="swap.geroListAvailable.value" class="glass-panel dswap__card">
            <SwapOpenOffers table @take="offer => openTakeWith(offer)" @make="focusMake()" />
          </section>
        </div>
      </div>
    </div>

    <!-- Share -->
    <BaseDialog
      :is-open="!!sharedRecord"
      size="lg"
      :min-height="0"
      height="auto"
      :title="t('midnight.swap.share.title')"
      @close="sharing = ''"
    >
      <template #meta><SwapNetBadge :label="t('midnight.swap.preprod')" /></template>
      <div v-if="sharedRecord" class="dswap__dialog">
        <SwapShareView :record="sharedRecord" wide />
        <div class="dswap__dialog-foot">
          <GButton tier="primary" class="dswap__cta" data-test="swap-share-done" @click="sharing = ''">{{ t('common.done') }}</GButton>
        </div>
      </div>
    </BaseDialog>

    <!-- Take: open the code, then review, progress and result -->
    <BaseDialog
      :is-open="takeOpen"
      size="lg"
      :min-height="0"
      height="auto"
      :persistent="takeBusy"
      :title="takeTitle"
      @close="closeTake()"
    >
      <template #meta>
        <span class="dswap__meta">
          <span v-if="takeHeading.left" class="dswap__left t-caption g-num">
            <v-icon size="12" aria-hidden="true">mdi-timer-outline</v-icon>{{ takeHeading.left }}
          </span>
          <SwapNetBadge :label="t('midnight.swap.preprod')" />
        </span>
      </template>
      <div class="dswap__dialog">
        <SwapTakeFlow
          v-if="takeOffer"
          :offer="takeOffer"
          wide
          @back="takeOffer = ''"
          @done="closeTake(true)"
          @history="goHistory()"
          @heading="onTakeHeading"
        />
        <SwapOpenView v-else-if="takeOpen" :key="takeMode" :start-with="takeMode" @offer="offer => (takeOffer = offer)" />
      </div>
    </BaseDialog>

    <!-- A settled offer's status -->
    <BaseDialog :is-open="!!statusRecord" size="sm" :min-height="0" height="auto" :title="t('midnight.swap.status.title')" @close="statusOf = ''">
      <div v-if="statusRecord" class="dswap__dialog">
        <SwapOfferStatusView
          :record="statusRecord"
          @show-code="sharing = statusRecord.offerId; statusOf = ''"
          @withdraw="withdrawing = statusRecord; statusOf = ''"
          @history="goHistory()"
        />
      </div>
    </BaseDialog>

    <SwapWithdrawDialog :is-open="!!withdrawing" :record="withdrawing" @close="withdrawing = null" @withdrawn="withdrawing = null" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import { useRouter } from 'vue-router';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { decodeSwapOffer } from '@/chains/midnight/midnightSwapOffer';
import type { MidnightSwapOfferRecord } from '@/chains/midnight/midnightSwapRecords';
import { provideMidnightSwap } from './swapContext';
import { midnightSwapAvailable } from './useMidnightSwap';
import { swapDisplayStatus } from './swapStatus';
import SwapNetBadge from './SwapNetBadge.vue';
import SwapMakeForm from './SwapMakeForm.vue';
import SwapShareView from './SwapShareView.vue';
import SwapOfferStatusView from './SwapOfferStatusView.vue';
import SwapOpenView from './SwapOpenView.vue';
import SwapTakeFlow from './SwapTakeFlow.vue';
import SwapYourOffers from './SwapYourOffers.vue';
import SwapOpenOffers from './SwapOpenOffers.vue';
import SwapWithdrawDialog from './SwapWithdrawDialog.vue';
import SwapBanner from './SwapBanner.vue';
import SwapHint from './SwapHint.vue';

const { t } = useTranslation();
const router = useRouter();
const swap = provideMidnightSwap();
const makeId = useId();
const takeId = useId();

// The route is gated too (router.ts); a wallet or network switch while here goes home.
watch(midnightSwapAvailable, (available) => { if (!available) void router.replace('/'); }, { immediate: true });

const sharing = ref('');
const statusOf = ref('');
const withdrawing = ref<MidnightSwapOfferRecord | null>(null);
const find = (offerId: string) => (offerId ? swap.offers.value.find(r => r.offerId === offerId) ?? null : null);
const sharedRecord = computed(() => find(sharing.value));
const statusRecord = computed(() => find(statusOf.value));
const hasOpenOffer = computed(() => swap.offers.value.some(r => swapDisplayStatus(r, swap.now.value) === 'open'));

const takeOpen = ref(false);
const takeMode = ref<'scan' | 'paste'>('paste');
const takeOffer = ref('');
const takeHeading = ref({ title: '', left: '' });
const takeBusy = computed(() => takeHeading.value.title === t('midnight.swap.progress.swapping'));
const takeTitle = computed(() => (takeOffer.value ? takeHeading.value.title : t('midnight.swap.take.title')));
const dropError = ref('');

function onTakeHeading(value: { title: string; left: string }) {
  takeHeading.value = value;
}

function openTake(mode: 'scan' | 'paste') {
  takeMode.value = mode;
  takeOffer.value = '';
  takeHeading.value = { title: '', left: '' };
  takeOpen.value = true;
}

function openTakeWith(offer: string) {
  takeOffer.value = offer;
  takeOpen.value = true;
}

function closeTake(force = false) {
  if (takeBusy.value && !force) return;
  takeOpen.value = false;
  takeOffer.value = '';
  takeHeading.value = { title: '', left: '' };
}

function goHistory() {
  closeTake(true);
  statusOf.value = '';
  void router.push('/transactions');
}

function focusMake() {
  document.getElementById(makeId)?.scrollIntoView({ behavior: 'smooth' });
}

/** An offer file dropped anywhere on the Take card. */
async function onDrop(event: DragEvent) {
  dropError.value = '';
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  const text = file.size <= 2_000_000 ? (await file.text()).trim() : '';
  try {
    decodeSwapOffer(text);
  } catch {
    dropError.value = t('midnight.swap.error.invalid');
    return;
  }
  openTakeWith(text.replace(/\s+/g, ''));
}
</script>

<style scoped lang="scss">
.dswap {
  width: 100%;
  max-width: var(--g-content-max);
  margin: 0 auto;
  padding: var(--g-s-2) var(--g-s-5) var(--g-s-5);
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
}

.dswap__titlebar {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
}

.dswap__title {
  margin: 0;
}

/* The header hairline: one of the sanctioned gradient slots. */
.dswap__rule {
  height: 1px;
  margin-bottom: var(--g-s-1);
  background: linear-gradient(90deg, var(--g-grad-2), var(--g-accent) 30%, var(--g-hairline-1) 70%, transparent);
}

.dswap__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
  gap: var(--g-s-4);
  align-items: start;
}

@media (max-width: 960px) {
  .dswap__grid { grid-template-columns: minmax(0, 1fr); }
}

.dswap__side {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  min-width: 0;
}

.dswap__card {
  border-radius: var(--g-r-card);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.dswap__card-head {
  display: flex;
  align-items: center;
  gap: var(--g-s-1);
}

.dswap__card-title {
  margin: 0;
  font-weight: 600;
}

.dswap__drop {
  border: 1px dashed var(--g-hairline-3);
  border-radius: var(--g-r-card);
  padding: 18px;
  display: flex;
  align-items: center;
  gap: 14px;
}

/* An icon tile: a justified solid. */
.dswap__drop-icon {
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

.dswap__drop-text {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  gap: var(--g-s-1);
}

.dswap__dialog {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding-top: var(--g-s-3);
}

.dswap__dialog-foot {
  display: flex;
  justify-content: flex-end;
  padding-top: var(--g-s-3);
  border-top: 1px solid var(--g-hairline-1);
}

.dswap__cta {
  min-width: 120px;
}

.dswap__meta {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-2);
}

/* A chip: a justified solid. */
.dswap__left {
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
</style>
