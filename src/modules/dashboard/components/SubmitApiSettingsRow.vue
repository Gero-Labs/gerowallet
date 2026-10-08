<template>
  <v-row v-if="visible" no-gutters class="py-2">
    <v-col cols="9" class="text-left">
      <h3 class="t-body-lg">
        {{ t('settings.submitApi.title') }}
        <v-icon v-if="isNew" color="error" x-small class="ml-1">mdi-circle</v-icon>
      </h3>
      <span class="t-body">{{ t('settings.submitApi.helper') }}</span>
      <p v-if="lastResultText" class="t-caption mb-0 mt-1">{{ lastResultText }}</p>
    </v-col>
    <v-col cols="3" class="submit-api-row-actions">
      <span class="t-caption">{{ statusText }}</span>
      <GButton tier="secondary" compact block @click="openDialog()">
        {{ t('settings.submitApi.configure') }}
      </GButton>
    </v-col>
    <SubmitApiDialog
      v-if="dialogOpen"
      :is-open="dialogOpen"
      :wallet-id="walletId"
      :network="network"
      :saved="savedConfig"
      :has-stored-row="storedRow !== null"
      @close="dialogOpen = false"
    />
  </v-row>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRefs, watch } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import SubmitApiDialog from '@/modules/dashboard/dialogs/SubmitApiDialog.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { isFeatureNew, markFeatureAsSeen } from '@/shared/composables/useFeatureNotifications';
import { walletStore } from '@/stores/walletStore';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import {
  SUBMIT_API_CONFIG_KEY,
  submitApiLastResultKey,
  validateStoredSubmitApiConfig,
  type SubmitApiLastResult,
} from '@/shared/utils/submitApiConfig';

const FEATURE_ID = 'settings.advanced.submitApi';

const { t } = useTranslation();
const { loggedWallet, config } = toRefs(walletStore);

const walletId = computed<number | null>(() => loggedWallet.value?.id ?? null);
const network = computed<string>(() => loggedWallet.value?.network ?? '');
const storedRow = computed<unknown>(() => config.value?.[SUBMIT_API_CONFIG_KEY] ?? null);
const savedConfig = computed(() => validateStoredSubmitApiConfig(storedRow.value, network.value));
// Flag on, OR a setting already saved: a user can always see and clear what routes their txs.
const visible = computed(() => featureFlagsStore.isSubmitApiEnabled() || storedRow.value !== null);
const isNew = computed(() => isFeatureNew(FEATURE_ID));

const statusText = computed(() => {
  if (storedRow.value === null) return t('settings.submitApi.statusDefault');
  return savedConfig.value ? t('settings.submitApi.statusCustom') : t('settings.submitApi.statusInvalid');
});

const dialogOpen = ref(false);
function openDialog(): void {
  markFeatureAsSeen(FEATURE_ID);
  dialogOpen.value = true;
}

const lastResult = ref<SubmitApiLastResult | null>(null);

async function loadLastResult(): Promise<void> {
  lastResult.value = null;
  if (walletId.value === null || typeof chrome === 'undefined' || !chrome.storage?.session) return;
  const key = submitApiLastResultKey(walletId.value);
  try {
    const stored = await chrome.storage.session.get(key);
    lastResult.value = (stored[key] as SubmitApiLastResult | undefined) ?? null;
  } catch {
    lastResult.value = null;
  }
}

function onStorageChanged(changes: Record<string, chrome.storage.StorageChange>, areaName: string): void {
  if (areaName !== 'session' || walletId.value === null) return;
  const change = changes[submitApiLastResultKey(walletId.value)];
  if (change) lastResult.value = (change.newValue as SubmitApiLastResult | undefined) ?? null;
}

// A wallet switch must never leave the dialog editing the previous wallet's setting.
watch(walletId, () => {
  dialogOpen.value = false;
  void loadLastResult();
});

onMounted(() => {
  void loadLastResult();
  if (typeof chrome !== 'undefined') chrome.storage?.onChanged?.addListener(onStorageChanged);
});

onBeforeUnmount(() => {
  if (typeof chrome !== 'undefined') chrome.storage?.onChanged?.removeListener(onStorageChanged);
});

const lastResultText = computed(() => {
  const result = lastResult.value;
  if (!result || storedRow.value === null) return '';
  const time = new Date(result.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (!result.error) return t('settings.submitApi.lastSubmitCustom', { time });
  const reason = t(`settings.submitApi.reasons.${result.error.code}`, { status: result.error.status ?? '' });
  return result.via === 'default'
    ? t('settings.submitApi.lastSubmitFallback', { time, reason })
    : t('settings.submitApi.lastSubmitFailed', { time, reason });
});
</script>

<style scoped lang="scss">
.submit-api-row-actions {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--g-s-1);
  text-align: center;
}
</style>
