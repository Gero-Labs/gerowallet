<template>
  <v-dialog v-model="open" max-width="584" persistent content-class="kyc-modal">
    <v-card class="modal-card">
      <div class="modal-content">
        <!-- Progress Steps -->
        <KYCProgress :current-step="currentStep" />

        <!-- Step 1: Upload ID -->
        <KYCStepFirst
          v-if="currentStep === 1"
          :uploaded-file="uploadedFile"
          :uploaded-file-url="uploadedFileUrl"
          @file-selected="handleFileSelect"
          @file-dropped="handleFileDrop"
        />

        <!-- Step 2: Take Selfie -->
        <KYCStepSecond
          v-if="currentStep === 2"
          :captured-photo="capturedPhoto"
          :is-camera-active="isCameraActive"
          @start-camera="startCamera"
          @capture-photo="capturePhoto"
          @retake-photo="retakePhoto"
          @video-loaded="onVideoLoaded"
          @video-error="onVideoError"
          @set-refs="setCameraRefs"
        />

        <!-- Actions -->
        <div class="modal-actions">
          <SecondaryButton text="Cancel" @click="closeModal" />
          <GradientButton :text="currentStep === 1 ? 'Next' : 'Submit'" @click="handleNext" />
        </div>
      </div>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import SecondaryButton from './SecondaryButton.vue';
import GradientButton from './GradientButton.vue';
import KYCProgress from './KYCSteps/KYCProgress.vue';
import KYCStepFirst from './KYCSteps/KYCStepFirst.vue';
import KYCStepSecond from './KYCSteps/KYCStepSecond.vue';

defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: 'close', value: boolean): void;
  (e: 'complete', value: boolean): void;
}>();

const currentStep = ref(1);
const uploadedFile = ref<File | null>(null);
const uploadedFileUrl = ref<string>('');
const capturedPhoto = ref<string>('');
const isCameraActive = ref(false);
const videoRef = ref<HTMLVideoElement>();
const canvasRef = ref<HTMLCanvasElement>();
let stream: MediaStream | null = null;

const closeModal = () => {
  currentStep.value = 1;
  uploadedFile.value = null;
  uploadedFileUrl.value = '';
  capturedPhoto.value = '';
  isCameraActive.value = false;
  stopCamera();
  emit('close', false);
};

const resetCameraState = () => {
  isCameraActive.value = false;
  capturedPhoto.value = '';
  stopCamera();
};

const setCameraRefs = (video: HTMLVideoElement | undefined, canvas: HTMLCanvasElement | undefined) => {
  videoRef.value = video;
  canvasRef.value = canvas;
  console.log('Camera refs set:', { video: !!video, canvas: !!canvas });
};

const handleFileSelect = (file: File) => {
  uploadedFile.value = file;
  uploadedFileUrl.value = URL.createObjectURL(file);
  console.log('File selected:', file);
};

const handleFileDrop = (file: File) => {
  uploadedFile.value = file;
  uploadedFileUrl.value = URL.createObjectURL(file);
  console.log('File dropped:', file);
};

const startCamera = async () => {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('getUserMedia is not supported');
    }

    console.log('Requesting camera access...');

    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }

    isCameraActive.value = true;

    const constraints = {
      video: {
        facingMode: 'user',
        width: { ideal: 640, min: 320, max: 1280 },
        height: { ideal: 480, min: 240, max: 720 },
      },
      audio: false,
    };

    try {
      console.log('Requesting camera with constraints:', constraints);
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('Camera stream obtained:', stream);
    } catch (error) {
      console.log('Primary constraints failed, trying basic video...');
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        console.log('Basic video stream obtained');
      } catch (basicError) {
        console.log('Basic constraints failed, trying environment camera...');
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        console.log('Environment camera stream obtained');
      }
    }

    if (videoRef.value && stream) {
      console.log('Setting video srcObject');
      videoRef.value.srcObject = stream;

      await new Promise<void>((resolve, reject) => {
        if (videoRef.value) {
          videoRef.value.onloadedmetadata = () => {
            console.log('Video metadata loaded');
            resolve();
          };
          videoRef.value.onerror = reject;
        }
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      if (videoRef.value) {
        await videoRef.value.play();
        console.log('Video playback started');
      }
    } else {
      console.error('Video ref or stream not available');
      isCameraActive.value = false;
    }
  } catch (error) {
    console.error('Error accessing camera:', error);
    isCameraActive.value = false;

    let errorMessage = 'Unable to access camera. ';
    if (error instanceof Error) {
      if (error.name === 'NotAllowedError') {
        errorMessage += 'Please allow camera access in your browser settings.';
      } else if (error.name === 'NotFoundError') {
        errorMessage += 'No camera found on your device.';
      } else if (error.name === 'NotSupportedError') {
        errorMessage += 'Camera is not supported in this browser.';
      } else {
        errorMessage += error.message;
      }
    }

    alert(errorMessage);
  }
};

const stopCamera = () => {
  if (stream) {
    stream.getTracks().forEach(track => {
      track.stop();
      console.log('Camera track stopped:', track.kind);
    });
    stream = null;
  }
  if (videoRef.value) {
    videoRef.value.srcObject = null;
  }
  isCameraActive.value = false;

};

const capturePhoto = () => {
  if (videoRef.value && canvasRef.value && stream) {
    const video = videoRef.value;
    const canvas = canvasRef.value;
    const context = canvas.getContext('2d');

    if (context) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      capturedPhoto.value = canvas.toDataURL('image/jpeg');
      stopCamera();
      console.log('Photo captured');
    }
  } else {
    console.error('Cannot capture photo: missing video, canvas, or stream');
  }
};

const onVideoLoaded = () => {
  console.log('Video loaded successfully');
};

const onVideoError = (error: Event) => {
  console.error('Video error:', error);
  isCameraActive.value = false;
  alert('Error loading camera stream. Please try again.');
};

const retakePhoto = () => {
  capturedPhoto.value = '';
  startCamera();
};

const handleNext = () => {
  if (currentStep.value === 1) {
    if (uploadedFile.value) {
      resetCameraState();
      currentStep.value = 2;
    } else {
      alert('Please upload an ID document first.');
    }
  } else if (currentStep.value === 2) {
    if (capturedPhoto.value) {
      // Set KYC status to pending
      localStorage.setItem('kycStatus', 'pending');
      
      emit('complete', true);
      closeModal();
    } else {
      alert('Please take a photo first.');
    }
  }
};
</script>

<style lang="scss" scoped>
@import '../styles/variables';
@import '../styles/mixins';

.kyc-modal {
  border-radius: $border-radius-lg;
}

.modal-card {
  background: $background-dark;
  border-radius: $border-radius-lg;
  box-shadow: $shadow-lg;
  position: relative;
}

.modal-content {
  padding: $spacing-2xl;
}

.modal-actions {
  display: flex;
  gap: $spacing-md;
  width: 100%;
  margin-top: $spacing-sm;
  padding: 0 $spacing-2xl $spacing-2xl;
}

.modal-actions :deep(.secondary-button),
.modal-actions :deep(.gradient-button) {
  flex: 1;
  width: 100%;
  height: 44px;
  font-size: $font-size-base;
  font-weight: $font-weight-semibold;
  text-transform: none;
}

@media (max-width: $breakpoint-md) {
  .modal-actions {
    padding: 0 $spacing-lg $spacing-lg;
  }

  .modal-actions :deep(.secondary-button),
  .modal-actions :deep(.gradient-button) {
    height: 40px;
    font-size: $font-size-sm;
  }
}
</style>
