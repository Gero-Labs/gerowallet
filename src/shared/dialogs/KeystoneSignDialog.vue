<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="handleClose"
    :title="t('wallet.keystoneSign')"
    :subtitle="keystoneScan ? t('wallet.scanQRCode') : t('wallet.instructions')"
    :min-height="0"
    :persistent="true"
    :img="assets.keystoneSvg"
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
        <ul class="text-left" style="line-height: 1.5">
          <li>{{ $t('wallet.unlockKeystone') }}</li>
          <li>{{ $t('wallet.selectScanQR') }} <v-icon small>mdi-line-scan</v-icon></li>
          <li>{{ $t('wallet.useKeystoneToScan') }}</li>
          <li>{{ $t('wallet.approveAndScanNext') }}</li>
        </ul>
      </v-alert>

      <v-alert
        color="white"
        dense
        outlined
        type="info"
        prominent
        border="left"
        v-else
        class="mt-4 mb-4"
      >
        <ul class="text-left" style="line-height: 1.5">
          <li>{{ $t('wallet.adjustDistance') }}</li>
          <li>{{ $t('wallet.useLowDensity') }}</li>
        </ul>
      </v-alert>

      <!-- Animated QR Code -->
      <AnimatedQRCode
        v-if="!keystoneScan && keystoneCbor"
        :type="keystoneType"
        :cbor="keystoneCbor"
      />
      <AnimatedQRScanner
        v-else
        purpose="sign"
        :urTypes="urTypes"
        width="100%"
        height="350px"
        @scan="handleScan"
        @error="handleError"
        @progress="handleProgress"
        style="height: 374px"
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
import assets from '@/utils/assets';

interface Props {
  isOpen: boolean;
  keystoneType: string;
  keystoneCbor: string;
  /** UR type(s) the scanner accepts back from the device. Defaults to
   * Cardano's signature UR so all existing (Cardano-only) consumers are
   * unaffected; Bitcoin PSBT signing passes ['crypto-psbt']. */
  urTypes?: string[];
}

withDefaults(defineProps<Props>(), {
  urTypes: () => ['cardano-signature'],
});
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
