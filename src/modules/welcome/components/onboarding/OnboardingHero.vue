<template>
  <!-- The welcome showcase. Two state-aware variants of the same panel:
       'first-run' (no wallets): logo + Welcome! + create-first-wallet CTA -
       a landing, not a login. 'storefront' (wallets exist, logged out): the
       left sign-in panel already carries logo + Welcome!, so this leads with
       the product pitch and a Get Started CTA for adding another wallet. -->
  <div class="onb-hero glass-liquid">
    <div class="onb-hero__head onb-rise" style="--onb-d: 0ms">
      <template v-if="variant === 'first-run'">
        <img :src="geroDashboard" class="onb-hero__logo" alt="Gero Wallet" />
        <h1 class="onb-hero__title t-display">{{ $t('welcome.welcomeMessage') }}</h1>
        <p class="onb-hero__sub t-body-lg">{{ $t('welcome.slideMultichainTitle') }}</p>
      </template>
      <h1 v-else class="onb-hero__title t-display">{{ $t('welcome.slideMultichainTitle') }}</h1>
      <p class="onb-hero__note t-body">{{ $t('welcome.slideMultichainSubtitle') }}</p>
      <GButton tier="primary" class="onb-hero__cta" @click="$emit('get-started')">
        {{ variant === 'first-run' ? $t('welcome.createFirstWallet') : $t('welcome.getStarted') }}
        <v-icon end>mdi-arrow-right</v-icon>
      </GButton>
    </div>

    <IsoMultichainScene class="onb-hero__scene onb-rise" style="--onb-d: 120ms" />

    <div class="onb-hero__tiles onb-rise" style="--onb-d: 240ms">
      <div class="onb-tile glass-tier">
        <IsoFeatureScene kind="security" class="onb-tile__scene" />
        <div class="onb-tile__copy">
          <div class="onb-tile__title t-body-lg">{{ $t('welcome.slideSecurityTitle') }}</div>
          <div class="onb-tile__desc t-body-sm">{{ $t('welcome.slideSecuritySubtitle') }}</div>
        </div>
      </div>
      <div class="onb-tile glass-tier">
        <IsoFeatureScene kind="earn" class="onb-tile__scene" />
        <div class="onb-tile__copy">
          <div class="onb-tile__title t-body-lg">{{ $t('welcome.slideEarnTitle') }}</div>
          <div class="onb-tile__desc t-body-sm">{{ $t('welcome.slideEarnSubtitle') }}</div>
        </div>
      </div>
      <div class="onb-tile glass-tier">
        <IsoFeatureScene kind="cashback" class="onb-tile__scene" />
        <div class="onb-tile__copy">
          <div class="onb-tile__title t-body-lg">{{ $t('welcome.slideCashbackTitle') }}</div>
          <div class="onb-tile__desc t-body-sm">{{ $t('welcome.slideCashbackSubtitle') }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import IsoMultichainScene from './IsoMultichainScene.vue';
import IsoFeatureScene from './IsoFeatureScene.vue';
import { geroDashboard } from '@/utils/assets';
import GButton from '@/shared/components/GButton/GButton.vue';

withDefaults(defineProps<{ variant?: 'first-run' | 'storefront' }>(), {
  variant: 'first-run',
});

defineEmits<{ (e: 'get-started'): void }>();
</script>
<style scoped>
/* The hero sits directly on the chain imagery: the glass-liquid material,
   rounded as a sheet like the onboarding card it swaps with. The feature
   tiles nest inside it on glass-tier. Type comes from the ramp classes in
   the markup; these rules only lay out. */
.onb-hero {
  width: 100%;
  max-width: 880px;
  align-self: center;
  margin: 0 auto;
  padding: var(--g-s-6) var(--g-s-6) var(--g-s-5);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--g-s-2);
  border-radius: var(--g-r-sheet);
}

/* Staggered load reveal, same pattern as the dashboard empty-state hero */
.onb-rise {
  animation: onb-rise var(--g-dur-slow) var(--g-ease) both;
  animation-delay: var(--onb-d, 0ms);
}

@keyframes onb-rise {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: none; }
}

.onb-hero__head {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--g-s-2);
}

.onb-hero__logo {
  width: 96px;
  height: auto;
  margin-bottom: var(--g-s-1);
}

.onb-hero__title {
  line-height: 1.15;
  margin: 0;
}

.onb-hero__sub {
  margin: 0;
}

.onb-hero__note {
  margin: 0;
  max-width: 460px;
}

.onb-hero__head :deep(.onb-hero__cta) {
  margin-top: var(--g-s-3);
  min-width: 230px;
}

.onb-hero__scene {
  width: 100%;
  max-width: 660px;
  margin-top: var(--g-s-1);
}

.onb-hero__tiles {
  width: 100%;
  display: flex;
  gap: var(--g-s-3);
  margin-top: var(--g-s-1);
}

.onb-tile {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--g-s-2);
  padding: var(--g-s-4);
}

.onb-tile__scene {
  width: 84px;
  height: 84px;
  flex-shrink: 0;
}

.onb-tile__copy {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  min-width: 0;
}

.onb-tile__title {
  line-height: 1.25;
}

.onb-tile__desc {
  line-height: 1.45;
}

@media (prefers-reduced-motion: reduce) {
  .onb-rise { animation: none; }
}

@media (max-width: 1100px) {
  .onb-hero__tiles { flex-direction: column; }

  .onb-tile { width: 100%; }
}
</style>
