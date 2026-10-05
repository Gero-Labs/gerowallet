<template>
  <section class="realfi-getting-started" :class="{ 'realfi-getting-started--compact': compact }">
    <ol class="realfi-getting-started__steps">
      <li class="realfi-getting-started__step">
        <IsoScene v-if="!compact" name="earnRegion" class="realfi-getting-started__art" />
        <span class="realfi-getting-started__number g-num" aria-hidden="true">1</span>
        <div class="realfi-getting-started__copy">
          <span class="t-label">{{ $t('realfi.gettingStarted.eligibilityTitle') }}</span>
          <p class="t-body-sm">{{ $t(mainnet ? 'realfi.gettingStarted.eligibilityBody' : 'realfi.gettingStarted.preprodEligibilityBody') }}</p>
          <template v-if="mainnet">
            <p class="t-caption">{{ $t('realfi.gettingStarted.eligibilityRestrictions') }}</p>
            <div class="realfi-getting-started__policy-actions">
              <a
                class="t-caption realfi-getting-started__policy"
                href="https://docs.realfi.co/compliance/jurisdictional-eligibility"
                target="_blank"
                rel="noopener noreferrer"
              >
                {{ $t('realfi.gettingStarted.checkRestrictions') }}
              </a>
              <GButton class="realfi-getting-started__eligibility-cta" tier="secondary" compact @click="$emit('check-eligibility')">
                {{ $t('realfi.gettingStarted.eligibilityCta') }}
              </GButton>
            </div>
          </template>
          <GButton v-else class="realfi-getting-started__eligibility-cta" tier="primary" compact @click="$emit('check-eligibility')">
            {{ $t(mainnet ? 'realfi.gettingStarted.eligibilityCta' : 'realfi.gettingStarted.preprodCta') }}
          </GButton>
        </div>
      </li>
      <!-- Mainnet buys USDrf in two swaps, ADA → USDCx → USDrf, one step each. A step ticks
           itself off from what the wallet holds (USDrf counts for both), and its button goes.
           Every step's action is an outlined button, flush with the copy. -->
      <li
        v-if="mainnet"
        class="realfi-getting-started__step"
        :class="{ 'realfi-getting-started__step--done': usdcxDone }"
      >
        <IsoScene v-if="!compact" name="earnUsdcx" class="realfi-getting-started__art" />
        <span class="realfi-getting-started__number g-num" aria-hidden="true">
          <svg v-if="usdcxDone" class="realfi-getting-started__tick" viewBox="0 0 24 24" width="16" height="16"><path d="M21 7 9 19l-5.5-5.5 1.41-1.41L9 16.17 19.59 5.59z" /></svg>
          <template v-else>2</template>
        </span>
        <div class="realfi-getting-started__copy">
          <span class="t-label">{{ $t('realfi.gettingStarted.usdcxTitle') }}</span>
          <span v-if="usdcxDone" class="realfi-getting-started__sr-only">{{ $t('common.done') }}</span>
          <p v-if="canAcquire" class="t-body-sm realfi-getting-started__holding">
            {{ hasUsdcx
              ? $t('realfi.gettingStarted.haveUsdcx', { amount: usdcxLabel })
              : $t('realfi.gettingStarted.needUsdcx') }}
          </p>
          <p v-else class="t-body-sm">{{ $t('realfi.gettingStarted.usdcxBody') }}</p>
          <div v-if="canAcquire && !usdcxDone" class="realfi-getting-started__actions">
            <GButton tier="secondary" compact @click="$emit('get-usdcx')">
              {{ $t('realfi.gettingStarted.getUsdcx') }}
            </GButton>
          </div>
          <p v-if="canAcquire && canSwapUsdrf && !usdcxDone" class="t-caption">
            {{ $t('realfi.gettingStarted.getUsdcxNote') }}
          </p>
          <template v-if="!canAcquire && !usdcxDone">
            <p class="t-caption">{{ $t(`realfi.gettingStarted.swapStatus.${swapStatus}`) }}</p>
            <GButton v-if="canRetryAvailability" tier="secondary" compact @click="$emit('retry-availability')">
              {{ $t('realfi.gettingStarted.retryAvailability') }}
            </GButton>
          </template>
        </div>
      </li>
      <li
        class="realfi-getting-started__step"
        :class="{ 'realfi-getting-started__step--done': usdrfDone }"
      >
        <IsoScene v-if="!compact" name="earnSwap" class="realfi-getting-started__art" />
        <span class="realfi-getting-started__number g-num" aria-hidden="true">
          <svg v-if="usdrfDone" class="realfi-getting-started__tick" viewBox="0 0 24 24" width="16" height="16"><path d="M21 7 9 19l-5.5-5.5 1.41-1.41L9 16.17 19.59 5.59z" /></svg>
          <template v-else>{{ usdrfStep }}</template>
        </span>
        <div class="realfi-getting-started__copy">
          <span class="t-label">{{ $t('realfi.gettingStarted.acquireTitle') }}</span>
          <span v-if="usdrfDone" class="realfi-getting-started__sr-only">{{ $t('common.done') }}</span>
          <p class="t-body-sm">{{ $t(mainnet ? 'realfi.gettingStarted.acquireBody' : 'realfi.gettingStarted.preprodAcquireBody') }}</p>
          <template v-if="mainnet && !usdrfDone">
            <div v-if="canAcquire" class="realfi-getting-started__actions">
              <GButton v-if="canSwapUsdrf" tier="secondary" compact @click="$emit('get-usdrf')">
                {{ $t('realfi.gettingStarted.getUsdrf') }}
              </GButton>
              <!-- Until Gero can swap USDCx for USDrf, RealFi's own app is the way there. -->
              <GButton v-else tier="secondary" compact @click="$emit('open-realfi')">
                {{ $t('realfi.start.cta') }}
              </GButton>
            </div>
            <p v-if="canAcquire && !canSwapUsdrf" class="t-caption">
              {{ $t('realfi.gettingStarted.usdrfSwapPending') }}
            </p>
            <!-- Swaps that are off show their status at the first step still open. -->
            <template v-else-if="!canAcquire && usdcxDone">
              <p class="t-caption">{{ $t(`realfi.gettingStarted.swapStatus.${swapStatus}`) }}</p>
              <GButton v-if="canRetryAvailability" tier="secondary" compact @click="$emit('retry-availability')">
                {{ $t('realfi.gettingStarted.retryAvailability') }}
              </GButton>
            </template>
            <p class="t-caption">{{ $t('realfi.gettingStarted.routeNote') }}</p>
          </template>
          <GButton v-else-if="!mainnet" tier="secondary" compact @click="$emit('get-usdrf')">
            {{ $t('realfi.gettingStarted.preprodCta') }}
          </GButton>
        </div>
      </li>
      <li class="realfi-getting-started__step">
        <IsoScene v-if="!compact" name="earnStake" class="realfi-getting-started__art" />
        <span class="realfi-getting-started__number g-num" aria-hidden="true">{{ usdrfStep + 1 }}</span>
        <div class="realfi-getting-started__copy">
          <span class="t-label">{{ $t('realfi.gettingStarted.stakeTitle') }}</span>
          <p class="t-body-sm">{{ $t('realfi.gettingStarted.stakeBody') }}</p>
          <p class="t-caption">{{ $t('realfi.order.unstakeNoteNoDate') }}</p>
          <GButton
            v-if="hasUsdr && (canStake || canStakeExternally)"
            tier="secondary"
            compact
            @click="$emit('stake')"
          >
            {{ $t(canStake ? 'realfi.start.stakeCta' : 'realfi.start.readyCta') }}
          </GButton>
        </div>
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import IsoScene from '@/shared/components/iso/IsoScene.vue';

const props = withDefaults(
  defineProps<{
    mainnet: boolean;
    hasUsdr: boolean;
    canStake: boolean;
    canStakeExternally: boolean;
    // ADA → USDCx in Gero: the first leg, available whenever Gero can swap into USDCx.
    canAcquire: boolean;
    // USDCx → USDrf in Gero; off until the aggregator serves that route.
    canSwapUsdrf: boolean;
    // USDCx already in the wallet, and how much ("12.50 USDCx").
    hasUsdcx?: boolean;
    usdcxLabel?: string;
    swapStatus: 'disabled' | 'unknown' | 'loading' | 'available' | 'unavailable';
    canRetryAvailability: boolean;
    compact?: boolean;
  }>(),
  { compact: false, hasUsdcx: false, usdcxLabel: '' },
);

// USDrf already in the wallet skips the USDCx leg too.
const usdcxDone = computed(() => props.hasUsdcx || props.hasUsdr);
const usdrfDone = computed(() => props.hasUsdr);
// Preprod has no USDCx step, so the later steps move up a number.
const usdrfStep = computed(() => (props.mainnet ? 3 : 2));

defineEmits<{
  (event: 'check-eligibility'): void;
  (event: 'get-usdrf'): void;
  (event: 'get-usdcx'): void;
  (event: 'open-realfi'): void;
  (event: 'retry-availability'): void;
  (event: 'stake'): void;
}>();
</script>

<style lang="scss" scoped>
.realfi-getting-started {
  @include g-glass-panel(false);
  box-sizing: border-box;
  width: 100%;
  padding: var(--g-s-4);
  margin: var(--g-s-4) auto;
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-card);
  text-align: left;
  container-type: inline-size;
}

// One column, then two, then every step in one row: four steps never wrap 3 + 1. Sized by
// the guide's own width, since the nav drawer and the side panel change what it gets.
.realfi-getting-started__steps {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--g-s-4);
  padding: 0;
  margin: 0;
  list-style: none;
}

@container (min-width: 480px) {
  .realfi-getting-started__steps {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@container (min-width: 880px) {
  .realfi-getting-started__steps {
    grid-template-columns: none;
    grid-auto-columns: minmax(0, 1fr);
    grid-auto-flow: column;
  }
}

.realfi-getting-started__step {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--g-s-3);
  align-items: start;
  // Steps share the tallest step's height; pack the rows up so every number and title
  // starts on the same line instead of drifting down with the spare space.
  align-content: start;
}

/* The step's scene spans the step, above its number and copy (the card hub's feature cards). */
.realfi-getting-started__art {
  grid-column: 1 / -1;
  justify-self: center;
  width: 100%;
  max-width: 200px;
  // One box for all three scenes (their canvases differ in width), so the numbers line up.
  aspect-ratio: 10 / 7;
}

.realfi-getting-started__number {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 1px solid var(--g-hairline-3);
  border-radius: var(--g-r-pill);
  color: var(--g-text-2);
}

// A done step's number turns into a tick.
.realfi-getting-started__step--done .realfi-getting-started__number {
  border-color: var(--g-success-line);
  background: var(--g-success-fill);
  color: var(--g-success);
}

.realfi-getting-started__tick {
  fill: currentColor;
}

.realfi-getting-started__sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

.realfi-getting-started__copy > p {
  margin: var(--g-s-1) 0 var(--g-s-2);
  color: var(--g-text-2);
}

.realfi-getting-started__policy {
  display: inline-block;
  color: var(--g-text-1);
  text-decoration: underline;
  text-underline-offset: var(--g-s-1);
}

.realfi-getting-started__policy-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--g-s-2);
}

.realfi-getting-started__eligibility-cta {
  height: auto;
  max-width: 100%;
  min-height: var(--g-btn-h-compact);
  white-space: normal;
}

.realfi-getting-started__eligibility-cta ::v-deep .v-btn__content {
  white-space: normal;
}

.realfi-getting-started__copy > .realfi-getting-started__holding {
  color: var(--g-text-1);
}

.realfi-getting-started__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-2);
}

.realfi-getting-started__copy {
  min-width: 0;
}

.realfi-getting-started ::v-deep .realfi-getting-started__eligibility-cta.g-btn.v-btn {
  height: auto;
  min-height: var(--g-btn-h-compact);
  padding-top: var(--g-s-2);
  padding-bottom: var(--g-s-2);
}

.realfi-getting-started ::v-deep .realfi-getting-started__eligibility-cta.g-btn.v-btn .v-btn__content {
  flex: 1 1 auto;
  min-width: 0;
  white-space: normal;
}
</style>
