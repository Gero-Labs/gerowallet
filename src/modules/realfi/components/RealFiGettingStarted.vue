<template>
  <section class="realfi-getting-started" :class="{ 'realfi-getting-started--compact': compact }">
    <ol class="realfi-getting-started__steps">
      <li class="realfi-getting-started__step">
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
              <GButton class="realfi-getting-started__eligibility-cta" tier="primary" compact @click="$emit('check-eligibility')">
                {{ $t(mainnet ? 'realfi.gettingStarted.eligibilityCta' : 'realfi.gettingStarted.preprodCta') }}
              </GButton>
            </div>
          </template>
          <GButton v-else class="realfi-getting-started__eligibility-cta" tier="primary" compact @click="$emit('check-eligibility')">
            {{ $t(mainnet ? 'realfi.gettingStarted.eligibilityCta' : 'realfi.gettingStarted.preprodCta') }}
          </GButton>
        </div>
      </li>
      <li class="realfi-getting-started__step">
        <span class="realfi-getting-started__number g-num" aria-hidden="true">2</span>
        <div class="realfi-getting-started__copy">
          <span class="t-label">{{ $t('realfi.gettingStarted.acquireTitle') }}</span>
          <p class="t-body-sm">{{ $t(mainnet ? 'realfi.gettingStarted.acquireBody' : 'realfi.gettingStarted.preprodAcquireBody') }}</p>
          <div v-if="canAcquire" class="realfi-getting-started__actions">
            <GButton tier="secondary" compact @click="$emit('get-usdrf')">
              {{ $t('realfi.gettingStarted.getUsdrf') }}
            </GButton>
            <GButton v-if="canAcquireUsdcx" tier="tertiary" compact @click="$emit('get-usdcx')">
              {{ $t('realfi.gettingStarted.getUsdcx') }}
            </GButton>
          </div>
          <p v-else-if="mainnet" class="t-caption">
            {{ $t(`realfi.gettingStarted.swapStatus.${swapStatus}`) }}
          </p>
          <GButton
            v-if="mainnet && canRetryAvailability"
            tier="tertiary"
            compact
            @click="$emit('retry-availability')"
          >
            {{ $t('realfi.gettingStarted.retryAvailability') }}
          </GButton>
          <GButton v-else-if="!mainnet" tier="secondary" compact @click="$emit('get-usdrf')">
            {{ $t('realfi.gettingStarted.preprodCta') }}
          </GButton>
          <p v-if="mainnet" class="t-caption">{{ $t('realfi.gettingStarted.routeNote') }}</p>
          <p v-if="mainnet && canAcquireUsdcx" class="t-caption">
            {{ $t('realfi.gettingStarted.getUsdcxNote') }}
          </p>
        </div>
      </li>
      <li class="realfi-getting-started__step">
        <span class="realfi-getting-started__number g-num" aria-hidden="true">3</span>
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
import GButton from '@/shared/components/GButton/GButton.vue';

withDefaults(
  defineProps<{
    mainnet: boolean;
    hasUsdr: boolean;
    canStake: boolean;
    canStakeExternally: boolean;
    canAcquire: boolean;
    canAcquireUsdcx: boolean;
    swapStatus: 'disabled' | 'unknown' | 'loading' | 'available' | 'unavailable';
    canRetryAvailability: boolean;
    compact?: boolean;
  }>(),
  { compact: false },
);

defineEmits<{
  (event: 'check-eligibility'): void;
  (event: 'get-usdrf'): void;
  (event: 'get-usdcx'): void;
  (event: 'retry-availability'): void;
  (event: 'stake'): void;
}>();
</script>

<style lang="scss" scoped>
.realfi-getting-started {
  @include g-glass-panel(false);
  box-sizing: border-box;
  width: 100%;
  max-width: 76ch;
  padding: var(--g-s-4);
  margin: var(--g-s-4) auto;
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-card);
  text-align: left;
}

.realfi-getting-started__steps {
  display: grid;
  gap: var(--g-s-4);
  padding: 0;
  margin: 0;
  list-style: none;
}

.realfi-getting-started__step {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--g-s-3);
  align-items: start;
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

.realfi-getting-started__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-2);
}

.realfi-getting-started--compact .realfi-getting-started__steps {
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
}

.realfi-getting-started--compact {
  max-width: none;
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
