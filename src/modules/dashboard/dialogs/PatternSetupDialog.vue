<template>
  <BaseDialog
    :is-open="value"
    :title="$t('security.setupPattern')"
    :width="500"
    :min-height="400"
    persistent
    icon="mdi-lock-pattern"
    @close="handleClose"
  >
    <v-card-text class="py-0 pattern-setup-dialog">
        <!-- New Pattern Entry -->
      <v-card v-if="step === 'new'" class="step-container transparent">
        <v-card-title class="justify-center pt-0">{{ $t('security.drawNewPattern') }}</v-card-title>
        <v-card-subtitle class="text-center">{{ $t('security.patternMustConnectAtLeast4Dots') }}</v-card-subtitle>
        <v-card-text class="text-center">
          <pattern-lock
            v-model="newPattern"
            @complete="handleNewPatternComplete"
          />
        </v-card-text>
      </v-card>
      <v-card v-else class="step-container transparent">
        <v-card-title class="justify-center pt-0">{{ $t('security.confirmPattern') }}</v-card-title>
        <v-card-subtitle class="text-center" style="height: 38px"></v-card-subtitle>
        <v-card-text class="text-center">
          <v-tooltip
            v-model="tooltip.enabled"
            top
            color="red"
          >
            <template v-slot:activator="{ }">
              <pattern-lock
                v-if="!loading"
                v-model="confirmPattern"
                @complete="handleConfirmPatternComplete"
              />
            </template>
            <span>{{ tooltip.text }}</span>
          </v-tooltip>
        </v-card-text>

      </v-card>
      <div v-if="loading" class="text-center">
        <v-progress-circular
          indeterminate
          color="primary"
          size="64"
          class="mb-4"
        ></v-progress-circular>
        <div class="subtitle-1">{{ $t('security.savingPattern') }}</div>
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
import { ref, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import { walletStore } from '@/stores/walletStore';
import { hashPattern, isValidPattern } from '@/shared/utils/security';
import PatternLock from '../components/PatternLock.vue';
import snackbar from '@/plugins/snackbar';

const { t } = useTranslation();

interface Props {
  value: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits(['input', 'updated']);

// Reactive state
const step = ref<'new' | 'confirm'>('new');
const currentPatternInput = ref<number[]>([]);
const newPattern = ref<number[]>([]);
const confirmPattern = ref<number[]>([]);
const loading = ref<boolean>(false);
const tooltip = ref<any>({
  enabled: false,
  text: ''
});

// Watch props
watch(() => props.value, (newVal) => {
  if (!newVal) {
    setTimeout(() => {
      resetForm();
    }, 300);
  }
});

// Helper to show error tooltip
function showError(message: string) {
  tooltip.value.text = message;
  tooltip.value.enabled = true;
  setTimeout(() => {
    tooltip.value.enabled = false;
  }, 2000);
}

async function handleNewPatternComplete(pattern: number[]) {
  newPattern.value = pattern;

  if (!isValidPattern(pattern)) {
    showError(t('security.invalidPatternFormat'));
    return;
  }

  step.value = 'confirm';
}

async function handleConfirmPatternComplete(pattern: number[]) {
  confirmPattern.value = pattern;

  if (!isValidPattern(pattern)) {
    showError(t('security.invalidPatternFormat'));
    return;
  }

  // Compare patterns
  if (newPattern.value.length !== confirmPattern.value.length) {
    showError(t('security.patternsDontMatch'));
    confirmPattern.value = [];
    return;
  }

  for (let i = 0; i < newPattern.value.length; i++) {
    if (newPattern.value[i] !== confirmPattern.value[i]) {
      showError(t('security.patternsDontMatch'));
      confirmPattern.value = [];
      return;
    }
  }

  // Patterns match, save immediately
  await handleSave();
}

async function handleSave() {
  loading.value = true;

  try {
    const wallet = walletStore.loggedWallet;
    if (!wallet) {
      throw new Error('No wallet logged in');
    }

    // Hash the pattern (no encryption needed, just like PIN)
    const patternHash = await hashPattern(newPattern.value);

    // Save to database
    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(wallet.id);
    const configTable = db.table('config');

    // Update unlock method and store the hash directly
    await configTable.put({ key: 'unlockMethod', value: 'pattern' });
    await configTable.put({ key: 'encryptedPatternHash', value: patternHash });

    // Show success snackbar
    snackbar.fireSuccess(t('security.patternSetupSuccess'));

    // Close dialog and emit update
    emit('input', false);
    emit('updated');
  } catch (error: any) {
    console.error('Error saving pattern:', error);
    showError(error.message || t('security.patternSetupFailed'));
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
  currentPatternInput.value = [];
  newPattern.value = [];
  confirmPattern.value = [];
  tooltip.value.enabled = false;
  tooltip.value.text = '';
}
</script>

<style scoped>
.pattern-setup-dialog {
  border-radius: 16px;
}

.step-container {
  min-height: 350px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
</style>
