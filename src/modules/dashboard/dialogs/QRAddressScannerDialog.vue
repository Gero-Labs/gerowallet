<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="handleClose"
    icon="mdi-qrcode-scan"
    :title="t('wallet.scanAddressQR')"
    :subtitle="t('wallet.pointCameraAtQR')"
    :width="500"
    :min-height="0"
    :persistent="false"
  >
    <v-card-text class="pa-4">
      <div class="scanner-container">
        <!-- Accessing Camera -->
        <div v-if="status === 'accessing'" class="scanner-status">
          <v-progress-circular indeterminate color="primary" size="48"></v-progress-circular>
          <p class="mt-4 text-center white--text">{{ t('wallet.accessingCamera') }}</p>
        </div>

        <!-- No Webcam -->
        <div v-else-if="status === 'no-webcam'" class="scanner-status">
          <v-icon size="48" color="error">mdi-camera-off</v-icon>
          <p class="mt-4 text-center white--text">{{ t('wallet.noCameraFound') }}</p>
        </div>

        <!-- Permission Needed -->
        <div v-else-if="status === 'permission-needed'" class="scanner-status">
          <v-icon size="48" color="warning">mdi-camera-lock</v-icon>
          <p class="mt-4 text-center white--text">{{ t('wallet.pleaseAllowCameraAccess') }}</p>
          <v-btn color="primary" @click="requestPermission" class="mt-4">
            {{ t('wallet.grantPermission') }}
          </v-btn>
        </div>

        <!-- Error -->
        <div v-else-if="status === 'error'" class="scanner-status">
          <v-icon size="48" color="error">mdi-alert-circle</v-icon>
          <p class="mt-4 text-center white--text">{{ t('wallet.unableToAccessCamera') }}</p>
        </div>

        <!-- Camera Feed -->
        <div v-show="status === 'ready'" class="scanner-viewport">
          <video ref="videoEl" class="scanner-video"></video>
          <div class="scanner-overlay">
            <div class="viewfinder">
              <span class="corner top-left"></span>
              <span class="corner top-right"></span>
              <span class="corner bottom-left"></span>
              <span class="corner bottom-right"></span>
            </div>
          </div>
        </div>

        <!-- Invalid QR feedback (fixed height to prevent layout shift) -->
        <div class="qr-feedback">
          <v-alert
            v-show="invalidQR"
            type="warning"
            dense
            border="left"
            outlined
            class="mb-0"
            style="width: 100%;"
          >
            {{ t('wallet.invalidQRAddress') }}
          </v-alert>
        </div>
      </div>
    </v-card-text>

    <v-card-actions class="justify-center pb-4">
      <v-btn text @click="handleClose">
        {{ t('common.cancel') }}
      </v-btn>
    </v-card-actions>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { BrowserQRCodeReader } from '@zxing/browser';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import rules from '@/utils/rules';

interface Props {
  isOpen: boolean;
  chain?: string;
  network?: string;
}

const props = defineProps<Props>();
const emit = defineEmits(['close', 'scan']);
const { t } = useTranslation();

const videoEl = ref<HTMLVideoElement | null>(null);
const status = ref<'accessing' | 'no-webcam' | 'permission-needed' | 'error' | 'ready'>('accessing');
const invalidQR = ref(false);

let codeReader: BrowserQRCodeReader | null = null;
let scanControls: { stop(): void } | null = null;
let invalidTimer: ReturnType<typeof setTimeout> | null = null;

function initReader() {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
  codeReader = new BrowserQRCodeReader(hints, {
    delayBetweenScanAttempts: 80,
    delayBetweenScanSuccess: 200,
  });
}

async function startCamera() {
  status.value = 'accessing';
  invalidQR.value = false;

  if (!navigator.mediaDevices?.getUserMedia) {
    status.value = 'no-webcam';
    return;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    if (!devices.some(d => d.kind === 'videoinput')) {
      status.value = 'no-webcam';
      return;
    }
  } catch {
    status.value = 'error';
    return;
  }

  // Check permission state without acquiring a stream (avoids double-prompt)
  try {
    const perm = await navigator.permissions.query({ name: 'camera' as PermissionName });
    if (perm.state === 'denied') {
      status.value = 'permission-needed';
      return;
    }
  } catch {
    // Permissions API not available; proceed — decodeFromVideoDevice will handle it
  }

  status.value = 'ready';
  startScanning();
}

async function startScanning() {
  if (!videoEl.value || !codeReader) return;

  try {
    scanControls = await codeReader.decodeFromVideoDevice(
      undefined,
      videoEl.value,
      (result, error) => {
        if (result) {
          handleResult(result.getText());
        }
        // NotFoundException is normal when no QR is in frame
        if (error && error.name !== 'NotFoundException') {
          console.debug('[QRScanner] scan error:', error.message);
        }
      }
    );
  } catch (err: any) {
    console.error('[QRScanner] failed to start:', err);
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      status.value = 'permission-needed';
    } else if (err.name === 'NotFoundError') {
      status.value = 'no-webcam';
    } else {
      status.value = 'error';
    }
  }
}

function isValidAddress(address: string): boolean {
  const rule = rules.recipientRules(props.chain, props.network);
  return rule(address) === true;
}

function handleResult(text: string) {
  // Strip common URI scheme prefixes (web+cardano:, cardano:, etc.)
  let address = text.trim();
  const uriMatch = address.match(/^(?:web\+)?[a-z]+:/i);
  if (uriMatch) {
    address = address.slice(uriMatch[0].length);
  }
  // Strip any query params (?amount=...)
  const qIdx = address.indexOf('?');
  if (qIdx !== -1) {
    address = address.slice(0, qIdx);
  }
  address = address.trim();

  if (isValidAddress(address)) {
    cleanup();
    emit('scan', address);
    emit('close');
  } else {
    // Show invalid feedback briefly, keep scanning
    invalidQR.value = true;
    if (invalidTimer) clearTimeout(invalidTimer);
    invalidTimer = setTimeout(() => { invalidQR.value = false; }, 3000);
  }
}

function requestPermission() {
  startCamera();
}

function cleanup() {
  if (scanControls) {
    try { scanControls.stop(); } catch {}
    scanControls = null;
  }
  if (invalidTimer) {
    clearTimeout(invalidTimer);
    invalidTimer = null;
  }
}

function handleClose() {
  cleanup();
  emit('close');
}

// Start camera when dialog opens, stop when it closes
watch(() => props.isOpen, (open) => {
  if (open) {
    initReader();
    // Small delay to let dialog DOM render the video element
    setTimeout(() => startCamera(), 100);
  } else {
    cleanup();
    status.value = 'accessing';
    invalidQR.value = false;
  }
});

onBeforeUnmount(() => {
  cleanup();
});
</script>

<style scoped>
.scanner-container {
  height: 388px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.scanner-status {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.scanner-viewport {
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  background: #000;
  height: 340px;
}

.scanner-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.scanner-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.viewfinder {
  position: relative;
  width: 220px;
  height: 220px;
}

.corner {
  position: absolute;
  width: 28px;
  height: 28px;
  border-color: #00DFF3;
  border-style: solid;
  border-width: 0;
}

.corner.top-left {
  top: 0; left: 0;
  border-top-width: 3px;
  border-left-width: 3px;
  border-top-left-radius: 6px;
}

.corner.top-right {
  top: 0; right: 0;
  border-top-width: 3px;
  border-right-width: 3px;
  border-top-right-radius: 6px;
}

.corner.bottom-left {
  bottom: 0; left: 0;
  border-bottom-width: 3px;
  border-left-width: 3px;
  border-bottom-left-radius: 6px;
}

.corner.bottom-right {
  bottom: 0; right: 0;
  border-bottom-width: 3px;
  border-right-width: 3px;
  border-bottom-right-radius: 6px;
}

.qr-feedback {
  min-height: 48px;
  margin-top: 12px;
  display: flex;
  align-items: center;
}
</style>
