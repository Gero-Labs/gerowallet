<template>
  <!-- Wide (dashboard): centered dialog. Narrow (sidepanel): bottom sheet. -->
  <v-dialog
    v-if="$vuetify.breakpoint.mdAndUp"
    :value="value"
    max-width="480"
    scrollable
    @input="$emit('input', $event)"
  >
    <div class="settings-dialog">
      <div class="settings-dialog__head">
        <span class="settings-dialog__title">{{ $t('copilot.settings.title') }}</span>
        <v-btn icon small class="white--text" @click="$emit('input', false)">
          <v-icon small>mdi-close</v-icon>
        </v-btn>
      </div>
      <div class="settings-dialog__body">
        <FeedSettingsContent @rerun="onReRunSetup" @reset="settings.reset" />
      </div>
    </div>
  </v-dialog>

  <BottomSheet
    v-else
    :value="value"
    :title="$t('copilot.settings.title')"
    height="80%"
    @input="$emit('input', $event)"
  >
    <FeedSettingsContent @rerun="onReRunSetup" @reset="settings.reset" />
  </BottomSheet>
</template>

<script setup lang="ts">
import BottomSheet from '@/sidepanel/components/BottomSheet.vue';
import FeedSettingsContent from './FeedSettingsContent.vue';
import { copilotFeedSettings } from '@/sidepanel/composables/useCopilotFeedSettings';

defineProps<{ value: boolean }>();
const emit = defineEmits<{ (e: 'input', v: boolean): void }>();

const settings = copilotFeedSettings;

function onReRunSetup() {
  // Flip onboarding off so FeedPage re-renders the wizard, then close the sheet.
  settings.resetOnboarding();
  emit('input', false);
}
</script>

<style scoped>
.settings-dialog {
  background: var(--g-overlay);
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
