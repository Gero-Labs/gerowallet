<template>
  <v-dialog v-model="open" max-width="1200" persistent content-class="kaiserex-registration-modal">
    <v-card class="modal-card">
      <div class="modal-content">
        <div class="content-wrapper" v-if="!registrationComplete">
          <!-- Close button positioned absolutely -->
          <v-btn icon small @click="closeModal" class="modal-close-btn">
            <v-icon>mdi-close</v-icon>
          </v-btn>
          
          <!-- Left side: Trust information -->
          <div class="trust-section">
            <div class="trust-header">
              <h2 class="section-title">Create Your Kaiserex Account</h2>
              <!-- Subheader text for responsive view (hidden on desktop) -->
              <p class="section-subtitle">
                Kaiserex is Gero's trusted financial partner for card issuance and KYC processing. 
                Your Gero Crypto Card will be issued through their secure platform.
              </p>
            </div>
            
            <!-- Desktop trust information (hidden on smaller screens) -->
            <div class="desktop-trust-content">
              <p class="section-description">
                Kaiserex is Gero's trusted financial partner for card issuance and KYC processing. 
                Your Gero Crypto Card will be issued through their secure platform.
              </p>
              
              <div class="trust-indicators">
                <div class="trust-item">
                  <img src="@/modules/wallet/icons/check-blue.svg" alt="check" class="check-icon" />
                  <span class="trust-text">Official Gero Financial Partner</span>
                </div>
                <div class="trust-item">
                  <img src="@/modules/wallet/icons/check-blue.svg" alt="check" class="check-icon" />
                  <span class="trust-text">Institution-Grade Security & Encryption</span>
                </div>
                <div class="trust-item">
                  <img src="@/modules/wallet/icons/check-blue.svg" alt="check" class="check-icon" />
                  <span class="trust-text">GDPR Compliant Data Protection</span>
                </div>
              </div>
            </div>
            
            <!-- Info box with tooltip - always visible -->
            <v-tooltip top>
              <template v-slot:activator="{ on, attrs }">
                <div class="info-box" v-bind="attrs" v-on="on">
                  <img src="@/modules/wallet/icons/info.svg" alt="Info" class="info-icon" />
                  <p class="info-text">
                    After completing registration, you'll return here to finish the KYC verification 
                    process for your Gero Card.
                  </p>
                </div>
              </template>
              <span>Complete registration to proceed with KYC verification</span>
            </v-tooltip>
          </div>

          <!-- Right side: Registration iframe -->
          <div 
            class="iframe-container"
            :style="{
              '--header-gradient-height': headerGradientHeight + 'px',
              '--footer-gradient-height': footerGradientHeight + 'px',
              '--header-fade-amount': headerFadeAmount + '%',
              '--footer-fade-amount': footerFadeAmount + '%'
            }"
          >
            
            <iframe
              ref="registrationIframe"
              :src="iframeUrl"
              title="Kaiserex Registration"
              class="registration-iframe"
              :class="{ 'mobile-scrollable': isStackedLayout }"
              :style="{ 
                top: iframeTopPosition + 'px',
                transform: `translateX(-50%) scale(${iframeScale})` 
              }"
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

      <div class="modal-footer" v-if="!registrationComplete">
        <div class="modal-actions">
          <SecondaryButton text="Cancel" @click="closeModal" />
          <GradientButton 
            text="I've Completed Registration" 
            @click="confirmRegistration"
            :disabled="!iframeLoaded"
          />
        </div>
      </div>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted, nextTick } from 'vue';
import SecondaryButton from './SecondaryButton.vue';
import GradientButton from './GradientButton.vue';

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
// Optimized iframe positioning values (from controller testing)
const iframeTopPosition = ref(-30);
const iframeScale = ref(0.75);
const headerGradientHeight = ref(50);
const footerGradientHeight = ref(30);
const headerFadeAmount = ref(90);
const footerFadeAmount = ref(60);
const isStackedLayout = ref(window.innerWidth <= 1280); // Track if layout is stacked (matches $breakpoint-lg)

// Registration URL
const iframeUrl = 'https://www.kaiserex.com/registration/personal#registerShortApp';

// Reset state when modal opens
watch(() => props.open, (newVal) => {
  if (newVal) {
    isLoading.value = true;
    iframeLoaded.value = false;
    registrationComplete.value = false;
    console.debug('Kaiserex registration modal opened');
    
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
  console.debug('Kaiserex registration iframe loaded');
  
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
    localStorage.setItem('kaiserexRegistered', 'true');
  }
};


const proceedToKYC = () => {
  emit('complete');
};


// Handle window resize to update layout detection
const handleResize = () => {
  isStackedLayout.value = window.innerWidth <= 1280;
};

onMounted(() => {
  window.addEventListener('resize', handleResize);
});

onUnmounted(() => {
  window.removeEventListener('resize', handleResize);
});
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
  top: $spacing-lg;
  right: $spacing-lg;
  z-index: 10;
  color: $text-secondary;
  
  &:hover {
    color: $text-primary;
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
  gap: $spacing-3xl;
  height: 700px; // Fixed height for better form visibility
  padding: $spacing-3xl; // Increased padding since no header
  position: relative; // For close button positioning
}

.trust-section {
  flex: 0 0 400px; // Fixed width for left panel
  display: flex;
  flex-direction: column;
  gap: $spacing-xl;
  padding-right: $spacing-xl;
  border-right: 1px solid rgba(255, 255, 255, 0.1);
}

.section-title {
  @include heading-style($font-size-2xl);
  color: $text-primary;
  margin: 0;
  line-height: 1.2;
}

.section-subtitle {
  @include body-text($font-size-base);
  color: $text-secondary;
  margin: $spacing-md 0 0 0;
  line-height: 1.5;
  display: none; // Hidden on desktop by default
}

.section-description {
  @include body-text($font-size-base);
  color: $text-secondary;
  margin: 0;
  line-height: 1.5;
}

.trust-indicators {
  display: flex;
  flex-direction: column;
  gap: $spacing-md;
  margin: $spacing-lg 0;
}

.trust-item {
  display: flex;
  align-items: center;
  gap: $spacing-md;
  padding: $spacing-sm $spacing-md;
  background: rgba(0, 199, 243, 0.05);
  border-radius: $border-radius-md;
  border: 1px solid rgba(0, 199, 243, 0.1);
  transition: all 0.2s ease;
  
  &:hover {
    background: rgba(0, 199, 243, 0.08);
    border-color: rgba(0, 199, 243, 0.2);
  }
}

.check-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.trust-text {
  @include body-text($font-size-base);
  color: $text-primary;
  line-height: 1.4;
}

.info-box {
  margin-top: $spacing-xl; // Add spacing from content above
  display: flex;
  gap: $spacing-sm;
  padding: $spacing-md;
  background: rgba(255, 199, 0, 0.05);
  border: 1px solid rgba(255, 199, 0, 0.2);
  border-radius: $border-radius-md;
  align-items: flex-start;
  cursor: help; // Show help cursor on hover
}

.info-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  margin-top: 2px;
}

.info-text {
  @include body-text($font-size-sm);
  color: rgba(255, 199, 0, 0.9);
  line-height: 1.4;
  margin: 0;
}

.iframe-container {
  position: relative;
  flex: 1; // Take remaining space
  height: 100%; // Full height of content wrapper
  background: $background-secondary;
  border-radius: $border-radius-md;
  overflow: auto;
  border: 1px solid rgba(255, 255, 255, 0.1);
  
  // Mask the header/footer areas with gradient fade
  &::before,
  &::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    z-index: 2;
    pointer-events: none;
  }
  
  // Hide header area with gradient
  &::before {
    top: 0;
    height: var(--header-gradient-height, 100px);
    background: linear-gradient(
      to bottom,
      #0d0f0e 0%,
      #0d0f0e var(--header-fade-amount, 50%),
      rgba(13, 15, 14, 0.8) calc(var(--header-fade-amount, 50%) + 25%),
      transparent 100%
    );
  }
  
  // Hide footer area with gradient
  &::after {
    bottom: 0;
    height: var(--footer-gradient-height, 180px);
    background: linear-gradient(
      to top,
      #0d0f0e 0%,
      #0d0f0e var(--footer-fade-amount, 60%),
      rgba(13, 15, 14, 0.9) calc(var(--footer-fade-amount, 60%) + 20%),
      transparent 100%
    );
  }
}


.registration-iframe {
  width: 140%; // Wider to allow more zoom out
  height: calc(100% + 300px); // Account for hidden header/footer
  border: none;
  background: white;
  position: absolute;
  left: 50%;
  transform-origin: center top;
  // Transform is now handled by Vue :style binding
  
  // Always show scrollbars
  scrollbar-width: thin !important;
  -ms-overflow-style: auto !important;
  
  &::-webkit-scrollbar {
    display: block !important;
    width: 8px;
    background: rgba(255, 255, 255, 0.1);
  }
  
  &::-webkit-scrollbar-thumb {
    background: rgba(0, 199, 243, 0.6);
    border-radius: 4px;
    
    &:hover {
      background: rgba(0, 199, 243, 0.8);
    }
    
    &::-webkit-scrollbar-track {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 4px;
    }
  }
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

.modal-footer {
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding: $spacing-xl $spacing-2xl;
}

.footer-info {
  margin-bottom: $spacing-xl;
}

.info-item {
  display: flex;
  align-items: flex-start;
  gap: $spacing-sm;
  padding: $spacing-md;
  background: rgba(255, 199, 0, 0.05);
  border: 1px solid rgba(255, 199, 0, 0.2);
  border-radius: $border-radius-md;
}

.info-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  margin-top: 2px;
}

.info-text {
  @include body-text($font-size-sm);
  color: rgba(255, 199, 0, 0.9);
  line-height: 1.4;
}

.modal-actions {
  display: flex;
  gap: $spacing-md;
  width: 100%;
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

.trust-header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  margin-bottom: $spacing-lg;
}

// Removed old tooltip CSS since we're using v-tooltip now

@media (max-width: $breakpoint-lg) {
  .content-wrapper {
    flex-direction: column; // Stack vertically on smaller screens
    gap: $spacing-lg;
    padding: $spacing-lg;
    height: auto;
  }
  
  .trust-section {
    flex: 0 0 auto; // Don't shrink trust section
    border-right: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    padding-right: 0;
    padding-bottom: $spacing-lg;
  }
  
  .desktop-trust-content {
    display: none; // Hide detailed trust content when stacked
  }
  
  .section-subtitle {
    display: block; // Show subtitle on smaller screens
  }
  
  .iframe-container {
    height: 500px; // Fixed height when stacked
    flex: none;
  }
  
  
  // Scrollbars are handled by the mobile-scrollable class
}

@media (max-width: $breakpoint-md) {
  .kaiserex-registration-modal {
    max-height: 95vh; // Prevent modal from being too tall
  }
  
  .content-wrapper {
    padding: $spacing-md;
    gap: $spacing-md;
    height: auto;
    max-height: calc(95vh - 200px); // Account for header and footer
  }
  
  .desktop-trust-content {
    display: none; // Hide detailed trust content on mobile
  }
  
  .section-subtitle {
    display: block; // Show subtitle on mobile screens
  }
  
  .iframe-container {
    min-height: 400px; // Prioritize iframe height on mobile
    flex: 1;
  }
  
  // Scrollbar styling is now handled by the .mobile-scrollable class above
  
  .modal-actions :deep(.secondary-button),
  .modal-actions :deep(.gradient-button) {
    height: 40px;
    font-size: $font-size-sm;
  }
}
</style>