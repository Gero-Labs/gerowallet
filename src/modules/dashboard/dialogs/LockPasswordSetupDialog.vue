<template>
  <BaseDialog
    :is-open="value"
    :title="t('security.lockPassword')"
    :subtitle="t('security.setLockPasswordSubtitle')"
    :width="500"
    :min-height="340"
    persistent
    icon="mdi-form-textbox-password"
    @close="handleClose"
  >
    <v-card-text class="py-0 lock-password-setup-dialog">
      <div class="dialog-content">
        <!-- New Password Entry -->
        <div v-if="step === 'new'" class="step-container">
          <v-card class="transparent" flat>
            <v-card-title class="justify-center pt-0 pb-8">{{ $t('security.enterNewLockPassword') }}</v-card-title>
            <v-card-text class="text-center pa-0">
              <v-text-field
                ref="newPasswordInputRef"
                v-model="newPassword"
                :label="$t('security.lockPassword')"
                :type="showNewPassword ? 'text' : 'password'"
                :append-icon="showNewPassword ? 'mdi-eye' : 'mdi-eye-off'"
                @click:append="showNewPassword = !showNewPassword"
                @keyup.enter="handleNewPasswordFinish"
                autofocus
                outlined
                dense
                :rules="[rules.required(), rules.minCharacters(8)]"
                hide-details="auto"
              ></v-text-field>
            </v-card-text>
          </v-card>
        </div>

        <!-- Confirm Password -->
        <div v-else-if="step === 'confirm'" class="step-container">
          <v-card class="transparent" flat>
            <v-card-title class="justify-center pt-0 pb-8">{{ $t('security.confirmLockPassword') }}</v-card-title>
            <v-card-text class="text-center pa-0">
              <v-text-field
                ref="confirmPasswordInputRef"
                v-model="confirmPassword"
                :label="$t('security.confirmPassword')"
                :type="showConfirmPassword ? 'text' : 'password'"
                :append-icon="showConfirmPassword ? 'mdi-eye' : 'mdi-eye-off'"
                @click:append="showConfirmPassword = !showConfirmPassword"
                @keyup.enter="handleConfirmPasswordFinish"
                :error-messages="confirmPasswordError"
                autofocus
                outlined
                dense
                hide-details="auto"
              ></v-text-field>
            </v-card-text>
          </v-card>
        </div>
      </div>
    </v-card-text>

    <v-card-actions class="px-6 pb-6">
      <v-btn
        text
        @click="handleCancel"
        :disabled="loading"
      >
        {{ $t('common.cancel') }}
      </v-btn>
      <v-spacer></v-spacer>
      <v-btn
        color="primary"
        @click="handleNext"
        :disabled="!canProceed"
        :loading="loading"
      >
        {{ step === 'new' ? $t('common.next') : $t('common.save') }}
      </v-btn>
    </v-card-actions>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import { walletStore } from '@/stores/walletStore';
import { hashPin } from '@/shared/utils/security';
import snackbar from '@/plugins/snackbar';
import rules from '@/utils/rules';

const { t } = useTranslation();

interface Props {
  value: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits(['input', 'updated']);

// Template refs
const newPasswordInputRef = ref<any>(null);
const confirmPasswordInputRef = ref<any>(null);

// Reactive state
const step = ref<'new' | 'confirm'>('new');
const newPassword = ref<string>('');
const confirmPassword = ref<string>('');
const confirmPasswordError = ref<string>('');
const showNewPassword = ref<boolean>(false);
const showConfirmPassword = ref<boolean>(false);
const loading = ref<boolean>(false);

const canProceed = computed(() => {
  if (step.value === 'new') {
    return newPassword.value.length >= 8;
  } else {
    return confirmPassword.value.length >= 8;
  }
});

// Watch props
watch(() => props.value, async (newVal) => {
  if (!newVal) {
    // Delay reset to avoid visual glitch during close animation
    setTimeout(() => {
      resetForm();
    }, 300);
  } else {
    // Dialog opened - auto focus the password input
    await nextTick();
    if (newPasswordInputRef.value) {
      newPasswordInputRef.value.focus();
    }
  }
});

async function handleNewPasswordFinish() {
  if (newPassword.value.length < 8) {
    return;
  }

  step.value = 'confirm';

  // Focus confirm password input after DOM updates
  await nextTick();
  if (confirmPasswordInputRef.value) {
    confirmPasswordInputRef.value.focus();
  }
}

async function handleConfirmPasswordFinish() {
  if (confirmPassword.value.length < 8) {
    confirmPasswordError.value = t('security.passwordTooShort');
    return;
  }

  if (newPassword.value !== confirmPassword.value) {
    confirmPasswordError.value = t('security.passwordsDontMatch');
    confirmPassword.value = '';
    return;
  }

  // Save immediately after confirmation
  await handleSave();
}

async function handleNext() {
  if (step.value === 'new') {
    await handleNewPasswordFinish();
  } else {
    await handleConfirmPasswordFinish();
  }
}

async function handleSave() {
  loading.value = true;

  try {
    const wallet = walletStore.loggedWallet;
    if (!wallet) {
      throw new Error('No wallet logged in');
    }

    // Hash the password (reuse hashPin function - it's just PBKDF2)
    const passwordHash = await hashPin(newPassword.value);

    // Save to database
    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(wallet.id);
    const configTable = db.table('config');

    // Update unlock method and password hash
    await configTable.put({ key: 'unlockMethod', value: 'password' });
    await configTable.put({ key: 'lockPasswordHash', value: passwordHash });

    // Show success snackbar
    snackbar.fireSuccess(t('security.lockPasswordSetupSuccess'));

    // Close dialog and emit update
    emit('input', false);
    emit('updated');
  } catch (error: any) {
    console.error('Error saving lock password:', error);
    confirmPasswordError.value = error.message || t('security.lockPasswordSetupFailed');
  } finally {
    loading.value = false;
  }
}

function handleCancel() {
  emit('input', false);
}

function handleClose() {
  emit('input', false);
}

function resetForm() {
  step.value = 'new';
  newPassword.value = '';
  confirmPassword.value = '';
  confirmPasswordError.value = '';
  showNewPassword.value = false;
  showConfirmPassword.value = false;
}
</script>

<style scoped>
.lock-password-setup-dialog {
  border-radius: 16px;
}

.dialog-content {
  display: flex;
  flex-direction: column;
}

.step-container {
  display: flex;
  flex-direction: column;
  justify-content: center;
  flex: 1;
}
</style>
