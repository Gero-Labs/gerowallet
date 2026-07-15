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
          <div class="consent-section-label">{{ whatSeesLabel }}</div>
          <p class="body-2 mb-0">{{ whatSeesBody }}</p>
        </div>

        <div class="consent-section mb-3">
          <div class="consent-section-label">{{ whatWeDoNotLabel }}</div>
          <p class="body-2 mb-0">{{ whatWeDoNotBody }}</p>
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
            <span class="body-2">{{ acknowledgeLabel }}</span>
          </template>
        </v-checkbox>

        <v-btn
          color="#00c7f3"
          class="black--text mb-2"
          block
          :disabled="!acknowledged || submitting || switchingToLocal"
          :loading="submitting"
          @click="onAccept"
        >
          {{ acceptLabel }}
        </v-btn>

        <v-btn
          outlined
          block
          :disabled="submitting || switchingToLocal"
          :loading="switchingToLocal"
          class="mb-2"
          @click="onUseLocalInstead"
        >
          {{ t('midnight.consent.useLocalInstead') }}
        </v-btn>

        <v-btn
          text
          block
          :disabled="submitting || switchingToLocal"
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
import { ref, computed, watch } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { midnightStore } from '@/stores/midnightStore';
import { settingsNavRequest } from '@/shared/composables/useGlobalSearch';
import assets from '@/utils/assets';

interface Props {
  isOpen: boolean;
  /**
   * Which remote prover this consent is about. Both record the SAME
   * device-level consent (it covers remote proving generally) but the copy
   * must name the actual destination of the witness data: `cloud` = Gero
   * Cloud (default, unchanged behavior), `zkpaas` = the Arkhia zkPaaS
   * service — Gero never receives the witness on that path.
   */
  provider?: 'cloud' | 'zkpaas';
}
const props = withDefaults(defineProps<Props>(), { provider: 'cloud' });
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'accepted'): void;
}>();

const { t } = useTranslation();

const isZkpaas = computed(() => props.provider === 'zkpaas');
const whatSeesLabel = computed(() => (isZkpaas.value
  ? t('midnight.consent.zkpaasWhatSees') : t('midnight.consent.whatGeroSees')));
const whatSeesBody = computed(() => (isZkpaas.value
  ? t('midnight.consent.zkpaasWhatSeesBody') : t('midnight.consent.whatGeroSeesBody')));
const whatWeDoNotLabel = computed(() => (isZkpaas.value
  ? t('midnight.consent.zkpaasWhatThisMeans') : t('midnight.consent.whatWeDoNot')));
const whatWeDoNotBody = computed(() => (isZkpaas.value
  ? t('midnight.consent.zkpaasWhatThisMeansBody') : t('midnight.consent.whatWeDoNotBody')));
const acknowledgeLabel = computed(() => (isZkpaas.value
  ? t('midnight.consent.zkpaasAcknowledge') : t('midnight.consent.acknowledge')));
const acceptLabel = computed(() => (isZkpaas.value
  ? t('midnight.consent.zkpaasAccept') : t('midnight.consent.acceptCloud')));

const acknowledged = ref(false);
const submitting = ref(false);
const switchingToLocal = ref(false);
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
      switchingToLocal.value = false;
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
  if (submitting.value || switchingToLocal.value) return;
  emit('close');
}

/**
 * "Use a local proof server instead" — switches the persisted preference to
 * local (WP-P1's setter, via the same BG round-trip the Settings radio group
 * uses, see AdvancedSettingsTab.vue) and sends the user to Settings to finish
 * setup. Deliberately does NOT emit 'accepted': no cloud consent is recorded
 * (local proving never sends witness data off the machine, so the cloud
 * consent this dialog gates doesn't apply), and the pending send is dropped
 * rather than resumed — the parent's onConsentClose clears the credentials it
 * was holding. The user re-submits once the local proof server is running.
 */
async function onUseLocalInstead() {
  if (submitting.value || switchingToLocal.value) return;
  switchingToLocal.value = true;
  errorMessage.value = null;
  try {
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SET_MIDNIGHT_PROOF_SERVER,
      data: { mode: 'local', localUrl: midnightStore.proofServer.localUrl },
    }) as { data: { success: boolean; error?: string } };
    if (!response?.data?.success) {
      throw new Error(response?.data?.error || 'Failed to switch to local proof server');
    }
    settingsNavRequest.value = { tab: 'advanced' };
    emit('close');
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : String(e);
  } finally {
    switchingToLocal.value = false;
  }
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
