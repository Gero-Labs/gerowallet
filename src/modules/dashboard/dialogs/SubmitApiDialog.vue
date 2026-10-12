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
    <!-- pt-4: Vuetify zeroes padding-top on card text after a title, which hid the top
         of the first outlined field's floating label under the header. -->
    <v-card-text class="px-3 pt-4 pb-4">
      <v-select
        :value="provider"
        :items="providerItems"
        item-value="id"
        item-text="label"
        :label="t('settings.submitApi.providerLabel')"
        outlined
        dense
        attach
        hide-details
        class="mb-5"
        :disabled="busy"
        @change="selectProvider"
      >
        <template #selection="{ item }">
          <span class="submit-api-provider">
            <img v-if="item.logo" :src="item.logo" alt="" class="submit-api-provider-logo">
            <v-icon v-else small class="submit-api-provider-logo">mdi-server</v-icon>
            {{ item.label }}
          </span>
        </template>
        <template #item="{ item }">
          <span class="submit-api-provider">
            <img v-if="item.logo" :src="item.logo" alt="" class="submit-api-provider-logo">
            <v-icon v-else small class="submit-api-provider-logo">mdi-server</v-icon>
            {{ item.label }}
          </span>
        </template>
      </v-select>
      <!-- Default (Gero) keeps this same layout with the fields disabled, so switching
           provider never resizes the dialog. Saving Default deletes any saved endpoint. -->
      <v-text-field
        v-model="url"
        :label="t('settings.submitApi.urlLabel')"
        :placeholder="urlPlaceholder"
        :hint="t('settings.submitApi.urlHint')"
        persistent-hint
        outlined
        dense
        autocomplete="off"
        :disabled="fieldsDisabled"
        :error-messages="fieldError('url')"
      />
      <p class="t-caption submit-api-note">{{ t('settings.submitApi.networkHint', { network }) }}</p>
      <p class="t-caption submit-api-note">{{ t('settings.submitApi.urlKeyHint') }}</p>
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
        :disabled="fieldsDisabled"
        :error-messages="fieldError('headerName')"
      />
      <template v-if="headerValueMode === 'saved'">
        <div class="submit-api-saved">
          <span class="t-body">{{ t('settings.submitApi.headerValueSaved') }}</span>
          <GButton tier="tertiary" compact :disabled="fieldsDisabled" @click="replaceSavedValue()">
            {{ t('settings.submitApi.replace') }}
          </GButton>
          <GButton tier="tertiary" compact :disabled="fieldsDisabled" @click="removeSavedValue()">
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
        :disabled="fieldsDisabled"
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
            :disabled="fieldsDisabled"
            v-model="fallbackToDefault"
          />
        </v-col>
      </v-row>
      <!-- One slot for every note, so picking Default (Gero) does not resize the dialog either. -->
      <p class="t-caption submit-api-note">{{ t(noteKey) }}</p>

      <v-alert v-if="testMessage" :type="testAlertType" text dense>{{ testMessage }}</v-alert>
      <v-alert v-if="serverError" type="error" text dense>{{ serverError }}</v-alert>

      <div class="submit-api-actions">
        <GButton tier="secondary" :loading="testing" :disabled="busy || isDefault || !canSubmit" @click="runTest()">
          {{ t('settings.submitApi.test') }}
        </GButton>
        <GButton tier="primary" :loading="saving || resetting" :disabled="busy || !canSave" @click="save()">
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
import assets from '@/utils/assets';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useSubmitApiForm } from '@/modules/dashboard/composables/useSubmitApiForm';
import {
  nexusNetworkParam,
  submitApiProvider,
  type SubmitApiConfig,
  type SubmitApiProvider,
  type SubmitApiProviderChoice,
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
const {
  url, headerName, headerValue, headerValueMode, fallbackToDefault, provider, validation, canSubmit,
  replaceSavedValue, removeSavedValue, selectProvider,
} = form;
form.reset();

const saving = ref(false);
const testing = ref(false);
const resetting = ref(false);
const busy = computed(() => saving.value || testing.value || resetting.value);
const serverError = ref('');
const testResult = ref<SubmitApiTestResult | null>(null);

// A result describes the values that were tested; any edit makes it stale.
watch([url, headerName, headerValue, headerValueMode], () => {
  testResult.value = null;
  serverError.value = '';
});

const nexusNetwork = computed(() => nexusNetworkParam(props.network));
// `network` is the Nexus query value (errors.nexusNetwork); `walletNetwork` the display name.
const errorParams = computed(() => ({ network: nexusNetwork.value, walletNetwork: props.network }));
const urlPlaceholder = computed(() => (provider.value === 'custom'
  ? 'https://your-node.example/api/submit/tx'
  : `https://nexus.gerowallet.io/api/transactions/submit?network=${nexusNetwork.value}`));

// Provider names are brands and stay untranslated.
const providerItems = computed<{ id: SubmitApiProviderChoice; label: string; logo: string | null }[]>(() => [
  { id: 'default', label: t('settings.submitApi.providerDefault'), logo: assets.geroNoText },
  { id: 'nexus', label: 'Nexus', logo: assets.nexusLogo },
  { id: 'blockfrost', label: 'Blockfrost', logo: assets.blockfrostLogo },
  { id: 'koios', label: 'Koios', logo: assets.koiosLogo },
  { id: 'custom', label: t('settings.submitApi.statusCustom'), logo: null },
]);

function fieldError(field: SubmitApiField): string {
  const key = form.errorKey(field);
  return key ? t(key, errorParams.value) : '';
}

async function send<T = undefined>(
  method: MessageTypes,
  data: object,
  failure: 'saveFailed' | 'testFailed' = 'saveFailed',
): Promise<SubmitApiSettingsResult<T>> {
  const response = (await Messaging.sendToBackgroundFromOptions({ method, data })) as { data?: SubmitApiSettingsResult<T> } | undefined;
  return response?.data ?? { success: false, error: failure };
}

function failureText(result: Extract<SubmitApiSettingsResult, { success: false }>): string {
  return t(`settings.submitApi.errors.${result.error}`, errorParams.value);
}

// Default (Gero) with a saved endpoint: Save deletes it. Nothing saved: nothing to save.
const isDefault = computed(() => provider.value === 'default');
const canSave = computed(() => (isDefault.value ? props.hasStoredRow : canSubmit.value));
const fieldsDisabled = computed(() => busy.value || isDefault.value);
// Default (Gero) has no endpoint to warn about: say what saving does, or that Gero submits.
const noteKey = computed(() => {
  if (!isDefault.value) return 'settings.submitApi.trustNote';
  return props.hasStoredRow ? 'settings.submitApi.defaultNote' : 'settings.submitApi.defaultActiveNote';
});

async function save(): Promise<void> {
  if (isDefault.value) {
    if (props.hasStoredRow) await resetToDefault();
    return;
  }
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
    const result = await send<SubmitApiTestResult>(MessageTypes.TEST_SUBMIT_API, form.payload(props.walletId), 'testFailed');
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

// Provider-specific advice on an auth failure; anything else gets the generic message.
const AUTH_KEYS: Partial<Record<SubmitApiProvider, string>> = {
  nexus: 'testAuthNexus',
  blockfrost: 'testAuthBlockfrost',
};

function testKey(kind: SubmitApiTestResult['kind']): string {
  const provider = kind === 'auth' ? submitApiProvider(url.value) : null;
  return (provider && AUTH_KEYS[provider]) || TEST_KEYS[kind];
}

const testMessage = computed(() => {
  const result = testResult.value;
  return result ? t(`settings.submitApi.${testKey(result.kind)}`, { status: result.status ?? '' }) : '';
});

const testAlertType = computed(() => {
  if (testResult.value?.kind === 'ok') return 'success';
  return testResult.value?.kind === 'acceptedInvalid' ? 'warning' : 'error';
});
</script>

<style scoped lang="scss">
.submit-api-provider {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-2);
}

.submit-api-provider-logo {
  width: 20px;
  height: 20px;
  object-fit: contain;
}

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

</style>
