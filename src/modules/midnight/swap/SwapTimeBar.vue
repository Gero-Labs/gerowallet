<template>
  <div class="swap-time">
    <div class="swap-time__track" aria-hidden="true">
      <div class="swap-time__fill" :style="{ width: `${Math.round(lifeLeftFraction(createdAt, expiresAt, now) * 100)}%` }"></div>
    </div>
    <div class="swap-time__row t-caption">
      <span>{{ t('midnight.swap.expiresInRow') }}</span>
      <span class="g-num swap-time__left">{{ countdown ? countdownText(expiresAt, now) : t('midnight.swap.minutes', { n: minutesLeft(expiresAt, now) }) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { countdownText, lifeLeftFraction, minutesLeft } from './swapTokens';

withDefaults(defineProps<{ createdAt: number; expiresAt: number; now: number; countdown?: boolean }>(), { countdown: false });
const { t } = useTranslation();
</script>

<style scoped lang="scss">
.swap-time {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* A track: a justified solid. */
.swap-time__track {
  height: 4px;
  border-radius: var(--g-r-pill);
  background: var(--g-raised);
  overflow: hidden;
}

.swap-time__fill {
  height: 100%;
  border-radius: var(--g-r-pill);
  background: var(--g-accent);
  transition: width var(--g-dur-slow) var(--g-ease);
}

.swap-time__row {
  display: flex;
  justify-content: space-between;
}

.swap-time__left {
  color: var(--g-text-1);
}
</style>
