<template>
  <BaseDialog
    :isOpen="value"
    @close="close"
    :img="walletConnectLogo"
    imgColor="var(--g-accent)"
    :title="$t('walletConnect.walletConnect')"
    :subtitle="$t('walletConnect.pairSubtitle')"
    size="sm"
    :min-height="0"
    :loading="loading"
  >
    <v-card-text class="px-0 pt-2 pb-0" style="min-height: 0;">
      <v-tabs
        v-model="tab"
        grow
        background-color="transparent"
        color="var(--g-accent)"
        slider-color="var(--g-accent)"
        class="wc-tabs mb-4"
      >
        <v-tab class="wc-tab">{{ $t('walletConnect.connectViaPaste') }}</v-tab>
        <v-tab class="wc-tab">{{ $t('walletConnect.connectViaScan') }}</v-tab>
      </v-tabs>

      <v-tabs-items v-model="tab" class="transparent">
        <!-- Paste URI -->
        <v-tab-item>
          <v-text-field
            v-model="uri"
            :label="$t('walletConnect.pasteUri')"
            :placeholder="$t('walletConnect.uriPlaceholder')"
            outlined
            dense
            clearable
            persistent-placeholder
            hide-details="auto"
            :error-messages="errorMessage"
            class="wc-input"
            @keyup.enter="pair"
          />
        </v-tab-item>

        <!-- QR Scanner -->
        <v-tab-item>
          <div v-if="tab === 1" class="wc-scanner">
            <AnimatedQRScanner
              mode="text"
              @scan="onQrScan"
              @error="onQrError"
            />
          </div>
          <div v-if="qrError" class="t-caption delta-down text-center mt-2">
            {{ qrError }}
          </div>
        </v-tab-item>
      </v-tabs-items>
    </v-card-text>

    <v-card-actions v-if="tab === 0" class="px-0 pt-4 pb-0">
      <GButton
        tier="primary"
        block
        :disabled="!isValidUri"
        :loading="loading"
        @click="pair"
      >
        {{ $t('walletConnect.connect') }}
      </GButton>
    </v-card-actions>
  </BaseDialog>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { computed, ref, watch } from 'vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import AnimatedQRScanner from '@/shared/components/AnimatedQRScanner.vue';
import assets from '@/utils/assets';

const walletConnectLogo = assets.walletConnectLogo;

const { t } = useTranslation();

const props = defineProps<{
  value: boolean;
}>();

const emit = defineEmits<{
  (e: 'input', value: boolean): void;
  (e: 'paired'): void;
}>();

const tab = ref(0);
const uri = ref('');
const loading = ref(false);
const errorMessage = ref('');
const qrError = ref('');

const isValidUri = computed(() => (uri.value ?? '').trim().startsWith('wc:'));

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
      data: { uri: (uri.value ?? '').trim() },
    });

    if (response.data?.success) {
      emit('paired');
      close();
    } else {
      errorMessage.value = response.data?.error || t('walletConnect.pairingFailed');
    }
  } catch (error) {
    errorMessage.value = (error instanceof Error && error.message) || t('walletConnect.pairingFailed');
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
  emit('input', false);
};
</script>

<style scoped lang="scss">
.wc-tabs {
  border-bottom: 1px solid var(--g-hairline-1);
}

.wc-tab {
  text-transform: none;
  letter-spacing: 0;
  font-weight: 600;
  font-size: 13.5px;
  color: var(--g-text-3);
}

.wc-tab.v-tab--active {
  color: var(--g-text-1);
}

.wc-input {
  padding-top: var(--g-s-2);
}

.wc-input :deep(.v-input__slot) {
  border-radius: var(--g-r-control);
}

.wc-scanner {
  min-height: 300px;
  border-radius: var(--g-r-card);
  overflow: hidden;
}
</style>
