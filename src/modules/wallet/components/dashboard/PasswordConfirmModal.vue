<template>
  <v-dialog v-model="open" max-width="400" persistent content-class="password-confirm-modal">
    <v-card class="password-confirm-dialog" outlined>
      <!-- Header -->
      <div class="modal-header">
        <div class="content">
          <div class="icon-section">
            <div class="featured-icon">
              <v-icon class="lock-icon">mdi-lock</v-icon>
            </div>
          </div>

          <div class="text-section">
            <h3 class="modal-title">{{ title }}</h3>
            <p class="modal-subtitle">
              {{ subtitle }}
            </p>
          </div>
        </div>

        <v-btn icon class="close-btn" @click="closeModal">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </div>

      <!-- Actions -->
      <div class="modal-actions">
        <div class="actions-content">
          <div class="password-section">
            <label class="input-label">{{ t('card.enterPasswordToConfirm') }}</label>
            <v-text-field
              v-model="password"
              type="password"
              dense
              outlined
              class="password-input"
              hide-details
              placeholder="**********"
              @keyup.enter="confirmAction"
            />
          </div>

          <!-- PassKey Autofill Option -->
          <div v-if="passKeyAvailable" class="passkey-section">
            <v-btn
              text
              block
              color="primary"
              @click="handlePassKeyAutofill"
              :disabled="passKeyLoading"
              class="passkey-btn"
            >
              <v-icon left>mdi-fingerprint</v-icon>
              {{ t('security.usePassKeyForPasswordAutofill') }}
            </v-btn>
          </div>

          <div class="buttons-section">
            <SecondaryButton :text="t('common.cancel')" @click="closeModal()" />
            <GradientButton :text="confirmButtonText" @click="confirmAction" />
          </div>
        </div>
      </div>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, watch } from 'vue';
import SecondaryButton from '../SecondaryButton.vue';
import GradientButton from '../GradientButton.vue';
import { walletStore } from '@/stores/walletStore';

const { t } = useTranslation();

interface Props {
  open: boolean;
  title?: string;
  subtitle?: string;
  confirmButtonText?: string;
  action?: string;
}

interface Emits {
  (e: 'close'): void;
  (e: 'confirm', password: string, action: string): void;
}

const props = withDefaults(defineProps<Props>(), {
  title: t('wallet.confirmAction'),
  subtitle: t('wallet.pleaseEnterPasswordToContinue'),
  confirmButtonText: t('common.confirm'),
  action: 'default',
});

const emit = defineEmits<Emits>();

const password = ref('');
const loading = ref(false);
const passKeyAvailable = ref(false);
const passKeyLoading = ref(false);

// Check PassKey availability when dialog opens
watch(() => props.open, async (isOpen) => {
  if (isOpen) {
    passKeyAvailable.value = await checkPassKeyAvailable();
  }
});

/**
 * Check if PassKey autofill is available for this wallet
 */
async function checkPassKeyAvailable(): Promise<boolean> {
  try {
    const wallet = walletStore.loggedWallet;
    if (!wallet) return false;

    // Check if WebAuthn is supported
    if (!window.PublicKeyCredential) return false;

    // Check if PassKey autofill is enabled in DB
    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(wallet.id);
    const configTable = db.table('config');

    const passKeyAutofillConfig = await configTable.where({ key: 'passKeyForPasswordAutofill' }).first();
    const encryptedPasswordConfig = await configTable.where({ key: 'passKeyEncryptedSpendingPassword' }).first();
    const credentialConfig = await configTable.where({ key: 'webAuthnCredentialId' }).first();

    return !!(
      passKeyAutofillConfig?.value &&
      encryptedPasswordConfig?.value &&
      credentialConfig?.value
    );
  } catch (error) {
    console.error('Error checking PassKey availability:', error);
    return false;
  }
}

/**
 * Handle PassKey authentication and password autofill
 */
async function handlePassKeyAutofill() {
  passKeyLoading.value = true;

  try {
    const wallet = walletStore.loggedWallet;
    if (!wallet) {
      throw new Error('No wallet logged in');
    }

    // Get database config
    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(wallet.id);
    const configTable = db.table('config');

    // Get WebAuthn credential ID
    const credentialConfig = await configTable.where({ key: 'webAuthnCredentialId' }).first();
    if (!credentialConfig || !credentialConfig.value) {
      throw new Error('PassKey credential not found');
    }

    // Get encrypted password
    const encryptedPasswordConfig = await configTable.where({ key: 'passKeyEncryptedSpendingPassword' }).first();
    if (!encryptedPasswordConfig || !encryptedPasswordConfig.value) {
      throw new Error('Encrypted password not found');
    }

    console.log('🔐 Authenticating with PassKey...');

    // Authenticate with WebAuthn
    const { authenticateWebAuthn, decryptSpendingPasswordForPassKey } = await import('@/shared/utils/security');
    const authenticated = await authenticateWebAuthn(credentialConfig.value);

    if (!authenticated) {
      throw new Error('PassKey authentication failed');
    }

    console.log('✅ PassKey authentication successful');

    // Decrypt spending password
    const decryptedPassword = await decryptSpendingPasswordForPassKey(
      encryptedPasswordConfig.value,
      credentialConfig.value,
      wallet.id
    );

    console.log('🔓 Password decrypted successfully');

    // Auto-fill password
    password.value = decryptedPassword;

    // Auto-confirm after short delay (allow user to see the filled field)
    setTimeout(() => {
      confirmAction();
    }, 300);
  } catch (error: any) {
    console.error('❌ PassKey autofill failed:', error);

    // Show error with snackbar
    const { default: snackbar } = await import('@/plugins/snackbar');
    snackbar.setError(error.message || t('security.passKeyAuthFailed'));
  } finally {
    passKeyLoading.value = false;
  }
}

const closeModal = () => {
  password.value = '';
  emit('close');
};

const confirmAction = async () => {
  if (!password.value) return;

  loading.value = true;

  await new Promise(resolve => setTimeout(resolve, 1000));

  loading.value = false;

  emit('confirm', password.value, props.action);
  closeModal();
};
</script>

<style lang="scss" scoped>
@import '../../styles/variables';
@import '../../styles/mixins';

.password-confirm-modal {
  .v-dialog__content {
    align-items: center;
    justify-content: center;
  }
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
}

.modal-title {
  @include heading-style($font-size-lg);
}

.modal-subtitle {
  @include body-text($font-size-sm);
  color: $text-muted;
  margin: 0;
}

.close-btn {
  position: absolute;
  top: $spacing-sm;
  right: $spacing-sm;
  width: 44px;
  height: 44px;

  .v-icon {
    color: #85888e;
    font-size: $font-size-xl;
  }
}

.modal-actions {
  padding: $spacing-sm 0 0;
  width: 100%;
}

.actions-content {
  @include flex-column;
  gap: $spacing-sm;
  padding: 0 $spacing-xl $spacing-xl;
}

.password-section {
  @include flex-column;
  gap: $spacing-xs;
}

.passkey-section {
  width: 100%;
  margin-top: $spacing-xs;
}

.passkey-btn {
  text-transform: none !important;
  letter-spacing: normal !important;
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
.buttons-section :deep(.secondary-button),
.buttons-section :deep(.gradient-button) {
  flex: 1;
  width: 100%;
  height: $spacing-2xl;
  @include button-size($spacing-sm, $spacing-md, $font-size-base);
}
</style>
