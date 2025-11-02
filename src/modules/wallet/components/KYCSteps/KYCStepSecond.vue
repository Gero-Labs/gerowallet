<template>
  <div class="step-content">
    <div class="modal-header">
      <h2 class="modal-title">{{ $t('navigation.takeSelfie') }}</h2>
      <p class="modal-subtitle">{{ $t('navigation.realTimeFaceScan') }}</p>
    </div>

    <div class="camera-section">
      <!-- Show captured photo if exists -->
      <div v-if="capturedPhoto" class="captured-photo">
        <img :src="capturedPhoto" :alt="$t('card.capturedPhoto')" class="photo-image" />
        <div class="photo-actions">
          <button class="retake-btn" @click="retakePhoto">{{ $t('navigation.retakePhoto') }}</button>
        </div>
      </div>

      <!-- Camera interface -->
      <div v-else class="camera-area">
        <!-- Video preview -->
        <video
          v-if="isCameraActive"
          ref="videoRef"
          autoplay
          playsinline
          muted
          class="camera-video"
          @loadedmetadata="onVideoLoaded"
          @error="onVideoError"
          @canplay="initializeVideo"
        ></video>

        <!-- Camera icon when not active -->
        <div v-else class="camera-icon" @click="startCamera()">
          <img src="@/modules/wallet/icons/camera.svg" :alt="$t('common.camera')" />
        </div>

        <div class="camera-text">
          <span v-if="!isCameraActive" class="camera-action" @click="startCamera()">{{ $t('navigation.switchOnCamera') }}</span>
          <span v-else class="camera-action">{{ $t('navigation.positionFaceInFrame') }}</span>
        </div>

        <!-- Capture button when camera is active -->
        <button v-if="isCameraActive" class="capture-btn" @click="capturePhoto">
          <img src="@/modules/wallet/icons/capture.svg" :alt="$t('common.capture')" />
        </button>
      </div>

      <!-- Hidden canvas for capturing -->
      <canvas ref="canvasRef" style="display: none"></canvas>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';

interface Props {
  capturedPhoto: string;
  isCameraActive: boolean;
}

interface Emits {
  (e: 'start-camera'): void;
  (e: 'capture-photo'): void;
  (e: 'retake-photo'): void;
  (e: 'video-loaded'): void;
  (e: 'video-error', error: Event): void;
  (e: 'set-refs', videoRef: HTMLVideoElement | undefined, canvasRef: HTMLCanvasElement | undefined): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const videoRef = ref<HTMLVideoElement>();
const canvasRef = ref<HTMLCanvasElement>();

onMounted(() => {
  emit('set-refs', videoRef.value, canvasRef.value);
});

watch(
  () => props.isCameraActive,
  newValue => {
    if (newValue) {
      setTimeout(() => {
        emit('set-refs', videoRef.value, canvasRef.value);
      }, 100);
    }
  }
);

const startCamera = () => {
  emit('start-camera');
};

const capturePhoto = () => {
  emit('capture-photo');
};

const retakePhoto = () => {
  emit('retake-photo');
};

const onVideoLoaded = () => {
  emit('video-loaded');
  console.log('Video loaded successfully in KYCStep2');
};

const onVideoError = (error: Event) => {
  emit('video-error', error);
  console.error('Video error in KYCStep2:', error);
};

const initializeVideo = () => {
  if (videoRef.value) {
    videoRef.value.play().catch(error => {
      console.error('Error playing video in KYCStep2:', error);
    });
  }
};
</script>

<style lang="scss" scoped>
@import '../../styles/variables';
@import '../../styles/mixins';

.step-content {
  width: 100%;
  padding: $spacing-3xl;
}

.modal-header {
  margin-bottom: $spacing-3xl;
}

.modal-title {
  @include heading-style($font-size-2xl);
  color: $text-primary;
  margin: 0 0 $spacing-sm 0;
}

.modal-subtitle {
  @include body-text($font-size-base);
  color: $text-muted;
  margin: 0;
}

.camera-section {
  width: 100%;
}

.camera-area {
  border: 1px solid $border-secondary;
  border-radius: $border-radius-lg;
  padding: $spacing-lg $spacing-2xl;
  min-height: 169px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: $spacing-md;
  cursor: pointer;
  transition: all 0.3s ease;
}

.camera-area:hover {
  border-color: $border-primary;
}

.camera-icon {
  width: 40px;
  height: 40px;
  background: $background-card;
  border: 1px solid $border-primary;
  border-radius: $border-radius-md;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: $shadow-button;
}

.camera-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: $spacing-xs;
}

.camera-action {
  @include text-style($font-size-sm, $font-weight-semibold);
  color: $text-secondary;
  cursor: pointer;
  transition: color 0.3s ease;
}

.camera-action:hover {
  color: $primary-cyan;
}

.camera-video {
  width: 100%;
  height: 220px;
  border-radius: $border-radius-md;
  object-fit: cover;
  background: $background-card;
  display: block;
}

.capture-btn {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: $primary-cyan;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
  box-shadow: 0 4px 12px rgba($primary-cyan, 0.3);
}

.capture-btn:hover {
  transform: scale(1.05);
  box-shadow: 0 6px 16px rgba($primary-cyan, 0.4);
}

.captured-photo {
  border: 1px solid $border-secondary;
  border-radius: $border-radius-lg;
  padding: $spacing-lg;
  min-height: 169px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: $spacing-md;
}

.photo-image {
  max-width: 100%;
  max-height: 220px;
  object-fit: cover;
  border-radius: $border-radius-md;
}

.photo-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: $spacing-sm;
}

.retake-btn {
  background: $background-card;
  border: 1px solid $border-primary;
  border-radius: $border-radius-sm;
  padding: $spacing-xs $spacing-md;
  @include text-style($font-size-xs, $font-weight-semibold);
  color: $text-secondary;
  cursor: pointer;
  transition: all 0.3s ease;
}

.retake-btn:hover {
  border-color: $primary-cyan;
  color: $primary-cyan;
}
</style>
