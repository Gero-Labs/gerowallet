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
    <v-card-text class="keystone-sign px-3 pb-0">
      <!-- The steps, then the QR the device scans; on Next, the camera for its answer. -->
      <div class="keystone-sign__steps glass-tier">
        <NumberedSteps :steps="keystoneScan ? scanSteps : showSteps" />
      </div>

      <div class="keystone-sign__qr">
        <AnimatedQRCode
          v-if="!keystoneScan && keystoneCbor"
          :type="keystoneType"
          :cbor="keystoneCbor"
          :size="SIGN_QR_SIZE"
        />
        <QrViewfinder v-else-if="keystoneScan" :size="SIGN_QR_SIZE">
          <AnimatedQRScanner
            purpose="sign"
            :urTypes="urTypes"
            width="100%"
            height="100%"
            @scan="handleScan"
            @error="handleError"
            @progress="handleProgress"
          />
        </QrViewfinder>
      </div>

      <div class="keystone-sign__actions">
        <GButton tier="tertiary" @click="handleBack()">
          {{ keystoneScan ? $t('common.back') : $t('common.cancel') }}
        </GButton>
        <v-spacer />
        <GButton v-if="!keystoneScan" tier="primary" @click="keystoneScan = true">
          {{ $t('common.next') }}
        </GButton>
      </div>
    </v-card-text>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import BaseDialog from './BaseDialog.vue';
import AnimatedQRCode from '@/shared/components/AnimatedQRCode.vue';
import AnimatedQRScanner from '@/shared/components/AnimatedQRScanner.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import NumberedSteps, { type NumberedStep } from '@/shared/components/NumberedSteps.vue';
import QrViewfinder from '@/shared/components/QrViewfinder.vue';
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

/** The QR and the camera share one size, so the dialog keeps its height between the two stages. */
const SIGN_QR_SIZE = 300;

const { t } = useTranslation();
const keystoneScan = ref(false);

const showSteps = computed<NumberedStep[]>(() => [
  { text: t('wallet.unlockKeystone') },
  { text: t('wallet.selectScanQR'), icon: 'mdi-line-scan' },
  { text: t('wallet.useKeystoneToScan') },
  { text: t('wallet.approveAndScanNext') },
]);
const scanSteps = computed<NumberedStep[]>(() => [
  { text: t('wallet.adjustDistance') },
  { text: t('wallet.useLowDensity') },
]);

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

<style scoped lang="scss">
.keystone-sign {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding-top: var(--g-s-4);

  &__steps {
    padding: var(--g-s-3) var(--g-s-4);
    border-radius: var(--g-r-card);
  }

  &__qr {
    display: flex;
    justify-content: center;
  }

  // Back or Cancel on the left, Next on the right, as in onboarding.
  &__actions {
    display: flex;
    align-items: center;
    gap: var(--g-s-3);
    padding-top: var(--g-s-4);
    border-top: 1px solid var(--g-hairline-1);
  }
}
</style>
