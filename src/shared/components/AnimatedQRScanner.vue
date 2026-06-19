<template>
  <div class="animated-qr-scanner">
    <!-- Camera Status Messages -->
    <div v-if="cameraStatus !== CameraStatus.READY" class="scanner-status">
      <div v-if="cameraStatus === CameraStatus.ACCESSING_CAMERA" class="status-message">
        <v-progress-circular indeterminate color="primary"></v-progress-circular>
        <p class="mt-4">{{ $t('wallet.accessingCamera') }}</p>
      </div>
      <div v-else-if="cameraStatus === CameraStatus.NO_WEBCAM" class="status-message error">
        <v-icon large color="error">mdi-camera-off</v-icon>
        <p class="mt-4">{{ $t('wallet.noWebcamFound') }}</p>
      </div>
      <div v-else-if="cameraStatus === CameraStatus.PERMISSION_NEEDED" class="status-message permission-needed">
        <v-icon large color="primary">mdi-camera-lock</v-icon>
        <p class="mt-4 permission-text">{{ $t('wallet.cameraPermissionNeeded') }}</p>
        <p v-if="permissionDenied" class="mt-1 permission-hint">{{ $t('wallet.cameraPermissionDeniedHint') }}</p>
        <p v-else class="mt-1 permission-hint">{{ $t('wallet.cameraPermissionHint') }}</p>
        <v-btn color="primary" @click="openCameraPermissionSettings" class="mt-4">
          {{ permissionDenied ? $t('wallet.tryAgain') : $t('wallet.grantPermission') }}
        </v-btn>
      </div>
      <div v-else-if="cameraStatus === CameraStatus.UNKNOWN_ERROR" class="status-message error">
        <v-icon large color="error">mdi-alert-circle</v-icon>
        <p class="mt-4">{{ $t('wallet.unknownCameraError') }}</p>
      </div>
    </div>

    <!-- Video Element for QR Scanning -->
    <video
      ref="video"
      :style="{
        display: canPlay && cameraStatus === CameraStatus.READY ? 'block' : 'none',
        width: width || 'auto',
        height: height || 'auto',
        objectFit: 'cover',
        transform: 'rotateY(180deg)',
        filter: blur ? 'blur(4px)' : 'none',
        borderRadius: '4px'
      }"
    ></video>

    <!-- Progress Indicator -->
    <div v-if="progress > 0 && progress < 100" class="progress-container">
      <v-progress-linear
        :value="progress"
        height="25"
        color="primary"
      >
        <strong>{{ Math.ceil(progress) }}%</strong>
      </v-progress-linear>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { BrowserQRCodeReader } from '@zxing/browser';
import { CameraStatus, getAnimatedScan } from '@keystonehq/animated-qr-base';

// Props
const props = defineProps({
  purpose: {
    type: String,
    required: false,
  },
  urTypes: {
    type: Array,
    required: false,
  },
  mode: {
    type: String,
    default: 'keystone', // 'keystone' = UR-encoded animated QR, 'text' = raw text QR
  },
  width: {
    type: [String, Number],
    default: '100%',
  },
  height: {
    type: [String, Number],
    default: '334px',
  },
  blur: {
    type: Boolean,
    default: false,
  },
});

// Emits
const emit = defineEmits(['videoLoaded', 'progress', 'scan', 'error']);

// Template refs
const video = ref(null);

// State
const cameraStatus = ref(CameraStatus.ACCESSING_CAMERA);
const canPlay = ref(false);
const progress = ref(0);
const isDone = ref(false);
const codeReader = ref(null);
const scanControls = ref(null);
const mounted = ref(false);
const permissionChecker = ref(null);
const canplayListener = ref(null);
const permissionDenied = ref(false);

// Methods
function initializeScanner() {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
  codeReader.value = new BrowserQRCodeReader(hints, {
    delayBetweenScanAttempts: 50,
    delayBetweenScanSuccess: 100,
  });
}

async function checkEnvironment() {
  try {
    // Check if getUserMedia is supported
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      cameraStatus.value = CameraStatus.NO_WEBCAM;
      emit('videoLoaded', false, 'NO_WEBCAM_FOUND');
      return;
    }

    // Try to enumerate devices to check if camera exists
    const devices = await navigator.mediaDevices.enumerateDevices();
    const hasCamera = devices.some(device => device.kind === 'videoinput');

    if (!hasCamera) {
      cameraStatus.value = CameraStatus.NO_WEBCAM;
      emit('videoLoaded', false, 'NO_WEBCAM_FOUND');
      return;
    }

    checkPermissions();
  } catch (error) {
    console.error('Error checking environment:', error);
    if (mounted.value) {
      cameraStatus.value = CameraStatus.UNKNOWN_ERROR;
      emit('videoLoaded', false);
    }
  }
}

async function checkPermissions() {
  try {
    // Try to access camera
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    });

    // Permission granted, stop the test stream
    stream.getTracks().forEach(track => track.stop());

    if (!mounted.value) return false;

    // Wait a bit before starting the actual scanner
    await new Promise(resolve => setTimeout(resolve, 500));

    if (!mounted.value) return false;

    cameraStatus.value = CameraStatus.READY;
    startScanning();
    return true;
  } catch (error) {
    console.error('Camera permission error:', error);
    if (!mounted.value) return false;

    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      cameraStatus.value = CameraStatus.PERMISSION_NEEDED;
      emit('videoLoaded', false, 'NO_WEBCAM_ACCESS');
      return false;
    } else if (error.name === 'NotFoundError') {
      cameraStatus.value = CameraStatus.NO_WEBCAM;
      emit('videoLoaded', false, 'NO_WEBCAM_FOUND');
    } else {
      cameraStatus.value = CameraStatus.UNKNOWN_ERROR;
      emit('videoLoaded', false);
    }
    return false;
  }
}

function getBrowserSettingsScheme() {
  if (typeof navigator.brave !== 'undefined') return 'brave';
  if (navigator.userAgent.includes('Edg/')) return 'edge';
  return 'chrome';
}

function openBrowserCameraSettings() {
  if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
    const scheme = getBrowserSettingsScheme();
    const extensionUrl = chrome.runtime.getURL('');
    chrome.tabs.create({ url: `${scheme}://settings/content/siteDetails?site=${encodeURIComponent(extensionUrl)}` });
  }
}

async function openCameraPermissionSettings() {
  // Try requesting permission again (works if user dismissed rather than explicitly denied)
  cameraStatus.value = CameraStatus.ACCESSING_CAMERA;
  const granted = await checkPermissions();
  if (granted || !mounted.value) return;

  if (cameraStatus.value === CameraStatus.PERMISSION_NEEDED) {
    // Permission is truly blocked - open browser site settings for this extension
    console.warn('[AnimatedQRScanner] Camera permission denied after retry, opening browser settings');
    openBrowserCameraSettings();
    permissionDenied.value = true;
  }
}

async function startScanning() {
  if (!video.value || !codeReader.value) {
    return;
  }

  const videoElement = video.value;

  // Set up canplay listener
  canplayListener.value = () => {
    canPlay.value = true;
    emit('videoLoaded', true);
  };
  videoElement.addEventListener('canplay', canplayListener.value);

  if (props.mode === 'text') {
    // Plain text QR scan — emit raw text string, no UR parsing
    try {
      scanControls.value = await codeReader.value.decodeFromVideoDevice(
        undefined,
        videoElement,
        (result, error) => {
          if (isDone.value) return;
          if (result) {
            isDone.value = true;
            emit('scan', result.getText());
            cleanup();
          }
          if (error && error.name !== 'NotFoundException') {
            console.debug('[AnimatedQRScanner] text mode scan error:', error.message);
          }
        }
      );
    } catch (error) {
      console.error('Error starting text scanner:', error);
      emit('error', error.message);
    }
    return;
  }

  // Keystone UR-encoded animated QR mode (default)
  const { handleScanSuccess, handleScanFailure } = getAnimatedScan({
    purpose: props.purpose,
    urTypes: props.urTypes,
    handleScan: onScanComplete,
    handleError: onScanError,
    onProgress: onScanProgress,
  });

  try {
    scanControls.value = await codeReader.value.decodeFromVideoDevice(
      undefined, // Use default camera
      videoElement,
      (result, error) => {
        if (isDone.value) return;

        if (result) {
          const qrText = result.getText();
          handleScanSuccess(qrText);
        }
        if (error && error.name !== 'NotFoundException') {
          // NotFoundException is normal when no QR code is in frame
          handleScanFailure(error.message);
        }
      }
    );
  } catch (error) {
    console.error('Error starting scanner:', error);
    onScanError(error.message);
  }
}

function onScanProgress(progressValue) {
  if (isDone.value) return; // Guard against late updates
  progress.value = progressValue;
  emit('progress', progressValue);
}

function onScanComplete(ur) {
  if (isDone.value) return;
  isDone.value = true;
  const urWithBuffer = {
    type: ur.type,
    cbor: typeof ur.cbor === 'string' ? Buffer.from(ur.cbor, 'hex') : ur.cbor
  };
  emit('scan', urWithBuffer);
  cleanup();
}

function onScanError(error) {
  if (isDone.value) return;

  // INVALID_QR_CODE errors are expected when scanning non-Keystone QR codes
  // Don't treat these as fatal errors - just continue scanning
  if (error === 'INVALID_QR_CODE') {
    console.debug('[AnimatedQRScanner] Invalid QR code detected (not a Keystone format), continuing scan...');
    return;
  }

  // Log unexpected errors for debugging
  console.error('[AnimatedQRScanner] Unexpected scan error:', error);

  // For actual errors, stop scanning and notify parent
  isDone.value = true;
  emit('error', error);
  cleanup();
}

function cleanup() {
  if (permissionChecker.value) {
    clearTimeout(permissionChecker.value);
    permissionChecker.value = null;
  }

  if (scanControls.value) {
    try {
      scanControls.value.stop();
    } catch (e) {
      console.error('Error stopping scan controls:', e);
    }
    scanControls.value = null;
  }

  if (video.value && canplayListener.value) {
    video.value.removeEventListener('canplay', canplayListener.value);
    canplayListener.value = null;
  }
}

function reset() {
  isDone.value = false;
  progress.value = 0;
  canPlay.value = false;
  permissionDenied.value = false;
  cameraStatus.value = CameraStatus.ACCESSING_CAMERA;
  cleanup();
  checkEnvironment();
}

// Lifecycle hooks
onMounted(() => {
  mounted.value = true;
  initializeScanner();
  checkEnvironment();
});

onBeforeUnmount(() => {
  mounted.value = false;
  cleanup();
});

// Expose methods to parent
defineExpose({
  reset,
});
</script>

<style scoped>
.animated-qr-scanner {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.scanner-status {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.status-message {
  text-align: center;
  padding: 20px;
}

.status-message p {
  margin: 0;
  font-size: 16px;
}

.status-message.error {
  color: #ff5252;
}

.status-message.permission-needed {
  color: rgba(255, 255, 255, 0.7);
}

.status-message.permission-needed .permission-text {
  color: rgba(255, 255, 255, 0.87);
  font-size: 16px;
  font-weight: 500;
}

.status-message.permission-needed .permission-hint {
  color: rgba(255, 255, 255, 0.5);
  font-size: 13px;
}

video {
  max-width: 100%;
  max-height: 100%;
}

.progress-container {
  position: absolute;
  bottom: 20px;
  left: 20px;
  right: 20px;
}
</style>
