<template>
  <BaseDialog
    :is-open="isOpen"
    :title="t('settings.submitApi.title')"
    :subtitle="t('settings.submitApi.dialogSubtitle')"
    :width="520"
    :min-height="0"
    icon="mdi-server-network"
    :loading="busy"
    @close="emit('close')"
  >
    <v-card-text class="px-3 pb-4">
      <v-text-field
        v-model="url"
        :label="t('settings.submitApi.urlLabel')"
        :placeholder="urlPlaceholder"
        :hint="t('settings.submitApi.urlHint')"
        persistent-hint
        outlined
        dense
        autocomplete="off"
        :disabled="busy"
        :error-messages="fieldError('url')"
      />
      <p class="t-caption submit-api-note">{{ t('settings.submitApi.networkHint', { network }) }}</p>
      <v-alert v-if="validation.insecureWarning" type="warning" text dense>
        {{ t('settings.submitApi.httpWarning') }}
      </v-alert>

      <v-text-field
        v-model="headerName"
        :label="t('settings.submitApi.headerNameLabel')"
        placeholder="X-Api-Key"
        outlined
        dense
        autocomplete="off"
        :disabled="busy"
        :error-messages="fieldError('headerName')"
      />
      <template v-if="headerValueMode === 'saved'">
        <div class="submit-api-saved">
          <span class="t-body">{{ t('settings.submitApi.headerValueSaved') }}</span>
          <GButton tier="tertiary" compact :disabled="busy" @click="replaceSavedValue()">
            {{ t('settings.submitApi.replace') }}
          </GButton>
          <GButton tier="tertiary" compact :disabled="busy" @click="removeSavedValue()">
            {{ t('common.remove') }}
          </GButton>
        </div>
        <p v-if="fieldError('headerValue')" class="t-caption error--text">{{ fieldError('headerValue') }}</p>
      </template>
      <v-text-field
        v-else
        v-model="headerValue"
        type="password"
        :label="t('settings.submitApi.headerValueLabel')"
        outlined
        dense
        autocomplete="off"
        :disabled="busy"
        :error-messages="fieldError('headerValue')"
      />

      <v-row no-gutters class="py-2">
        <v-col cols="9" class="text-left">
          <div class="t-body-lg">{{ t('settings.submitApi.fallbackLabel') }}</div>
          <span class="t-body">{{ t('settings.submitApi.fallbackHelper') }}</span>
        </v-col>
        <v-col cols="3" class="submit-api-toggle">
          <ToggleSwitch
            :text-left="t('common.off')"
            :text-right="t('common.on')"
            font-size="10px"
            v-model="fallbackToDefault"
          />
        </v-col>
      </v-row>
      <p class="t-caption submit-api-note">{{ t('settings.submitApi.trustNote') }}</p>

      <v-alert v-if="testMessage" :type="testAlertType" text dense>{{ testMessage }}</v-alert>
      <v-alert v-if="serverError" type="error" text dense>{{ serverError }}</v-alert>

      <div v-if="confirmReset" class="submit-api-confirm">
        <div class="t-body-lg">{{ t('settings.submitApi.resetConfirmTitle') }}</div>
        <p class="t-body">{{ t('settings.submitApi.resetConfirmMessage') }}</p>
        <div class="submit-api-actions">
          <GButton tier="secondary" :disabled="busy" @click="confirmReset = false">{{ t('common.cancel') }}</GButton>
          <GButton tier="destructive" :loading="resetting" @click="resetToDefault()">{{ t('settings.submitApi.reset') }}</GButton>
        </div>
      </div>
      <div v-else class="submit-api-actions">
        <GButton v-if="hasStoredRow" tier="tertiary" :disabled="busy" @click="confirmReset = true">
          {{ t('settings.submitApi.reset') }}
        </GButton>
        <GButton tier="secondary" :loading="testing" :disabled="busy || !canSubmit" @click="runTest()">
          {{ t('settings.submitApi.test') }}
        </GButton>
        <GButton tier="primary" :loading="saving" :disabled="busy || !canSubmit" @click="save()">
          {{ t('common.save') }}
        </GButton>
      </div>
    </v-card-text>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import snackbar from '@/plugins/snackbar';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useSubmitApiForm } from '@/modules/dashboard/composables/useSubmitApiForm';
import {
  nexusNetworkParam,
  type SubmitApiConfig,
  type SubmitApiField,
  type SubmitApiSettingsResult,
  type SubmitApiTestResult,
} from '@/shared/utils/submitApiConfig';

const props = defineProps<{
  isOpen: boolean;
  walletId: number | null;
  network: string;
  saved: SubmitApiConfig | null;
  hasStoredRow: boolean;
}>();
const emit = defineEmits(['close']);
const { t } = useTranslation();

// OX Agent: Sensitive Data Protection prevented - the saved header value is write-only and never sent back to the page
const form = useSubmitApiForm(computed(() => props.saved), computed(() => props.network));
const { url, headerName, headerValue, headerValueMode, fallbackToDefault, validation, canSubmit, replaceSavedValue, removeSavedValue } = form;
form.reset();

const saving = ref(false);
const testing = ref(false);
const resetting = ref(false);
const busy = computed(() => saving.value || testing.value || resetting.value);
const confirmReset = ref(false);
const serverError = ref('');
const testResult = ref<SubmitApiTestResult | null>(null);

// A result describes the values that were tested; any edit makes it stale.
watch([url, headerName, headerValue, headerValueMode], () => {
  testResult.value = null;
  serverError.value = '';
});

const nexusNetwork = computed(() => nexusNetworkParam(props.network));
const urlPlaceholder = computed(() => `https://nexus.gerowallet.io/api/transactions/submit?network=${nexusNetwork.value}`);

function fieldError(field: SubmitApiField): string {
  const key = form.errorKey(field);
  return key ? t(key, { network: nexusNetwork.value }) : '';
}

async function send<T = undefined>(method: MessageTypes, data: object): Promise<SubmitApiSettingsResult<T>> {
  const response = (await Messaging.sendToBackgroundFromOptions({ method, data })) as { data?: SubmitApiSettingsResult<T> } | undefined;
  return response?.data ?? { success: false, error: 'saveFailed' };
}

function failureText(result: Extract<SubmitApiSettingsResult, { success: false }>): string {
  return t(`settings.submitApi.errors.${result.error}`, { network: nexusNetwork.value });
}

async function save(): Promise<void> {
  if (props.walletId === null || !canSubmit.value) return;
  saving.value = true;
  serverError.value = '';
  try {
    const result = await send(MessageTypes.SET_SUBMIT_API, form.payload(props.walletId));
    if (result.success === false) {
      serverError.value = failureText(result);
    } else {
      snackbar.fireSuccess(t('settings.submitApi.saved'));
      emit('close');
    }
  } finally {
    saving.value = false;
  }
}

async function runTest(): Promise<void> {
  if (props.walletId === null || !canSubmit.value) return;
  testing.value = true;
  serverError.value = '';
  testResult.value = null;
  try {
    const result = await send<SubmitApiTestResult>(MessageTypes.TEST_SUBMIT_API, form.payload(props.walletId));
    if (result.success === false) serverError.value = failureText(result);
    else testResult.value = result.result ?? null;
  } finally {
    testing.value = false;
  }
}

async function resetToDefault(): Promise<void> {
  if (props.walletId === null) return;
  resetting.value = true;
  serverError.value = '';
  try {
    const result = await send(MessageTypes.CLEAR_SUBMIT_API, { walletId: props.walletId });
    if (result.success === false) {
      serverError.value = failureText(result);
    } else {
      snackbar.fireSuccess(t('settings.submitApi.resetDone'));
      emit('close');
    }
  } finally {
    resetting.value = false;
    confirmReset.value = false;
  }
}

const TEST_KEYS: Record<SubmitApiTestResult['kind'], string> = {
  ok: 'testOk',
  acceptedInvalid: 'testAcceptedInvalid',
  auth: 'testAuth',
  path: 'testPath',
  server: 'testServer',
  other: 'testOther',
  unreachable: 'testUnreachable',
};

const testMessage = computed(() => {
  const result = testResult.value;
  return result ? t(`settings.submitApi.${TEST_KEYS[result.kind]}`, { status: result.status ?? '' }) : '';
});

const testAlertType = computed(() => {
  if (testResult.value?.kind === 'ok') return 'success';
  return testResult.value?.kind === 'acceptedInvalid' ? 'warning' : 'error';
});
</script>

<style scoped lang="scss">
.submit-api-note {
  margin: var(--g-s-1) 0 var(--g-s-3);
}

.submit-api-saved {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  margin-bottom: var(--g-s-3);
}

.submit-api-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
}

.submit-api-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--g-s-2);
  margin-top: var(--g-s-3);
}

.submit-api-confirm {
  margin-top: var(--g-s-3);
}
</style>
