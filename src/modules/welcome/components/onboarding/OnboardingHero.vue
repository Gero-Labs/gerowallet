<template>
  <!-- The welcome showcase. Two state-aware variants of the same panel:
       'first-run' (no wallets): logo + Welcome! + create-first-wallet CTA -
       a landing, not a login. 'storefront' (wallets exist, logged out): the
       left sign-in panel already carries logo + Welcome!, so this leads with
       the product pitch and a Get Started CTA for adding another wallet. -->
  <div class="onb-hero">
    <div class="onb-hero__head onb-rise" style="--onb-d: 0ms">
      <template v-if="variant === 'first-run'">
        <img :src="geroDashboard" class="onb-hero__logo" alt="Gero Wallet" />
        <h1 class="onb-hero__title">{{ $t('welcome.welcomeMessage') }}</h1>
        <p class="onb-hero__sub">{{ $t('welcome.slideMultichainTitle') }}</p>
      </template>
      <h1 v-else class="onb-hero__title">{{ $t('welcome.slideMultichainTitle') }}</h1>
      <p class="onb-hero__note">{{ $t('welcome.slideMultichainSubtitle') }}</p>
      <v-btn
        class="geroButton onb-hero__cta"
        rounded
        x-large
        depressed
        @click="$emit('get-started')"
      >
        {{ variant === 'first-run' ? $t('welcome.createFirstWallet') : $t('welcome.getStarted') }}
        <v-icon right>mdi-arrow-right</v-icon>
      </v-btn>
    </div>

    <IsoMultichainScene class="onb-hero__scene onb-rise" style="--onb-d: 120ms" />

    <div class="onb-hero__tiles onb-rise" style="--onb-d: 240ms">
      <div class="onb-tile">
        <IsoFeatureScene kind="security" class="onb-tile__scene" />
        <div class="onb-tile__copy">
          <div class="onb-tile__title">{{ $t('welcome.slideSecurityTitle') }}</div>
          <div class="onb-tile__desc">{{ $t('welcome.slideSecuritySubtitle') }}</div>
        </div>
      </div>
      <div class="onb-tile">
        <IsoFeatureScene kind="earn" class="onb-tile__scene" />
        <div class="onb-tile__copy">
          <div class="onb-tile__title">{{ $t('welcome.slideEarnTitle') }}</div>
          <div class="onb-tile__desc">{{ $t('welcome.slideEarnSubtitle') }}</div>
        </div>
      </div>
      <div class="onb-tile">
        <IsoFeatureScene kind="cashback" class="onb-tile__scene" />
        <div class="onb-tile__copy">
          <div class="onb-tile__title">{{ $t('welcome.slideCashbackTitle') }}</div>
          <div class="onb-tile__desc">{{ $t('welcome.slideCashbackSubtitle') }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import IsoMultichainScene from './IsoMultichainScene.vue';
import IsoFeatureScene from './IsoFeatureScene.vue';
import { geroDashboard } from '@/utils/assets';

withDefaults(defineProps<{ variant?: 'first-run' | 'storefront' }>(), {
  variant: 'first-run',
});

defineEmits<{ (e: 'get-started'): void }>();
</script>
<style scoped>
.onb-hero {
  width: 100%;
  max-width: 880px;
  align-self: center;
  margin: 0 auto;
  padding: 36px 40px 28px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  border-radius: var(--g-r-sheet);
  background: rgba(10, 12, 16, 0.55);
  backdrop-filter: blur(20px) saturate(1.4);
  -webkit-backdrop-filter: blur(20px) saturate(1.4);
  outline: 1px solid var(--g-hairline-2);
  outline-offset: -1px;
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
  gap: 8px;
}

.onb-hero__logo {
  width: 96px;
  height: auto;
  margin-bottom: 4px;
}

.onb-hero__title {
  font-family: var(--g-font-ui);
  font-size: 32px;
  font-weight: 700;
  line-height: 1.15;
  color: var(--g-text-1);
  margin: 0;
}

.onb-hero__sub {
  font-size: 16px;
  font-weight: 600;
  color: var(--g-text-2);
  margin: 0;
}

.onb-hero__note {
  font-size: 14px;
  color: var(--g-text-3);
  margin: 0;
  max-width: 460px;
}

.onb-hero__cta {
  margin-top: 12px;
  min-width: 230px;
  text-transform: none;
  letter-spacing: normal;
  font-weight: 700;
}

.onb-hero__scene {
  width: 100%;
  max-width: 660px;
  margin-top: 4px;
}

.onb-hero__tiles {
  width: 100%;
  display: flex;
  gap: 12px;
  margin-top: 4px;
}

/* Marketing tiles: liquid glass over the wave background, an accent keyline
   along the top, the scene haloed in a soft glow, hover lift. */
.onb-tile {
  flex: 1 1 0;
  min-width: 0;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 6px;
  padding: 18px 16px 16px;
  background: linear-gradient(150deg, rgba(19, 22, 27, 0.62) 0%, rgba(19, 22, 27, 0.42) 100%),
    radial-gradient(120% 60% at 50% 0%, rgba(45, 240, 247, 0.06) 0%, transparent 60%);
  backdrop-filter: blur(16px) saturate(1.4);
  -webkit-backdrop-filter: blur(16px) saturate(1.4);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-card);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.onb-tile::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent 8%, var(--g-accent) 50%, transparent 92%);
  opacity: 0.55;
}

.onb-tile__scene {
  width: 84px;
  height: 84px;
  flex-shrink: 0;
  filter: drop-shadow(0 6px 14px rgba(0, 204, 187, 0.18));
}

.onb-tile__copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.onb-tile__title {
  font-size: 15px;
  font-weight: 700;
  color: var(--g-text-1);
  line-height: 1.25;
}

.onb-tile__desc {
  font-size: 12px;
  font-weight: 500;
  line-height: 1.45;
  color: var(--g-text-2);
}

@media (prefers-reduced-motion: reduce) {
  .onb-rise { animation: none; }
}

@media (max-width: 1100px) {
  .onb-hero__tiles { flex-direction: column; }

  .onb-tile { width: 100%; }
}

/* Fallback for browsers without backdrop-filter support */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .onb-hero { background: var(--g-surface); }

  .onb-tile { background: var(--g-raised); }
}
</style>
