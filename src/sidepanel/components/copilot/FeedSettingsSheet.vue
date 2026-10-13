<template>
  <!-- Wide (dashboard): centered dialog. Narrow (sidepanel): bottom sheet. -->
  <v-dialog
    v-if="$vuetify.display.mdAndUp"
    :model-value="modelValue"
    max-width="480"
    scrollable
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="settings-dialog">
      <div class="settings-dialog__head">
        <span class="settings-dialog__title">{{ $t('copilot.settings.title') }}</span>
        <v-btn icon size="small" class="white--text" @click="$emit('update:modelValue', false)">
          <v-icon size="small">mdi-close</v-icon>
        </v-btn>
      </div>
      <div class="settings-dialog__body">
        <FeedSettingsContent @rerun="onReRunSetup" @reset="settings.reset" />
      </div>
    </div>
  </v-dialog>

  <BottomSheet
    v-else
    :model-value="modelValue"
    :title="$t('copilot.settings.title')"
    height="80%"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <FeedSettingsContent @rerun="onReRunSetup" @reset="settings.reset" />
  </BottomSheet>
</template>

<script setup lang="ts">
import BottomSheet from '@/sidepanel/components/BottomSheet.vue';
import FeedSettingsContent from './FeedSettingsContent.vue';
import { copilotFeedSettings } from '@/sidepanel/composables/useCopilotFeedSettings';

defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>();

const settings = copilotFeedSettings;

function onReRunSetup() {
  // Flip onboarding off so FeedPage re-renders the wizard, then close the sheet.
  settings.resetOnboarding();
  emit('update:modelValue', false);
}
</script>

<style scoped lang="scss">
.settings-dialog {
  @include g-glass-overlay(false);
  border-radius: var(--g-r-sheet);
  border: 1px solid var(--g-hairline-2);
  display: flex;
  flex-direction: column;
  max-height: 80vh;
}

.settings-dialog__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--g-hairline-2);
}

.settings-dialog__title {
  font-size: 14px;
  font-weight: 700;
  color: var(--g-text-1);
}

.settings-dialog__body {
  padding: 16px;
  overflow-y: auto;
}
</style>
