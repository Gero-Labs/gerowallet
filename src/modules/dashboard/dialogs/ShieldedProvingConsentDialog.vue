<template>
  <div class="shielded-consent-root">
    <BaseDialog
      :isOpen="isOpen"
      @close="onCancel"
      :title="t('midnight.consent.title')"
      :subtitle="t('midnight.consent.subtitle')"
      :loading="submitting"
      :min-height="0"
      :persistent="true"
      :img="assets.sendSvg"
      :width="480"
      imgStyle="filter: brightness(0) saturate(100%) invert(100%) sepia(49%) saturate(2%) hue-rotate(47deg) brightness(118%) contrast(101%);"
    >
      <v-card-text class="px-3 pb-3 shielded-consent-content">
        <p class="body-2 mb-3">{{ t('midnight.consent.intro') }}</p>

        <div class="consent-section mb-3">
          <div class="consent-section-label">{{ t('midnight.consent.whatGeroSees') }}</div>
          <p class="body-2 mb-0">{{ t('midnight.consent.whatGeroSeesBody') }}</p>
        </div>

        <div class="consent-section mb-3">
          <div class="consent-section-label">{{ t('midnight.consent.whatWeDoNot') }}</div>
          <p class="body-2 mb-0">{{ t('midnight.consent.whatWeDoNotBody') }}</p>
        </div>

        <div class="consent-section consent-section-muted mb-4">
          <div class="consent-section-label">{{ t('midnight.consent.localOption') }}</div>
          <p class="body-2 mb-0">{{ t('midnight.consent.localOptionBody') }}</p>
        </div>

        <v-checkbox
          v-model="acknowledged"
          :disabled="submitting"
          color="#00c7f3"
          hide-details
          class="mt-0 mb-3 consent-checkbox"
        >
          <template v-slot:label>
            <span class="body-2">{{ t('midnight.consent.acknowledge') }}</span>
          </template>
        </v-checkbox>

        <v-btn
          color="#00c7f3"
          class="black--text mb-2"
          block
          :disabled="!acknowledged || submitting"
          :loading="submitting"
          @click="onAccept"
        >
          {{ t('midnight.consent.acceptCloud') }}
        </v-btn>

        <v-btn
          outlined
          block
          :disabled="submitting"
          class="mb-2"
          @click="onCancel"
        >
          {{ t('midnight.consent.cancel') }}
        </v-btn>

        <div v-if="errorMessage" class="red--text text--lighten-2 text-caption mt-2">
          {{ errorMessage }}
        </div>
      </v-card-text>
    </BaseDialog>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import assets from '@/utils/assets';

interface Props {
  isOpen: boolean;
}
const props = defineProps<Props>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'accepted'): void;
}>();

const { t } = useTranslation();

const acknowledged = ref(false);
const submitting = ref(false);
const errorMessage = ref<string | null>(null);

// Reset checkbox + error state every time the dialog opens. Without this, a
// cancel-then-reopen flow would keep the previous "accepted" checkbox state
// — surprising for the user since the privacy posture is intentionally
// per-decision rather than a sticky setting.
watch(
  () => props.isOpen,
  (next) => {
    if (next) {
      acknowledged.value = false;
      errorMessage.value = null;
      submitting.value = false;
    }
  },
);

async function onAccept() {
  if (!acknowledged.value || submitting.value) return;
  submitting.value = true;
  errorMessage.value = null;
  try {
    // Route through BG so every browser context (popup, options, sidepanel)
    // picks up the consent via midnightStore's broadcast — accepting in
    // options shouldn't leave the popup's send dialog still gated.
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.ACCEPT_MIDNIGHT_SHIELDED_PROVING_CONSENT,
      data: {},
    }) as { data: { success: boolean; error?: string } };
    if (!response?.data?.success) {
      throw new Error(response?.data?.error || 'Failed to record consent');
    }
    emit('accepted');
    emit('close');
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : String(e);
  } finally {
    submitting.value = false;
  }
}

function onCancel() {
  if (submitting.value) return;
  emit('close');
}
</script>

<style scoped>
.shielded-consent-content {
  background: transparent;
}
.consent-section {
  background: linear-gradient(135deg, rgba(0, 199, 243, 0.05) 0%, rgba(255, 216, 110, 0.04) 100%);
  border: 1px solid rgba(0, 199, 243, 0.18);
  border-radius: 10px;
  padding: 12px 14px;
}
.consent-section-muted {
  background: rgba(255, 255, 255, 0.03);
  border: 1px dashed rgba(255, 255, 255, 0.15);
}
.consent-section-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.55);
  margin-bottom: 4px;
}
.consent-checkbox :deep(.v-label) {
  align-items: flex-start;
  line-height: 1.4;
}
</style>
