<template>
  <div class="settings-content">
    <p class="settings-content__subtitle">{{ $t('copilot.settings.subtitle') }}</p>

    <FeedSettingsForm
      :vibe="settings.vibe"
      :categories="settings.categories"
      :show-vibe="true"
      @update:vibe="settings.setVibe"
      @update:category="settings.setCategory"
    />

    <div class="settings-content__actions">
      <v-btn text small class="settings-content__btn" @click="$emit('rerun')">
        <v-icon size="16" class="mr-1">mdi-refresh</v-icon>
        {{ $t('copilot.settings.rerun') }}
      </v-btn>
      <v-btn text small class="settings-content__btn settings-content__btn--muted" @click="$emit('reset')">
        {{ $t('copilot.settings.reset') }}
      </v-btn>
    </div>

    <p class="settings-content__disclaimer">{{ $t('copilot.settings.disclaimer') }}</p>
  </div>
</template>

<script setup lang="ts">
import FeedSettingsForm from './FeedSettingsForm.vue';
import { copilotFeedSettings } from '@/sidepanel/composables/useCopilotFeedSettings';

defineEmits<{ (e: 'rerun'): void; (e: 'reset'): void }>();

const settings = copilotFeedSettings;
</script>

<style scoped>
.settings-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.settings-content__subtitle {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
  line-height: 1.5;
  margin: 0;
}

.settings-content__actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-top: 12px;
}

.settings-content__btn {
  justify-content: flex-start !important;
  text-transform: none !important;
  letter-spacing: 0.01em !important;
  color: var(--chain-primary, #5b8def) !important;
}

.settings-content__btn--muted {
  color: rgba(255, 255, 255, 0.5) !important;
}

.settings-content__disclaimer {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  text-align: center;
  margin: 0;
}
</style>
