<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="handleClose"
    :title="t('wallet.keystoneSign')"
    :min-height="0"
    :persistent="true"
  >
    <v-card-text class="px-3 pb-0 justify-center text-center">
      <!-- Instructions Alert -->
      <v-alert
        color="white"
        dense
        outlined
        type="info"
        prominent
        border="left"
        v-if="!keystoneScan"
        class="mt-4 mb-4"
      >
        <b>{{ $t('wallet.instructions') }}</b>
        <ul class="text-left" style="line-height: 1.5">
          <li>{{ $t('wallet.unlockKeystone') }}</li>
          <li>{{ $t('wallet.selectScanQR') }} <v-icon small>mdi-line-scan</v-icon></li>
          <li>{{ $t('wallet.useKeystoneToScan') }}</li>
          <li>{{ $t('wallet.approveAndScanNext') }}</li>
        </ul>
      </v-alert>

      <!-- QR Scanner -->
      <v-card flat class="transparent" v-else>
        <v-card-title class="justify-center">
          {{ $t('wallet.scanQRCode') }}
        </v-card-title>
        <v-card-subtitle>
          <ul class="text-left" style="line-height: 1.5">
            <li>{{ $t('wallet.adjustDistance') }}</li>
            <li>{{ $t('wallet.useLowDensity') }}</li>
          </ul>
        </v-card-subtitle>
        <v-card-text class="text-center">
          <AnimatedQRScanner
            purpose="sign"
            :urTypes="['cardano-signature']"
            width="100%"
            height="334px"
            @scan="handleScan"
            @error="handleError"
            @progress="handleProgress"
          />
        </v-card-text>
      </v-card>

      <!-- Animated QR Code -->
      <AnimatedQRCode
        v-if="!keystoneScan && keystoneCbor"
        :type="keystoneType"
        :cbor="keystoneCbor"
      />

      <!-- Actions -->
      <div class="text-center pt-4">
        <v-btn
          text
          @click="handleBack"
          class="mr-2"
        >
          {{ keystoneScan ? $t('common.back') : $t('common.cancel') }}
        </v-btn>
        <v-btn
          v-if="!keystoneScan"
          class="geroButton"
          style="color: black!important;"
          @click="keystoneScan = true"
        >
          {{ $t('common.next') }}
        </v-btn>
      </div>
    </v-card-text>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import BaseDialog from './BaseDialog.vue';
import AnimatedQRCode from '@/shared/components/AnimatedQRCode.vue';
import AnimatedQRScanner from '@/shared/components/AnimatedQRScanner.vue';

interface Props {
  isOpen: boolean;
  keystoneType: string;
  keystoneCbor: string;
}

defineProps<Props>();
const emit = defineEmits(['close', 'scan', 'error', 'progress']);

const { t } = useTranslation();
const keystoneScan = ref(false);

const handleClose = () => {
  keystoneScan.value = false;
  emit('close');
};

const handleBack = () => {
  if (keystoneScan.value) {
    keystoneScan.value = false;
  } else {
    handleClose();
  }
};

const handleScan = (ur: { type: string; cbor: string }) => {
  emit('scan', ur);
};

const handleError = (error: string) => {
  emit('error', error);
};

const handleProgress = (progress: number) => {
  emit('progress', progress);
};
</script>

<style scoped>
.geroButton {
  background: linear-gradient(to right, #00c7f3, #00fad5);
  color: black;
}
</style>
