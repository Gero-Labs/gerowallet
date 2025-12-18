<template>
  <BaseDialog
    :is-open="value"
    :title="$t('security.pin')"
    :subtitle="$t('security.4To6DigitCode')"
    :width="500"
    :min-height="340"
    persistent
    icon="mdi-numeric"
    @close="handleClose"
  >
    <v-card-text class="py-0 pin-setup-dialog">
      <div class="dialog-content">
        <!-- New PIN Entry -->
        <div v-if="step === 'new'" class="step-container">
          <v-card class="transparent" flat>
            <v-card-title class="justify-center pt-0 pb-8">{{ $t('security.enterNewPin') }}</v-card-title>
            <v-card-subtitle class="text-center pt-0">
              <!-- PIN Length Selector -->
              <v-btn-toggle
                v-model="pinLength"
                mandatory
                dense
                color="primary"
              >
                <v-btn :value="4" small>
                  <v-icon>
                    mdi-numeric-4
                  </v-icon>
                </v-btn>
                <v-btn :value="5" small>
                  <v-icon>
                    mdi-numeric-5
                  </v-icon>
                </v-btn>
                <v-btn :value="6" small>
                  <v-icon>
                    mdi-numeric-6
                  </v-icon>
                </v-btn>
              </v-btn-toggle>
            </v-card-subtitle>
            <v-card-text class="text-center pa-0">
              <numeric-otp-input
                ref="newPinInputRef"
                v-model="newPin"
                :length="pinLength"
                @finish="handleNewPinFinish"
              />
            </v-card-text>
          </v-card>
        </div>

        <!-- Confirm PIN -->
        <div v-else-if="step === 'confirm'" class="step-container">
          <v-card class="transparent" flat>
            <v-card-title class="justify-center pt-0 pb-8">{{ $t('security.confirmPin') }}</v-card-title>
            <v-card-subtitle style="height: 45px;"></v-card-subtitle>
            <v-card-text class="text-center pa-0">
              <numeric-otp-input
                ref="confirmPinInputRef"
                v-model="confirmPin"
                :length="pinLength"
                :error="confirmPinError"
                @finish="handleConfirmPinFinish"
              />
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
    </v-card-actions>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import NumericOtpInput from '@/shared/components/NumericOtpInput.vue';
import { walletStore } from '@/stores/walletStore';
import { hashPin, isValidPin } from '@/shared/utils/security';
import snackbar from '@/plugins/snackbar';

const { t } = useTranslation();

interface Props {
  value: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits(['input', 'updated']);

// Template refs
const newPinInputRef = ref<any>(null);
const confirmPinInputRef = ref<any>(null);

// Reactive state
const step = ref<'new' | 'confirm'>('new');
const pinLength = ref<number>(4);
const newPin = ref<string>('');
const confirmPin = ref<string>('');
const confirmPinError = ref<string>('');
const loading = ref<boolean>(false);

// Watch props
watch(() => props.value, async (newVal) => {
  if (!newVal) {
    // Delay reset to avoid visual glitch during close animation
    setTimeout(() => {
      resetForm();
    }, 300);
  } else {
    // Dialog opened - auto focus the PIN input
    await nextTick();
    if (newPinInputRef.value) {
      newPinInputRef.value.focus();
    }
  }
});

async function handleNewPinFinish(pin: string) {
  newPin.value = pin;

  if (!isValidPin(pin)) {
    // Invalid PIN format - this shouldn't happen due to numeric filtering
    return;
  }

  step.value = 'confirm';

  // Focus confirm PIN input after DOM updates
  await nextTick();
  if (confirmPinInputRef.value) {
    confirmPinInputRef.value.focus();
  }
}

async function handleConfirmPinFinish(pin: string) {
  confirmPin.value = pin;

  if (!isValidPin(pin)) {
    confirmPinError.value = t('security.invalidPinFormat');
    return;
  }

  if (newPin.value !== confirmPin.value) {
    confirmPinError.value = t('security.pinsDontMatch');
    confirmPin.value = '';
    return;
  }

  // Save immediately after confirmation
  await handleSave();
}

async function handleSave() {
  loading.value = true;

  try {
    const wallet = walletStore.loggedWallet;
    if (!wallet) {
      throw new Error('No wallet logged in');
    }

    // Hash the PIN (no encryption needed)
    const pinHash = await hashPin(newPin.value);

    // Save to database
    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(wallet.id);
    const configTable = db.table('config');

    // Update unlock method, PIN hash, and PIN length
    await configTable.put({ key: 'unlockMethod', value: 'pin' });
    await configTable.put({ key: 'pinHash', value: pinHash });
    await configTable.put({ key: 'pinLength', value: pinLength.value });

    // Remove old encrypted PIN hash if it exists
    await configTable.where({ key: 'encryptedPinHash' }).delete();

    // Show success snackbar
    snackbar.fireSuccess(t('security.pinSetupSuccess'));

    // Close dialog and emit update
    emit('input', false);
    emit('updated');
  } catch (error: any) {
    console.error('Error saving PIN:', error);
    confirmPinError.value = error.message || t('security.pinSetupFailed');
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
  pinLength.value = 4;
  newPin.value = '';
  confirmPin.value = '';
  confirmPinError.value = '';
}
</script>

<style scoped>
.pin-setup-dialog {
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
