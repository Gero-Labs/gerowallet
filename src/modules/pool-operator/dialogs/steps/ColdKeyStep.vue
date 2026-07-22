<template>
  <div class="wizard-step">
    <p class="text-body-2 grey--text mb-3">{{ $t('poolOperator.importColdKeyDescription') }}</p>
    <v-file-input
      v-model="file"
      :label="$t('poolOperator.coldKeyFile')"
      accept=".skey,.json"
      outlined dense prepend-icon="mdi-file-key"
      @change="onFile"
    />
    <div v-if="parsedType" class="mb-3">
      <v-chip small color="success" outlined>{{ parsedType }}</v-chip>
    </div>

    <template v-if="parsedType">
      <p v-if="prfSupported && !usePassword" class="text-body-2 grey--text">
        {{ $t('poolOperator.coldKeyPrfEncryptionHint') }}
      </p>
      <template v-if="!prfSupported || usePassword">
        <v-text-field
          v-model="password" :label="isNormalWallet ? $t('wallet.spendingPassword') : $t('poolOperator.coldKeyPassword')"
          type="password" outlined dense
          :hint="isNormalWallet ? $t('poolOperator.coldKeyEncryptionHint') : $t('poolOperator.coldKeyPasswordHint')"
          persistent-hint
        />
        <v-text-field
          v-if="!isNormalWallet" v-model="passwordConfirm" :label="$t('poolOperator.confirmPassword')"
          type="password" outlined dense class="mt-2"
          :error-messages="passwordConfirm && password !== passwordConfirm ? [$t('welcome.passwordsMustMatch')] : []"
        />
      </template>
    </template>

    <v-alert v-if="error" type="error" dense outlined class="mt-3">{{ error }}</v-alert>

    <div class="mt-4 d-flex flex-column" style="gap: 8px">
      <v-btn
        v-if="parsedType && prfSupported && !usePassword" color="primary" block :loading="importing" @click="doPassKey"
      >
        <v-icon left>mdi-fingerprint</v-icon>{{ $t('poolOperator.importWithPassKey') }}
      </v-btn>
      <v-btn
        v-if="parsedType && (!prfSupported || usePassword)" color="primary" block
        :disabled="!password || (!isNormalWallet && password !== passwordConfirm)" :loading="importing" @click="doPassword"
      >
        {{ $t('poolOperator.importAndEncrypt') }}
      </v-btn>
      <v-btn v-if="parsedType && prfSupported && !usePassword" text x-small color="grey" @click="usePassword = true">
        {{ $t('poolOperator.usePasswordInstead') }}
      </v-btn>
      <v-btn v-if="parsedType && prfSupported && usePassword" text x-small color="grey" @click="usePassword = false">
        {{ $t('poolOperator.usePassKeyInstead') }}
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import { WalletType } from '@/models/types';
import { useColdKeyImport } from '../../composables/useColdKeyImport';

const { t } = useTranslation();
const emit = defineEmits(['done', 'busy']);
const { parseColdKey, importWithPassKey, importWithPassword } = useColdKeyImport();

const file = ref<File | null>(null);
const parsedType = ref('');
const rawKeyBytes = ref<Uint8Array | null>(null);
const password = ref('');
const passwordConfirm = ref('');
const error = ref('');
const importing = ref(false);
const prfSupported = ref(false);
const usePassword = ref(false);

const isNormalWallet = computed(() => {
  const type = walletStore.loggedWallet?.type;
  return type === WalletType.Normal || type === WalletType.Google;
});

onMounted(async () => {
  try {
    const { isPrfSupported } = await import('@/shared/utils/webauthn-prf');
    prfSupported.value = await isPrfSupported();
  } catch {
    prfSupported.value = false;
  }
});

async function onFile() {
  parsedType.value = '';
  rawKeyBytes.value = null;
  error.value = '';
  usePassword.value = false;
  password.value = '';
  passwordConfirm.value = '';
  if (!file.value) return;
  try {
    const { type, rawKeyBytes: bytes } = parseColdKey(await file.value.text());
    parsedType.value = type;
    rawKeyBytes.value = bytes;
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : t('poolOperator.invalidColdKeyFile');
  }
}

async function doPassKey() {
  if (!rawKeyBytes.value) return;
  importing.value = true; emit('busy', true); error.value = '';
  try {
    const result = await importWithPassKey(rawKeyBytes.value);
    emit('done', result);
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : t('errors.unknownError');
  } finally {
    importing.value = false; emit('busy', false);
  }
}

async function doPassword() {
  if (!rawKeyBytes.value || !password.value) return;
  importing.value = true; emit('busy', true); error.value = '';
  try {
    const result = await importWithPassword(rawKeyBytes.value, password.value, isNormalWallet.value);
    emit('done', result);
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : t('errors.unknownError');
  } finally {
    importing.value = false; emit('busy', false);
  }
}
</script>
