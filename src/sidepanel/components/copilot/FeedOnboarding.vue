<template>
  <div class="onboarding-wrap">
    <div class="onboarding-card">
      <!-- Icon -->
      <div class="onboarding-icon-wrap">
        <div class="onboarding-icon-ring">
          <v-icon size="34" class="onboarding-icon">mdi-bell-ring-outline</v-icon>
        </div>
      </div>

      <!-- Title + subtitle -->
      <div class="onboarding-title">{{ stepTitle }}</div>
      <div class="onboarding-desc">{{ stepSubtitle }}</div>

      <!-- Step body -->
      <div class="onboarding-body">
        <FeedSettingsForm
          v-if="step === 0"
          :vibe="settings.vibe"
          :categories="settings.categories"
          :show-vibe="true"
          :vibe-only="true"
          @update:vibe="settings.setVibe"
        />

        <FeedSettingsForm
          v-else-if="step === 1"
          :vibe="settings.vibe"
          :categories="settings.categories"
          :show-vibe="false"
          @update:category="settings.setCategory"
        />

        <div v-else class="onboarding-done">
          <div class="onboarding-done__ring">
            <v-icon size="34" color="#26FAB0">mdi-check</v-icon>
          </div>
        </div>
      </div>

      <!-- Progress dots -->
      <div
        class="wizard-dots"
        :aria-label="$t('copilot.onboarding.stepDots', { current: step + 1, total: 3 })"
      >
        <span
          v-for="i in 3"
          :key="i"
          class="wizard-dot"
          :class="{ 'wizard-dot--active': step === i - 1 }"
        />
      </div>

      <!-- Nav buttons -->
      <div class="wizard-nav">
        <v-btn v-if="step > 0" text small class="wizard-back" @click="back()">
          {{ $t('copilot.onboarding.back') }}
        </v-btn>
        <v-spacer />
        <v-btn v-if="step < 2" depressed class="connect-btn" @click="next()">
          {{ $t('copilot.onboarding.next') }}
        </v-btn>
        <v-btn v-else depressed class="connect-btn" @click="$emit('done')">
          {{ $t('copilot.onboarding.finish') }}
        </v-btn>
      </div>

      <v-btn v-if="step < 2" text x-small class="wizard-skip" @click="$emit('done')">
        {{ $t('copilot.onboarding.skip') }}
      </v-btn>

      <!-- Disclaimer is OUTSIDE the per-step body so it shows on every step incl. skip -->
      <p class="wizard-disclaimer">{{ $t('copilot.feed.disclaimer') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import i18n from '@/plugins/i18n';
import FeedSettingsForm from './FeedSettingsForm.vue';
import { copilotFeedSettings } from '@/sidepanel/composables/useCopilotFeedSettings';

defineEmits<{ (e: 'done'): void }>();

const t = (key: string): string => i18n.t(key) as string;

const settings = copilotFeedSettings;
const step = ref<0 | 1 | 2>(0);

function next() {
  if (step.value < 2) step.value++;
}
function back() {
  if (step.value > 0) step.value--;
}

const stepTitle = computed(() => {
  if (step.value === 0) return t('copilot.vibe.title');
  if (step.value === 1) return t('copilot.category.title');
  return t('copilot.onboarding.doneTitle');
});

const stepSubtitle = computed(() => {
  if (step.value === 0) return t('copilot.onboarding.subtitle');
  if (step.value === 1) return t('copilot.category.subtitle');
  return t('copilot.onboarding.doneSubtitle');
});
</script>

<style scoped>
.onboarding-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  padding: 20px 16px;
}

.onboarding-card {
  width: 100%;
  max-width: 340px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  background:
    linear-gradient(180deg, rgba(19, 22, 27, 0.7) 0%, rgba(10, 12, 16, 0.8) 100%),
    radial-gradient(ellipse at 50% 0%, color-mix(in srgb, var(--chain-primary, #5b8def) 8%, transparent) 0%, transparent 60%);
  backdrop-filter: blur(32px) saturate(1.6);
  -webkit-backdrop-filter: blur(32px) saturate(1.6);
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  padding: 26px 20px 20px;
  box-shadow:
    0 8px 40px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.onboarding-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
}

.onboarding-icon-ring {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--chain-primary, #5b8def) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--chain-primary, #5b8def) 25%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 24px color-mix(in srgb, var(--chain-primary, #5b8def) 15%, transparent);
}

.onboarding-icon {
  color: var(--chain-primary, #5b8def) !important;
}

.onboarding-title {
  font-size: 16px;
  font-weight: 700;
  color: #ffffff;
  text-align: center;
  letter-spacing: -0.01em;
}

.onboarding-desc {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
  text-align: center;
  line-height: 1.55;
}

.onboarding-body {
  width: 100%;
  margin-top: 2px;
}

.onboarding-done {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 0 8px;
}

.onboarding-done__ring {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: rgba(38, 250, 176, 0.08);
  border: 1px solid rgba(38, 250, 176, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Progress dots */
.wizard-dots {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 2px;
}

.wizard-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.25);
  transition: background 0.2s ease, transform 0.2s ease;
}

.wizard-dot--active {
  background: var(--chain-primary, #5b8def);
  transform: scale(1.25);
}

/* Nav */
.wizard-nav {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 8px;
  margin-top: 4px;
}

.connect-btn {
  height: 40px !important;
  min-width: 120px !important;
  border-radius: 10px !important;
  background: color-mix(in srgb, var(--chain-primary, #5b8def) 14%, transparent) !important;
  color: var(--chain-primary, #5b8def) !important;
  border: 1px solid color-mix(in srgb, var(--chain-primary, #5b8def) 32%, transparent) !important;
  font-size: 13px !important;
  font-weight: 700 !important;
  text-transform: none !important;
  letter-spacing: 0.02em !important;
}

.connect-btn:hover {
  background: color-mix(in srgb, var(--chain-primary, #5b8def) 22%, transparent) !important;
}

.wizard-back {
  color: rgba(255, 255, 255, 0.6) !important;
  text-transform: none !important;
  letter-spacing: 0.02em !important;
}

.wizard-skip {
  color: rgba(255, 255, 255, 0.4) !important;
  text-transform: none !important;
  letter-spacing: 0.02em !important;
}

.wizard-disclaimer {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  text-align: center;
  margin: 2px 0 0;
}
</style>
