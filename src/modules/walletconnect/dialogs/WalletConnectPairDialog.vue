<template>
  <v-dialog v-model="dialogModel" persistent max-width="440">
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon left color="primary">mdi-link-variant</v-icon>
        {{ $t('walletConnect.walletConnect') }}
        <v-spacer />
        <v-btn icon small @click="close">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>

      <v-tabs v-model="tab" centered>
        <v-tab>{{ $t('walletConnect.connectViaPaste') }}</v-tab>
        <v-tab>{{ $t('walletConnect.connectViaScan') }}</v-tab>
      </v-tabs>

      <v-tabs-items v-model="tab">
        <!-- Paste URI tab -->
        <v-tab-item>
          <v-card-text>
            <v-text-field
              v-model="uri"
              :label="$t('walletConnect.pasteUri')"
              :placeholder="$t('walletConnect.uriPlaceholder')"
              outlined
              dense
              clearable
              :error-messages="errorMessage"
              @keyup.enter="pair"
            />
          </v-card-text>
          <v-card-actions class="px-4 pb-4">
            <v-btn
              block
              class="geroButton"
              style="color: black!important;"
              :disabled="!isValidUri"
              :loading="loading"
              @click="pair"
            >
              {{ $t('walletConnect.connect') }}
            </v-btn>
          </v-card-actions>
        </v-tab-item>

        <!-- QR Scanner tab -->
        <v-tab-item>
          <v-card-text class="pa-2">
            <div v-if="tab === 1" style="min-height: 300px;">
              <AnimatedQRScanner
                mode="text"
                @scan="onQrScan"
                @error="onQrError"
              />
            </div>
            <div v-if="qrError" class="caption error--text text-center mt-2">
              {{ qrError }}
            </div>
          </v-card-text>
        </v-tab-item>
      </v-tabs-items>

      <!-- Loading overlay -->
      <v-overlay :value="loading" absolute>
        <v-progress-circular indeterminate color="primary" />
        <div class="mt-2 white--text">{{ $t('walletConnect.connecting') }}</div>
      </v-overlay>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { computed, ref, watch } from 'vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import AnimatedQRScanner from '@/shared/components/AnimatedQRScanner.vue';

const { t } = useTranslation();

const props = defineProps<{
  value: boolean;
}>();

const emit = defineEmits<{
  (e: 'input', value: boolean): void;
  (e: 'paired'): void;
}>();

const dialogModel = computed({
  get: () => props.value,
  set: (v) => emit('input', v),
});

const tab = ref(0);
const uri = ref('');
const loading = ref(false);
const errorMessage = ref('');
const qrError = ref('');

const isValidUri = computed(() => {
  return uri.value.trim().startsWith('wc:');
});

// Reset state when dialog opens
watch(() => props.value, (open) => {
  if (open) {
    uri.value = '';
    errorMessage.value = '';
    qrError.value = '';
    loading.value = false;
    tab.value = 0;
  }
});

const pair = async () => {
  if (!isValidUri.value) {
    errorMessage.value = t('walletConnect.invalidUri');
    return;
  }

  loading.value = true;
  errorMessage.value = '';

  try {
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.WC_PAIR,
      data: { uri: uri.value.trim() },
    });

    if (response.data?.success) {
      emit('paired');
      close();
    } else {
      errorMessage.value = response.data?.error || t('walletConnect.pairingFailed');
    }
  } catch (error: any) {
    errorMessage.value = error.message || t('walletConnect.pairingFailed');
  } finally {
    loading.value = false;
  }
};

const onQrScan = (text: string) => {
  if (text && text.startsWith('wc:')) {
    uri.value = text;
    tab.value = 0; // Switch to paste tab to show the URI
    pair();
  }
};

const onQrError = (error: string) => {
  qrError.value = error;
};

const close = () => {
  dialogModel.value = false;
};
</script>
