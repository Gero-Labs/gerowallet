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
import { computed, getCurrentInstance, ref, watch } from 'vue';
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
const vm = getCurrentInstance();
const currentRouteName = computed<string | null>(() => vm?.proxy?.$route?.name ?? null);
const suppressedRoutes = new Set(['welcome', 'plogin']);
const shouldShow = computed(() => {
  if (!loggedWallet.value || SessionStore.state.isUnlocked) {
    return false;
  }
  return !suppressedRoutes.has(currentRouteName.value ?? '');
});
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

const unlock = async () => {
  if (isUnlockDisabled.value) {
    return;
  }

  loading.value = true;
  errorMessage.value = '';

  openKeepAlivePort();

  try {
    const response: any = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.UNLOCK_SESSION,
      data: { password: password.value },
    });

    if (response?.data?.success) {
      SessionStore.setUnlocked(true, null);
      resetFields();
      loading.value = false;
      closeKeepAlivePort();
      return;
    }

    if (response?.data?.errorCode === 'INVALID_SPENDING_PASSWORD') {
      errorMessage.value = t('navigation.invalidPassword');
    } else if (response?.error) {
      errorMessage.value = response.error;
    } else {
      errorMessage.value = t('navigation.invalidPassword');
    }
  } catch (error: any) {
    const message = error?.message || String(error);
    errorMessage.value = message || t('navigation.invalidPassword');
  } finally {
    loading.value = false;
    closeKeepAlivePort();
  }
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
