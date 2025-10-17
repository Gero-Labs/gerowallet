<template>
  <v-dialog v-model="open" max-width="1150" persistent content-class="kaiserex-registration-modal">
    <v-card class="modal-card">
      <div class="modal-content">
        <div class="content-wrapper" v-if="!registrationComplete">
          <!-- Close button positioned absolutely -->
          <v-btn icon small @click="closeModal" class="modal-close-btn">
            <v-icon>mdi-close</v-icon>
          </v-btn>

          <!-- Registration iframe -->
          <div class="iframe-container">
            <iframe
              ref="registrationIframe"
              :src="iframeUrl"
              title="Kaiserex Registration"
              class="registration-iframe"
              @load="onIframeLoad"
              sandbox="allow-forms allow-scripts allow-same-origin allow-popups"
              scrolling="yes"
            />
            <div v-if="isLoading" class="loading-overlay">
              <v-progress-circular indeterminate color="primary" size="48" />
              <p class="loading-text">Loading secure registration form...</p>
            </div>
          </div>
        </div>

        <div v-else class="completion-message">
          <div class="success-icon">
            <img src="@/modules/wallet/icons/check-blue.svg" alt="Success" />
          </div>
          <h3 class="success-title">Registration Complete!</h3>
          <p class="success-text">
            Your Kaiserex account has been created. You can now proceed with the KYC verification
            to order your Gero Crypto Card.
          </p>
          <GradientButton text="Continue to KYC" @click="proceedToKYC" />
        </div>
      </div>

    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import SecondaryButton from './SecondaryButton.vue';
import GradientButton from './GradientButton.vue';
import { debugLog } from '@/utils/debug';

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'complete'): void;
}>();

const registrationIframe = ref<HTMLIFrameElement>();
const isLoading = ref(true);
const iframeLoaded = ref(false);
const registrationComplete = ref(false);

// Registration URL
const iframeUrl = 'https://www.kaiserex.com/gerocard';

// Reset state when modal opens
watch(() => props.open, (newVal) => {
  if (newVal) {
    isLoading.value = true;
    iframeLoaded.value = false;
    registrationComplete.value = false;
    debugLog('Kaiserex registration modal opened');

    // Force iframe reload by changing the src slightly to prevent caching issues
    nextTick(() => {
      if (registrationIframe.value) {
        const timestamp = Date.now();
        registrationIframe.value.src = `${iframeUrl}?_t=${timestamp}`;
      }
    });

    // Fallback timeout in case iframe load event doesn't fire
    setTimeout(() => {
      if (isLoading.value && newVal) { // Only if still loading and modal is still open
        console.warn('Iframe load timeout, hiding loading state');
        isLoading.value = false;
        iframeLoaded.value = true;
      }
    }, 5000); // 5 second timeout
  }
});

const onIframeLoad = () => {
  isLoading.value = false;
  iframeLoaded.value = true;
  debugLog('Kaiserex registration iframe loaded');

  // Don't inject any CSS - let the iframe scroll naturally on smaller screens
};

const closeModal = () => {
  if (registrationComplete.value ||
      confirm('Are you sure you want to cancel? You need to complete registration to order your Gero Card.')) {
    emit('close');
  }
};

const confirmRegistration = () => {
  // Show confirmation dialog
  if (confirm('Have you successfully completed your Kaiserex registration?')) {
    registrationComplete.value = true;
    // Store registration status
  }
};


const proceedToKYC = () => {
  emit('complete');
};
</script>

<style lang="scss" scoped>
@import '../styles/variables';
@import '../styles/mixins';

.kaiserex-registration-modal {
  border-radius: $border-radius-lg;
}

.modal-card {
  background: $background-dark;
  border-radius: $border-radius-lg;
  box-shadow: $shadow-lg;
  position: relative;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.modal-close-btn {
  position: absolute !important;
  top: $spacing-md; // Position at top of modal
  right: $spacing-md;
  z-index: 10;
  color: $text-secondary;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 50%;

  &:hover {
    color: $text-primary;
    background: rgba(0, 0, 0, 0.7);
  }
}

.modal-content {
  flex: 1;
  overflow: hidden;
  position: relative;
  padding: 0;
}

.content-wrapper {
  display: flex;
  flex-direction: column;
  position: relative; // For close button positioning
}

.iframe-container {
  position: relative;
  width: 100%;
  max-width: 1150px; // 1800 * 0.73
  height: 876px; // 1200 * 0.73 (scaled height of iframe)
  margin: 0 auto;
  background: transparent;
  border-radius: 0;
  overflow: hidden;
  border: none;
  display: flex;
  align-items: flex-start;
  justify-content: center;
}

.registration-iframe {
  width: 1800px; // Original content width
  height: 1200px; // Original content height
  border: none;
  background: white;
  display: block;
  transform: scale(0.73) translateY(0px);
  transform-origin: center top;
  flex-shrink: 0;
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(12, 17, 29, 0.95);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: $spacing-xl;
  z-index: 10;
}

.loading-text {
  @include body-text($font-size-base);
  color: $text-secondary;
}

.completion-message {
  padding: $spacing-4xl $spacing-2xl;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: $spacing-xl;
}

.success-icon {
  width: 64px;
  height: 64px;
  background: rgba(0, 199, 243, 0.1);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;

  img {
    width: 32px;
    height: 32px;
  }
}

.success-title {
  @include heading-style($font-size-xl);
  color: $text-primary;
  margin: 0;
}

.success-text {
  @include body-text($font-size-base);
  color: $text-secondary;
  max-width: 400px;
  line-height: 1.5;
  margin: 0;
}

.trust-header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  margin-bottom: $spacing-lg;
}

// Removed old tooltip CSS since we're using v-tooltip now

@media (max-width: $breakpoint-md) {
  .kaiserex-registration-modal {
    max-height: 100vh;
  }
}
</style>
