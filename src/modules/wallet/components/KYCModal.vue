<template>
  <v-dialog v-model="open" max-width="584" persistent content-class="kyc-modal">
    <v-card class="modal-card">
      <div class="modal-content">
        <!-- Progress Steps -->
        <div class="progress-section">
          <div class="progress-container">
            <div class="progress-lines">
              <div class="progress-line" :class="{ active: currentStep >= 2 }"></div>
              <div class="progress-line" :class="{ active: currentStep >= 3 }"></div>
            </div>

            <!-- Step 1: Your Details -->
            <div class="step-item">
              <div class="step-icon" :class="{ active: currentStep >= 1 }">
                <div class="step-dot"></div>
              </div>
              <span class="step-text">Your Details </span>
            </div>

            <!-- Step 2: Take a selfie -->
            <div class="step-item">
              <div class="step-icon" :class="{ active: currentStep >= 2 }">
                <div class="step-dot"></div>
              </div>
              <span class="step-text">Take a selfie</span>
            </div>

            <!-- Step 3: Pending Approval -->
            <div class="step-item">
              <div class="step-icon" :class="{ active: currentStep >= 3 }">
                <div class="step-dot"></div>
              </div>
              <span class="step-text">Pending Approval</span>
            </div>
          </div>
        </div>

        <!-- Step 1: Upload ID -->
        <div v-if="currentStep === 1" class="step-content">
          <div class="modal-header">
            <h2 class="modal-title">Upload Your ID</h2>
            <p class="modal-subtitle">Government issued ID only (Passport, Driving License)</p>
          </div>

          <div class="upload-section">
            <!-- Show uploaded file if exists -->
            <div v-if="uploadedFileUrl" class="uploaded-file">
              <img :src="uploadedFileUrl" alt="Uploaded ID" class="uploaded-image" />
              <div class="file-info">
                <span class="file-name">{{ uploadedFile?.name }}</span>
                <button class="change-file-btn" @click="triggerFileUpload">Change File</button>
              </div>
            </div>

            <!-- Upload area if no file -->
            <div v-else class="upload-area" @click="triggerFileUpload" @drop="handleFileDrop" @dragover.prevent>
              <div class="upload-icon">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M6.6665 13.3333L9.99984 10M9.99984 10L13.3332 13.3333M9.99984 10V17.5M16.6665 13.9524C17.6844 13.1117 18.3332 11.8399 18.3332 10.4167C18.3332 7.88536 16.2811 5.83333 13.7498 5.83333C13.5677 5.83333 13.3974 5.73833 13.3049 5.58145C12.2182 3.73736 10.2119 2.5 7.9165 2.5C4.46472 2.5 1.6665 5.29822 1.6665 8.75C1.6665 10.4718 2.36271 12.0309 3.48896 13.1613"
                    stroke="#CECFD2"
                    stroke-width="1.66667"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </div>
              <div class="upload-text">
                <span class="upload-action">Click to upload</span>
                <span class="upload-hint">or drag and drop</span>
              </div>
              <p class="upload-info">SVG, PNG, JPG or GIF (max. 800x400px)</p>
            </div>
            <input ref="fileInput" type="file" accept="image/*" @change="handleFileSelect" style="display: none" />
          </div>
        </div>

        <!-- Step 2: Take Selfie -->
        <div v-if="currentStep === 2" class="step-content">
          <div class="modal-header">
            <h2 class="modal-title">Take a Selfie</h2>
            <p class="modal-subtitle">Real-time face scan to match ID</p>
          </div>

          <div class="camera-section">
            <!-- Show captured photo if exists -->
            <div v-if="capturedPhoto" class="captured-photo">
              <img :src="capturedPhoto" alt="Captured Photo" class="photo-image" />
              <div class="photo-actions">
                <button
                  class="retake-btn"
                  @click="
                    capturedPhoto = '';
                    startCamera();
                  "
                >
                  Retake Photo
                </button>
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
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M10 4V16M4 10H16"
                    stroke="#CECFD2"
                    stroke-width="1.67"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </div>

              <div class="camera-text">
                <span v-if="!isCameraActive" class="camera-action" @click="startCamera()">Switch on your camera</span>
                <span v-else class="camera-action">Position your face in the frame</span>
              </div>

              <!-- Capture button when camera is active -->
              <button v-if="isCameraActive" class="capture-btn" @click="capturePhoto">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="12" cy="12" r="10" stroke="#FFFFFF" stroke-width="2" />
                  <circle cx="12" cy="12" r="6" fill="#FFFFFF" />
                </svg>
              </button>
            </div>

            <!-- Hidden canvas for capturing -->
            <canvas ref="canvasRef" style="display: none"></canvas>
          </div>
        </div>

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
import { ref, computed } from 'vue';
import SecondaryButton from './SecondaryButton.vue';
import GradientButton from './GradientButton.vue';

defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: 'close', value: boolean): void;
  (e: 'complete', value: boolean): void;
}>();

const currentStep = ref(1);
const fileInput = ref<HTMLInputElement>();
const uploadedFile = ref<File | null>(null);
const uploadedFileUrl = ref<string>('');
const capturedPhoto = ref<string>('');
const isCameraActive = ref(false);
const videoRef = ref<HTMLVideoElement>();
const canvasRef = ref<HTMLCanvasElement>();

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

const triggerFileUpload = () => {
  fileInput.value?.click();
};

const handleFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement;
  if (target.files && target.files.length > 0) {
    const file = target.files[0];
    uploadedFile.value = file;
    uploadedFileUrl.value = URL.createObjectURL(file);
    console.log('File selected:', file);
  }
};

const handleFileDrop = (event: DragEvent) => {
  event.preventDefault();
  const files = event.dataTransfer?.files;
  if (files && files.length > 0) {
    const file = files[0];
    uploadedFile.value = file;
    uploadedFileUrl.value = URL.createObjectURL(file);
    console.log('File dropped:', file);
  }
};

const startCamera = async () => {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('getUserMedia is not supported');
    }

    console.log('Requesting camera access...');

    isCameraActive.value = true;

    const constraints = {
      video: {
        facingMode: 'user',
        width: { ideal: 640, min: 320, max: 1280 },
        height: { ideal: 480, min: 240, max: 720 },
      },
      audio: false,
    };

    let stream;
    try {
      console.log('Full constraints...');
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('Full constraints success');
    } catch (error) {
      console.log('Full constraints failed, trying basic video...');
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch (basicError) {
        console.log('Basic constraints failed, trying any camera...');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      }
    }

    if (videoRef.value) {
      videoRef.value.srcObject = stream;

      await new Promise(resolve => {
        if (videoRef.value) {
          videoRef.value.onloadedmetadata = resolve;
        }
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      await videoRef.value.play();
      console.log('Camera started successfully');
    }
  } catch (error) {
    console.error('Error accessing camera:', error);

    isCameraActive.value = false;

    let errorMessage = 'Unable to access camera. ';
    if (error instanceof Error) {
      if (error.name === 'NotAllowedError') {
        errorMessage +=
          'Please allow camera access in your browser settings. For Chrome Extension, check manifest permissions.';
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
  if (videoRef.value && videoRef.value.srcObject) {
    const stream = videoRef.value.srcObject as MediaStream;
    stream.getTracks().forEach(track => track.stop());
    videoRef.value.srcObject = null;
    isCameraActive.value = false;
  }
};

const capturePhoto = () => {
  if (videoRef.value && canvasRef.value) {
    const video = videoRef.value;
    const canvas = canvasRef.value;
    const context = canvas.getContext('2d');

    if (context) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      capturedPhoto.value = canvas.toDataURL('image/jpeg');
      stopCamera();
    }
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

const initializeVideo = () => {
  if (videoRef.value && isCameraActive.value) {
    videoRef.value.play().catch(error => {
      console.error('Error playing video:', error);
    });
  }
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
      console.log('KYC submitted');
      emit('complete', true);
      closeModal();
    } else {
      alert('Please take a photo first.');
    }
  }
};
</script>

<style scoped>
.kyc-modal {
  border-radius: 12px;
}

.modal-card {
  background: #0c0e12;
  border-radius: 12px;
  box-shadow: 0px 3px 3px -1.5px rgba(255, 255, 255, 0), 0px 8px 8px -4px rgba(255, 255, 255, 0),
    0px 20px 24px -4px rgba(255, 255, 255, 0);
  position: relative;
}

.modal-content {
  padding: 24px;
}

/* Progress Steps */
.progress-section {
  margin-bottom: 20px;
}

.progress-container {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 16px;
  width: 501px;
  margin: 0 auto;
}

.progress-lines {
  position: absolute;
  top: 11px;
  height: 2px;
  display: flex;
  gap: 0;
}

.progress-line {
  width: 165px;
  height: 2px;
  background: #373a41;
}

.progress-line.active {
  background: linear-gradient(91deg, #00c7f3 40.76%, #00ffd1 103.06%);
}

.step-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 172px;
}

.step-icon {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #13161b;
  border: 1.5px solid #22262f;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.step-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #61656c;
}

.step-icon.active .step-dot {
  background: #ffffff;
}
.step-icon.active {
  background: #00dff3;
}

.step-text {
  font-family: Inter, sans-serif;
  font-weight: 600;
  font-size: 14px;
  line-height: 1.43;
  color: #cecfd2;
  text-align: center;
}

/* Step Content */
.step-content {
  width: 100%;
  padding: 32px;
}

.modal-header {
  margin-bottom: 32px;
}

.modal-title {
  font-family: Inter, sans-serif;
  font-weight: 600;
  font-size: 24px;
  line-height: 1.17;
  color: #f7f7f7;
  margin: 0 0 8px 0;
}

.modal-subtitle {
  font-family: Inter, sans-serif;
  font-weight: 400;
  font-size: 16px;
  line-height: 1.5;
  color: #94979c;
  margin: 0;
}

/* Upload Section */
.upload-section {
  width: 100%;
}

.upload-area {
  border: 1px solid #22262f;
  border-radius: 12px;
  padding: 16px 24px;
  min-height: 169px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  cursor: pointer;
  transition: all 0.3s ease;
}

.upload-area:hover {
  border-color: #373a41;
}

.upload-icon {
  width: 40px;
  height: 40px;
  background: #13161b;
  border: 1px solid #373a41;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0px 1px 2px 0px rgba(255, 255, 255, 0), inset 0px -2px 0px 0px rgba(12, 14, 18, 0.05),
    inset 0px 0px 0px 1px rgba(12, 14, 18, 0.18);
}

.upload-text {
  display: flex;
  align-items: center;
  gap: 4px;
}

.upload-action {
  font-family: Inter, sans-serif;
  font-weight: 600;
  font-size: 14px;
  line-height: 1.43;
  color: #cecfd2;
}

.upload-hint {
  font-family: Inter, sans-serif;
  font-weight: 400;
  font-size: 14px;
  line-height: 1.43;
  color: #94979c;
}

.upload-info {
  font-family: Inter, sans-serif;
  font-weight: 400;
  font-size: 12px;
  line-height: 1.5;
  color: #94979c;
  text-align: center;
  margin: 0;
}

/* Uploaded File Display */
.uploaded-file {
  border: 1px solid #22262f;
  border-radius: 12px;
  padding: 16px;
  min-height: 169px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.uploaded-image {
  max-width: 100%;
  max-height: 120px;
  object-fit: contain;
  border-radius: 8px;
}

.file-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.file-name {
  font-family: Inter, sans-serif;
  font-weight: 600;
  font-size: 14px;
  color: #cecfd2;
  text-align: center;
}

.change-file-btn {
  background: #13161b;
  border: 1px solid #373a41;
  border-radius: 6px;
  padding: 6px 12px;
  font-family: Inter, sans-serif;
  font-weight: 600;
  font-size: 12px;
  color: #cecfd2;
  cursor: pointer;
  transition: all 0.3s ease;
}

.change-file-btn:hover {
  border-color: #00dff3;
  color: #00dff3;
}

/* Camera Section */
.camera-section {
  width: 100%;
}

.camera-area {
  border: 1px solid #22262f;
  border-radius: 12px;
  padding: 16px 24px;
  min-height: 169px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  cursor: pointer;
  transition: all 0.3s ease;
}

.camera-area:hover {
  border-color: #373a41;
}

.camera-icon {
  width: 40px;
  height: 40px;
  background: #13161b;
  border: 1px solid #373a41;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0px 1px 2px 0px rgba(255, 255, 255, 0), inset 0px -2px 0px 0px rgba(12, 14, 18, 0.05),
    inset 0px 0px 0px 1px rgba(12, 14, 18, 0.18);
}

.camera-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.camera-action {
  font-family: Inter, sans-serif;
  font-weight: 600;
  font-size: 14px;
  line-height: 1.43;
  color: #cecfd2;
  cursor: pointer;
  transition: color 0.3s ease;
}

.camera-action:hover {
  color: #00dff3;
}

/* Camera Video */
.camera-video {
  width: 100%;
  height: 220px;
  border-radius: 8px;
  object-fit: cover;
  background: #13161b;
}

/* Capture Button */
.capture-btn {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #00dff3;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
  box-shadow: 0 4px 12px rgba(0, 223, 243, 0.3);
}

.capture-btn:hover {
  transform: scale(1.05);
  box-shadow: 0 6px 16px rgba(0, 223, 243, 0.4);
}

/* Captured Photo */
.captured-photo {
  border: 1px solid #22262f;
  border-radius: 12px;
  padding: 16px;
  min-height: 169px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.photo-image {
  max-width: 100%;
  max-height: 120px;
  object-fit: cover;
  border-radius: 8px;
}

.photo-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.retake-btn {
  background: #13161b;
  border: 1px solid #373a41;
  border-radius: 6px;
  padding: 6px 12px;
  font-family: Inter, sans-serif;
  font-weight: 600;
  font-size: 12px;
  color: #cecfd2;
  cursor: pointer;
  transition: all 0.3s ease;
}

.retake-btn:hover {
  border-color: #00dff3;
  color: #00dff3;
}

/* Actions */
.modal-actions {
  display: flex;
  gap: 12px;
  width: 100%;
  margin-top: 8px;
  padding: 0 24px 24px;
}

.modal-actions :deep(.secondary-button),
.modal-actions :deep(.gradient-button) {
  flex: 1;
  width: 100%;
  height: 44px;
  font-size: 16px;
  font-weight: 600;
  text-transform: none;
}

@media (max-width: 768px) {
  .progress-container {
    width: 100%;
    gap: 8px;
  }

  .step-item {
    width: auto;
  }

  .progress-lines {
    display: none;
  }

  .modal-actions {
    padding: 0 16px 16px;
  }

  .modal-actions :deep(.secondary-button),
  .modal-actions :deep(.gradient-button) {
    height: 40px;
    font-size: 14px;
  }
}
</style>
