<template>
  <v-overlay v-show="shouldShow" opacity="0.92" class="session-lock-overlay">
    <v-card outlined class="password-confirm-dialog">
      <div class="modal-header">
        <div class="content">
          <div class="icon-section">
            <div class="featured-icon">
              <v-icon class="lock-icon">mdi-lock</v-icon>
            </div>
          </div>

          <div class="text-section">
            <h3 class="modal-title">{{ t('session.lockedTitle') }}</h3>
            <p class="modal-subtitle">
              {{ t('session.lockedDescription') }}
            </p>
          </div>
        </div>
      </div>

      <div class="modal-actions">
        <div class="actions-content">
          <div class="password-section" v-if="requiresPassword">
            <label class="input-label">{{ t('wallet.spendingPassword') }}</label>
            <v-text-field
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              dense
              outlined
              class="password-input"
              hide-details
              placeholder="**********"
              :disabled="loading"
              @keydown.enter.prevent="unlock"
            >
              <template #append>
                <v-icon @click="togglePassword" tabindex="-1">
                  {{ showPassword ? 'mdi-eye-off' : 'mdi-eye' }}
                </v-icon>
              </template>
            </v-text-field>
          </div>

          <v-alert v-if="errorMessage" dense type="error" class="mt-3">
            {{ errorMessage }}
          </v-alert>

          <div class="buttons-section">
            <GradientButton
              :text="t('session.unlockButton')"
              :loading="loading"
              :disabled="isUnlockDisabled"
              @click="unlock"
            />
          </div>
        </div>
      </div>
    </v-card>
  </v-overlay>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import SessionStore from '@/stores/sessionStore';
import { walletStore } from '@/stores/walletStore';
import { WalletType } from '@/models/types';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import GradientButton from '@/modules/wallet/components/GradientButton.vue';

const { t } = useTranslation();

const password = ref('');
const loading = ref(false);
const errorMessage = ref('');
const showPassword = ref(false);
let keepAlivePort: chrome.runtime.Port | null = null;

const loggedWallet = computed(() => walletStore.loggedWallet);
const shouldShow = computed(() => !!loggedWallet.value && !SessionStore.state.isUnlocked);
const requiresPassword = computed(() => loggedWallet.value?.type === WalletType.Normal);
const isUnlockDisabled = computed(() => loading.value || (requiresPassword.value && password.value.length === 0));

const togglePassword = () => {
  showPassword.value = !showPassword.value;
};

const resetFields = () => {
  closeKeepAlivePort();
  password.value = '';
  errorMessage.value = '';
  showPassword.value = false;
  loading.value = false;
};

const openKeepAlivePort = () => {
  if (keepAlivePort || !chrome?.runtime?.connect) {
    return;
  }
  try {
    keepAlivePort = chrome.runtime.connect({ name: 'session-unlock' });
    keepAlivePort.onDisconnect.addListener(() => {
      keepAlivePort = null;
    });
  } catch (error) {
    keepAlivePort = null;
  }
};

const closeKeepAlivePort = () => {
  if (!keepAlivePort) {
    return;
  }
  try {
    keepAlivePort.disconnect();
  } catch (error) {
    /* no-op */
  } finally {
    keepAlivePort = null;
  }
};

watch(shouldShow, value => {
  if (!value) {
    resetFields();
  }
});

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const wakeBackground = async () => {
  await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.SESSION_ACTIVITY,
    data: { keepAlive: true },
  }).catch(() => undefined);
};

const verifyPassword = async () => {
  if (!requiresPassword.value) {
    return true;
  }

  try {
    const verification = (await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.VERIFY_SPENDING_PASSWORD,
      data: { password: password.value },
    })) as { data: { isValid: boolean; error?: string } };
    if (verification?.data?.isValid) {
      return true;
    }

    errorMessage.value = t('navigation.invalidPassword');
    loading.value = false;
    closeKeepAlivePort();
    return false;
  } catch (error: any) {
    errorMessage.value = error?.message || t('navigation.invalidPassword');
    loading.value = false;
    closeKeepAlivePort();
    return false;
  }
};

const unlock = async () => {
  if (isUnlockDisabled.value) {
    return;
  }
  loading.value = true;
  errorMessage.value = '';

  const MAX_ATTEMPTS = 3;
  openKeepAlivePort();

  const isPasswordValid = await verifyPassword();
  if (!isPasswordValid) {
    return;
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      if (attempt > 0) {
        await delay(150 * attempt);
      }
      await wakeBackground();

      const response: any = (await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.VERIFY_SPENDING_PASSWORD,
        data: { password: password.value },
      })) as { data: { isValid: boolean; error?: string } };

      if (response?.data?.isValid) {
        SessionStore.setUnlocked(true, null);
        resetFields();
        loading.value = false;
        closeKeepAlivePort();
        return;
      }

      if (SessionStore.state.isUnlocked) {
        resetFields();
        loading.value = false;
        closeKeepAlivePort();
        return;
      }

      const responseError: string | undefined = response?.error || response?.data?.error || response?.data?.errorCode;

      if (typeof responseError === 'string' && responseError.includes('message port closed')) {
        continue;
      }

      if (response?.data?.errorCode === 'INVALID_SPENDING_PASSWORD') {
        errorMessage.value = t('navigation.invalidPassword');
      } else if (responseError) {
        errorMessage.value = responseError;
      } else {
        errorMessage.value = t('navigation.invalidPassword');
      }
      loading.value = false;
      closeKeepAlivePort();
      return;
    } catch (error: any) {
      const message = error?.message || String(error);
      if (message.includes('The message port closed before a response was received.') && attempt < MAX_ATTEMPTS - 1) {
        continue;
      }

      if (SessionStore.state.isUnlocked) {
        resetFields();
        loading.value = false;
        closeKeepAlivePort();
        return;
      }

      errorMessage.value = message || t('navigation.invalidPassword');
      loading.value = false;
      closeKeepAlivePort();
      return;
    }
  }

  if (SessionStore.state.isUnlocked) {
    resetFields();
    loading.value = false;
    closeKeepAlivePort();
    return;
  }

  errorMessage.value = t('navigation.invalidPassword');
  loading.value = false;
  closeKeepAlivePort();
};
</script>

<style scoped lang="scss">
@import '@/modules/wallet/styles/_variables.scss';
@import '@/modules/wallet/styles/_mixins.scss';

.session-lock-overlay {
  display: flex;
  align-items: center;
  justify-content: center;
}

.password-confirm-dialog {
  background: $background-dark !important;
  border-radius: $border-radius-lg !important;
  overflow: hidden;
  width: 100%;
  max-width: 400px;
  box-shadow: $shadow-md;
}

.modal-header {
  position: relative;
  @include flex-column;
  align-items: center;
  width: 100%;
}

.content {
  @include flex-column;
  gap: $spacing-sm;
  padding: $spacing-xl $spacing-xl 0;
  width: 100%;
}

.icon-section {
  display: flex;
  justify-content: center;
}

.featured-icon {
  width: 48px;
  height: 48px;
  background: #00c7f3;
  border-radius: 50%;
  @include flex-center;
}

.lock-icon {
  color: #ffffff;
  font-size: $font-size-xl;
}

.text-section {
  @include flex-column;
  gap: $spacing-xs;
  text-align: center;
}

.modal-title {
  @include heading-style($font-size-lg);
}

.modal-subtitle {
  @include body-text($font-size-sm);
  color: $text-muted;
  margin: 0;
}

.modal-actions {
  padding: $spacing-sm 0 $spacing-xl;
  width: 100%;
}

.actions-content {
  @include flex-column;
  gap: $spacing-sm;
  padding: 0 $spacing-xl;
}

.password-section {
  @include flex-column;
  gap: $spacing-xs;
}

.input-label {
  @include body-text($font-size-sm);
  font-weight: $font-weight-medium;
  color: $text-secondary;
  margin: 0;
}

.password-input {
  :deep(.v-input__control) {
    background: $background-dark !important;
    border: 1px solid $border-primary !important;
    border-radius: $border-radius-md !important;
  }

  :deep(.v-input__slot) {
    background: transparent !important;
    box-shadow: none !important;
  }

  :deep(.v-label) {
    color: $text-secondary !important;
    font-weight: $font-weight-medium;
    font-size: $font-size-sm;
  }

  :deep(.v-text-field__details) {
    display: none;
  }

  :deep(input) {
    color: $text-primary !important;
    font-size: $font-size-base;
  }
}

.buttons-section {
  display: flex;
  gap: $spacing-md;
  width: 100%;
  margin-top: $spacing-md;
}

.buttons-section :deep(.gradient-button) {
  flex: 1;
  width: 100%;
  height: $spacing-2xl;
  @include button-size($spacing-sm, $spacing-md, $font-size-base);
}
</style>
