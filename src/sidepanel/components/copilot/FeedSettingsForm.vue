<template>
  <div class="feed-form">
    <!-- Vibe selector (tone only; never advice) -->
    <section v-if="showVibe" class="feed-form__section">
      <p class="feed-form__subtitle">{{ $t('copilot.vibe.subtitle') }}</p>
      <div class="vibe-options">
        <button
          v-for="opt in vibeOptions"
          :key="opt.value"
          type="button"
          class="vibe-option"
          :class="{ 'vibe-option--active': vibe === opt.value }"
          @click="$emit('update:vibe', opt.value)"
        >
          <div class="vibe-option__head">
            <span class="vibe-option__name">{{ opt.label }}</span>
            <v-icon v-if="vibe === opt.value" size="16" class="vibe-option__check">mdi-check-circle</v-icon>
          </div>
          <span class="vibe-option__desc">{{ opt.desc }}</span>
        </button>
      </div>
    </section>

    <!-- Active categories (what the feed watches today) -->
    <section v-if="!vibeOnly" class="feed-form__section">
      <p class="feed-form__label">{{ $t('copilot.category.title') }}</p>
      <p class="feed-form__subtitle">{{ $t('copilot.category.subtitle') }}</p>

      <div class="cat-row">
        <div class="cat-row__text">
          <span class="cat-row__name">{{ $t('copilot.category.bags') }}</span>
          <span class="cat-row__desc">{{ $t('copilot.category.bagsDesc') }}</span>
        </div>
        <v-switch
          :input-value="categories.bags"
          dense
          hide-details
          inset
          class="cat-row__switch"
          @change="(v) => $emit('update:category', 'bags', !!v)"
        />
      </div>

      <div class="cat-row">
        <div class="cat-row__text">
          <span class="cat-row__name">{{ $t('copilot.category.watchlist') }}</span>
          <span class="cat-row__desc">
            {{ watchlistCount > 0 ? $t('copilot.category.watchlistDesc') : $t('copilot.category.watchlistEmpty') }}
          </span>
        </div>
        <v-switch
          :input-value="categories.watchlist"
          dense
          hide-details
          inset
          class="cat-row__switch"
          @change="(v) => $emit('update:category', 'watchlist', !!v)"
        />
      </div>

      <!-- Coming soon: shown so the user knows what's planned, never settable on -->
      <p class="feed-form__label feed-form__label--muted">{{ $t('copilot.category.comingSoon') }}</p>
      <div v-for="c in comingSoon" :key="c.key" class="cat-row cat-row--disabled">
        <div class="cat-row__text">
          <span class="cat-row__name">{{ c.label }}</span>
          <span class="cat-row__desc">{{ c.desc }}</span>
        </div>
        <span class="cat-row__soon">{{ $t('copilot.category.comingSoon') }}</span>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import i18n from '@/plugins/i18n';
import { useWatchlist } from '@/modules/market/composables/useWatchlist';
import type { CopilotVibe, CopilotCategoryFlags } from '@/services/copilot/preferences';

withDefaults(
  defineProps<{
    vibe: CopilotVibe;
    categories: CopilotCategoryFlags;
    showVibe?: boolean;
    vibeOnly?: boolean;
  }>(),
  { showVibe: false, vibeOnly: false },
);

defineEmits<{
  (e: 'update:vibe', v: CopilotVibe): void;
  (e: 'update:category', k: keyof CopilotCategoryFlags, on: boolean): void;
}>();

const t = (key: string): string => i18n.t(key) as string;

const { watchlistCount } = useWatchlist();

const vibeOptions = computed<{ value: CopilotVibe; label: string; desc: string }[]>(() => [
  { value: 'chill', label: t('copilot.vibe.chill'), desc: t('copilot.vibe.chillDesc') },
  { value: 'normal', label: t('copilot.vibe.normal'), desc: t('copilot.vibe.normalDesc') },
  { value: 'spicy', label: t('copilot.vibe.spicy'), desc: t('copilot.vibe.spicyDesc') },
]);

const comingSoon = computed(() => [
  { key: 'whales', label: t('copilot.category.whales'), desc: t('copilot.category.whalesDesc') },
  { key: 'launches', label: t('copilot.category.launches'), desc: t('copilot.category.launchesDesc') },
  { key: 'governance', label: t('copilot.category.governance'), desc: t('copilot.category.governanceDesc') },
]);
</script>

<style scoped>
.feed-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
  width: 100%;
}

.feed-form__section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.feed-form__label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
  margin: 4px 0 0;
}

.feed-form__label--muted {
  color: rgba(255, 255, 255, 0.35);
  margin-top: 10px;
}

.feed-form__subtitle {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  line-height: 1.5;
  margin: 0;
}

/* Vibe options */
.vibe-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.vibe-option {
  display: flex;
  flex-direction: column;
  gap: 3px;
  text-align: left;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease;
}

.vibe-option:hover {
  background: rgba(255, 255, 255, 0.05);
}

.vibe-option--active {
  border-color: color-mix(in srgb, var(--chain-primary, #5b8def) 45%, transparent);
  background: color-mix(in srgb, var(--chain-primary, #5b8def) 12%, transparent);
}

.vibe-option__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.vibe-option__name {
  font-size: 14px;
  font-weight: 700;
  color: #ffffff;
}

.vibe-option__check {
  color: var(--chain-primary, #5b8def) !important;
}

.vibe-option__desc {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
  line-height: 1.45;
}

/* Category rows */
.cat-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.07);
}

.cat-row--disabled {
  opacity: 0.5;
}

.cat-row__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cat-row__name {
  font-size: 13px;
  font-weight: 600;
  color: #ffffff;
}

.cat-row__desc {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  line-height: 1.4;
}

.cat-row__switch {
  margin: 0;
  padding: 0;
  flex-shrink: 0;
}

.cat-row__soon {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  padding: 2px 8px;
}
</style>
