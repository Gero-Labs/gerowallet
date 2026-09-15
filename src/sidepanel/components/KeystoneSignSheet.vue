<template>
  <v-bottom-sheet
    :value="isOpen"
    persistent
    content-class="ks-sheet-dialog"
    @input="onInput"
  >
    <div class="ks-sheet">
      <div class="ks-handle"><div class="ks-handle-bar" /></div>

      <div class="ks-header">
        <img :src="assets.keystoneSvg" class="ks-logo" alt="" />
        <div class="ks-titles">
          <span class="ks-title">{{ t('wallet.keystoneSign') }}</span>
          <span class="ks-step">{{ keystoneScan ? t('wallet.scanQRCode') : t('wallet.instructions') }}</span>
        </div>
        <v-btn icon small class="ks-close" :aria-label="t('common.close')" @click="handleClose">
          <v-icon size="18">mdi-close</v-icon>
        </v-btn>
      </div>

      <div class="ks-body">
        <!-- Step 1: show the request as an animated QR for the device to read -->
        <template v-if="!keystoneScan">
          <div class="ks-qr">
            <AnimatedQRCode
              v-if="keystoneCbor"
              :type="keystoneType"
              :cbor="keystoneCbor"
              :size="qrSize"
              :capacity="100"
            />
          </div>
          <ol class="ks-steps">
            <li>{{ t('wallet.unlockKeystone') }}</li>
            <li>{{ t('wallet.selectScanQR') }}</li>
            <li>{{ t('wallet.useKeystoneToScan') }}</li>
            <li>{{ t('wallet.approveAndScanNext') }}</li>
          </ol>
        </template>

        <!-- Step 2: read the signature back off the device -->
        <template v-else>
          <div class="ks-scanner">
            <AnimatedQRScanner
              purpose="sign"
              :urTypes="urTypes"
              width="100%"
              :height="`${scannerHeight}px`"
              @scan="handleScan"
              @error="handleError"
              @progress="handleProgress"
            />
          </div>
          <p class="ks-hint">{{ t('wallet.adjustDistance') }}</p>
          <p class="ks-hint">{{ t('wallet.useLowDensity') }}</p>
        </template>
      </div>

      <div class="ks-footer">
        <v-btn text rounded class="ks-back" @click="handleBack">
          {{ keystoneScan ? t('common.back') : t('common.cancel') }}
        </v-btn>
        <v-btn v-if="!keystoneScan" class="geroButton ks-next" rounded depressed @click="keystoneScan = true">
          {{ t('common.next') }}
        </v-btn>
      </div>
    </div>
  </v-bottom-sheet>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import AnimatedQRCode from '@/shared/components/AnimatedQRCode.vue';
import AnimatedQRScanner from '@/shared/components/AnimatedQRScanner.vue';
import assets from '@/utils/assets';

interface Props {
  isOpen: boolean;
  keystoneType: string;
  keystoneCbor: string;
  /** UR type(s) the scanner accepts back from the device. Cardano transaction
   * signing answers with 'cardano-signature'; CIP-8 data signing answers with
   * 'cardano-sign-data-signature'. */
  urTypes?: string[];
}

withDefaults(defineProps<Props>(), {
  urTypes: () => ['cardano-signature'],
});
const emit = defineEmits(['close', 'scan', 'error', 'progress']);

const { t } = useTranslation();
const keystoneScan = ref(false);

// The side panel is user-resizable and can be narrower than the QR's 350px
// default, which is what made the old dialog overflow. Size both camera surfaces
// off the actual panel width instead.
const panelWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 400);
const onResize = () => { panelWidth.value = window.innerWidth; };
onMounted(() => window.addEventListener('resize', onResize));
onBeforeUnmount(() => window.removeEventListener('resize', onResize));

const qrSize = computed(() => Math.min(280, Math.max(168, panelWidth.value - 88)));
const scannerHeight = computed(() => Math.min(300, Math.max(200, panelWidth.value - 88)));

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

// v-bottom-sheet is persistent, so this only fires on a programmatic close.
const onInput = (value: boolean) => {
  if (!value) handleClose();
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

<!-- Unscoped on purpose: content-class lands on Vuetify's detached dialog
     root, which no scoped selector can reach. The class name is unique to this
     component, so nothing else can pick the rule up. -->
<style>
.ks-sheet-dialog.v-dialog {
  margin: 0;
  width: 100%;
  border-radius: var(--g-r-sheet) var(--g-r-sheet) 0 0;
  box-shadow: var(--g-shadow-sheet);
  overflow: visible;
}
</style>

<style scoped>
.ks-sheet {
  background: var(--g-overlay);
  border: 1px solid var(--g-hairline-3);
  border-bottom: none;
  border-radius: var(--g-r-sheet) var(--g-r-sheet) 0 0;
  display: flex;
  flex-direction: column;
  max-height: 92vh;
}

.ks-handle {
  display: flex;
  justify-content: center;
  padding: 10px 0 2px;
}

.ks-handle-bar {
  width: 36px;
  height: 4px;
  border-radius: var(--g-r-pill);
  background: var(--g-hairline-3);
}

.ks-header {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-2) var(--g-s-4) var(--g-s-3);
  border-bottom: 1px solid var(--g-hairline-1);
}

.ks-logo {
  width: 22px;
  height: 22px;
  flex: none;
}

.ks-titles {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.ks-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--g-text-1);
  line-height: 1.25;
}

.ks-step {
  font-size: 12px;
  color: var(--g-text-3);
  line-height: 1.3;
}

.ks-sheet .ks-close.v-btn {
  color: var(--g-text-3);
}

.ks-body {
  padding: var(--g-s-4);
  overflow-y: auto;
}

.ks-qr {
  display: flex;
  justify-content: center;
  padding: var(--g-s-3);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
}

.ks-scanner {
  border-radius: var(--g-r-card);
  overflow: hidden;
  border: 1px solid var(--g-hairline-1);
}

.ks-steps {
  margin: var(--g-s-4) 0 0;
  padding-left: 18px;
  color: var(--g-text-2);
  font-size: 12px;
  line-height: 1.55;
}

.ks-steps li + li {
  margin-top: 2px;
}

.ks-hint {
  margin: var(--g-s-3) 0 0;
  color: var(--g-text-3);
  font-size: 12px;
  line-height: 1.4;
  text-align: center;
}

.ks-footer {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-3) var(--g-s-4) var(--g-s-4);
  border-top: 1px solid var(--g-hairline-1);
}

.ks-sheet .ks-back.v-btn {
  color: var(--g-text-2);
}

.ks-next {
  flex: 1;
}
</style>
