<template>
  <div class="kaiserex-auth-page">
    <div class="auth-container">
      <!-- Header -->
      <div class="auth-header">
        <h1 class="page-title">Get Your Gero Crypto Card</h1>
        <p class="page-description">
          Choose an option below to get started with your crypto card order
        </p>
      </div>

      <!-- Auth Options -->
      <div class="auth-options">
        <!-- Register Option -->
        <div class="auth-option register-option liquid-glass-card">
          <div class="default-card-view">
            <div class="option-icon">
            <div class="icon-circle new-user">
              <v-icon>mdi-account-plus</v-icon>
            </div>
          </div>
          
          <div class="option-content">
            <h3 class="option-title">
              New to 
              <v-tooltip top :open-delay="300" content-class="custom-tooltip">
                <template v-slot:activator="{ on, attrs }">
                  <span v-bind="attrs" v-on="on" class="kaiserex-hover">Kaiserex</span>
                </template>
                <div class="tooltip-content">
                  <strong>Kaiserex</strong> is Gero's trusted financial partner that handles card issuance, 
                  KYC verification, and payment processing for the Gero Crypto Card.
                </div>
              </v-tooltip>?
            </h3>
            <p class="option-description">
              Create your Kaiserex account and complete the verification process to order your card.
            </p>
            
            <div class="option-steps">
              <div class="step-item">
                <span class="step-number">1</span>
                <span class="step-text">Create account</span>
              </div>
              <div class="step-item">
                <span class="step-number">2</span>
                <span class="step-text">Complete KYC</span>
              </div>
              <div class="step-item">
                <span class="step-number">3</span>
                <span class="step-text">Order your card</span>
              </div>
            </div>
          </div>
          
          <div class="option-action">
            <GradientButton 
              text="Create Account" 
              @click="handleRegister"
              class="full-width"
            />
          </div>
          </div>
        </div>

        <!-- Login Option -->
        <div class="auth-option login-option liquid-glass-card">
          <!-- Default Login Card View -->
          <div v-if="!showLoginForm" class="default-card-view">
            <div class="option-icon">
              <div class="icon-circle existing-user">
                <v-icon>mdi-account-check</v-icon>
              </div>
            </div>
            
            <div class="option-content">
              <h3 class="option-title">Already have a Kaiserex account?</h3>
              <p class="option-description">
                Sign in to your existing account to continue with your card order or check your status.
              </p>
              
              <div class="option-features">
                <div class="feature-item">
                  <v-icon class="feature-icon">mdi-check-circle</v-icon>
                  <span class="feature-text">Check order status</span>
                </div>
                <div class="feature-item">
                  <v-icon class="feature-icon">mdi-check-circle</v-icon>
                  <span class="feature-text">Manage account settings</span>
                </div>
                <div class="feature-item">
                  <v-icon class="feature-icon">mdi-check-circle</v-icon>
                  <span class="feature-text">Order additional cards</span>
                </div>
              </div>
            </div>
            
            <div class="option-action">
              <SecondaryButton 
                text="Sign In" 
                @click="handleLogin"
                class="full-width"
              />
            </div>
          </div>

          <!-- Login Form View -->
          <div v-if="showLoginForm" class="login-form-container">
            <div class="form-header">
              <button @click="showLoginForm = false" class="back-button">
                <v-icon small>mdi-arrow-left</v-icon>
                Back
              </button>
              <h3 class="form-title">Sign in to Kaiserex</h3>
              <p class="form-description">
                Enter your credentials to continue with your card order.
              </p>
            </div>
            
            <div class="form-content">
              <div class="form-group">
                <label class="form-label">Username or Email</label>
                <input 
                  v-model="username" 
                  type="text" 
                  class="form-input"
                  placeholder="Enter your username or email"
                />
              </div>
              
              <div class="form-group">
                <label class="form-label">Password</label>
                <input 
                  v-model="password" 
                  type="password" 
                  class="form-input"
                  placeholder="Enter your password"
                />
              </div>
              
              <div class="form-actions">
                <GradientButton 
                  text="Sign In" 
                  @click="handleLoginSubmit"
                  class="full-width"
                />
              </div>
              
              <div class="forgot-password">
                <button class="forgot-link">
                  Forgot your password?
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <!-- Card Management Info -->
      <div class="management-section">
        <div class="management-content liquid-glass-card">
          <img src="@/modules/wallet/icons/card.svg" alt="card" />
          <div class="management-column-content">
            <h3 class="management-heading">Manage Your Card in Seconds</h3>
            <p class="management-description">
              An all-in-one platform that helps you manage everything about your Gero Card account
            </p>
            <div class="feature-list">
              <div class="feature-item">
                <v-icon class="feature-icon">mdi-check-circle</v-icon>
                <span class="feature-text">Enjoy 6 months of ZERO FEES</span>
              </div>
              <div class="feature-item">
                <v-icon class="feature-icon">mdi-check-circle</v-icon>
                <span class="feature-text">0% monthly & issuance fees</span>
              </div>
              <div class="feature-item">
                <v-icon class="feature-icon">mdi-check-circle</v-icon>
                <span class="feature-text">0% fees on ADA-to-euro conversions and spending.</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Modals -->
    <KaiserexRegistrationModal 
      :open="showRegistrationModal" 
      @close="showRegistrationModal = false"
      @complete="handleRegistrationComplete" 
    />
    
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import GradientButton from './GradientButton.vue';
import SecondaryButton from './SecondaryButton.vue';
import KaiserexRegistrationModal from './KaiserexRegistrationModal.vue';

const emit = defineEmits<{
  (e: 'auth-complete'): void;
}>();

const showRegistrationModal = ref(false);
const showLoginForm = ref(false);
const username = ref('');
const password = ref('');

const handleRegister = () => {
  showRegistrationModal.value = true;
};

const handleLogin = () => {
  showLoginForm.value = true;
};

const handleLoginSubmit = () => {
  // Set authentication status using the wallet status system
  localStorage.setItem('kaiserexRegistered', 'true');
  
  // Emit auth completion to trigger state update
  showLoginForm.value = false;
  emit('auth-complete');
};

const handleRegistrationComplete = () => {
  // Set authentication status
  localStorage.setItem('kaiserexRegistered', 'true');
  
  showRegistrationModal.value = false;
  emit('auth-complete');
};
</script>

<style lang="scss" scoped>
@import '../styles/variables';
@import '../styles/mixins';

.kaiserex-auth-page {
  min-height: 100vh;
  display: flex;
  align-items: flex-start; // Changed from center to flex-start
  justify-content: center;
  padding-top: $spacing-2xl; // Reduced top padding
  padding-left: $spacing-xl;
  padding-right: $spacing-xl;
  padding-bottom: $spacing-xl;
  position: relative;
  
  // Background image with blend mode
  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-image: url('@/assets/emptyStateNew.png');
    background-size: 100%;
    background-position: center center;
    background-repeat: no-repeat;
    mix-blend-mode: screen; // Creates a lighter, more ethereal effect
    z-index: 0;
  }
}

.auth-container {
  max-width: 900px;
  width: 100%;
  position: relative;
  z-index: 1; // Above the background
  margin-top: $spacing-xl; // Add some top margin for better spacing
}

.auth-header {
  text-align: center;
  margin-bottom: $spacing-4xl; // Increased back to original spacing
}

.page-title {
  @include heading-style($font-size-3xl);
  color: $text-primary;
  margin: 0 0 $spacing-md 0;
}

.page-description {
  @include body-text($font-size-lg);
  color: $text-secondary;
  margin: 0;
  margin-left: auto;
  margin-right: auto;
  white-space: nowrap;
}

.auth-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: $spacing-3xl;
  margin-bottom: $spacing-4xl;
}

.auth-option {
  background: $background-card;
  border: 1px solid $border-secondary;
  border-radius: $border-radius-xl;
  padding: 24px; // Reduced further for compactness
  display: flex;
  flex-direction: column;
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;
  height: 480px; // Fixed height for consistency
  
  &:hover {
    border-color: rgba(0, 199, 243, 0.3);
  }
  
  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: linear-gradient(90deg, $primary-cyan 0%, $primary-green 100%);
    opacity: 0;
    transition: opacity 0.3s ease;
  }
  
  &:hover::before {
    opacity: 1;
  }
}

// Liquid glass effect for cards - using the same style as dialogStyle
.liquid-glass-card {
  -webkit-backdrop-filter: blur(12px) brightness(0.2) !important;
  backdrop-filter: blur(12px) !important;
  background: #000000ab !important;
  border: solid 2px #ffffff44 !important;
  
  &:hover {
    background: #000000bb !important;
    border-color: rgba(0, 199, 243, 0.4) !important;
    -webkit-backdrop-filter: blur(15px) brightness(0.3) !important;
    backdrop-filter: blur(15px) !important;
  }
}

.option-icon {
  display: flex;
  justify-content: center;
  margin-top: 40px; // Position icon between top and header
  margin-bottom: 30px; // Space before header
}

.icon-circle {
  width: 72px; // Reduced from 80px
  height: 72px; // Reduced from 80px
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  
  .v-icon {
    font-size: 32px; // Reduced from 36px
  }
  
  &.new-user {
    background: rgba(0, 199, 243, 0.1);
    color: $primary-cyan;
  }
  
  &.existing-user {
    background: rgba(255, 255, 255, 0.1);
    color: $text-secondary;
  }
}

.option-content {
  flex: 1;
  text-align: center;
  display: flex;
  flex-direction: column;
  justify-content: flex-start; // Align headers at same position
}

.option-title {
  @include heading-style($font-size-xl);
  color: $text-primary;
  margin: 0 0 $spacing-sm 0; // Reduced from $spacing-md
}

.option-description {
  @include body-text($font-size-base);
  color: $text-secondary;
  margin: 0 0 $spacing-md 0; // Reduced from $spacing-lg
  line-height: 1.6;
}

.option-steps {
  display: flex;
  justify-content: center;
  gap: $spacing-lg;
}

.step-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: $spacing-xs;
}

.step-number {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgba(0, 199, 243, 0.2);
  color: $primary-cyan;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: $font-size-sm;
  font-weight: $font-weight-semibold;
}

.step-text {
  @include text-style($font-size-xs, $font-weight-medium, $line-height-normal);
  color: $text-muted;
  text-align: center;
}

.option-features {
  display: flex;
  flex-direction: column;
  gap: $spacing-sm;
}

.feature-item {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: $spacing-sm;
}

.feature-icon {
  font-size: 16px;
  color: rgba(0, 199, 243, 0.7);
}

.feature-text {
  @include body-text($font-size-sm);
  color: $text-secondary;
}

.option-action {
  margin-top: auto;
  flex-shrink: 0;
  width: 100%;
  
  .gradient-button,
  .secondary-button,
  :deep(.gradient-button),
  :deep(.secondary-button) {
    width: 100% !important;
    height: 48px;
    font-size: $font-size-base;
    font-weight: $font-weight-semibold;
  }
}

.full-width {
  width: 100%;
  
  :deep(.gradient-button),
  :deep(.secondary-button) {
    width: 100% !important;
    height: 48px;
    font-size: $font-size-base;
    font-weight: $font-weight-semibold;
  }
}

.management-section {
  text-align: center;
}

.management-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: $spacing-4xl;
  padding: 28px; // Reduced by 4px from $spacing-3xl (32px)
  border-radius: $border-radius-lg;
}

.management-column-content {
  @include flex-column;
  gap: $spacing-lg;
}

.management-heading {
  @include heading-style($font-size-2xl);
  color: $text-primary;
  margin: 0;
}

.management-description {
  @include body-text($font-size-base);
  color: $text-secondary;
  margin: 0;
  line-height: 1.6;
}

.feature-list {
  @include flex-column;
  gap: $spacing-md;
}

.feature-item {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
}

.feature-icon {
  font-size: 18px;
  color: rgba(0, 199, 243, 0.7);
  flex-shrink: 0;
}

.feature-text {
  @include body-text($font-size-sm);
  color: $text-secondary;
}

// Responsive Design
@media (max-width: $breakpoint-lg) {
  .auth-options {
    grid-template-columns: 1fr;
    gap: $spacing-2xl;
  }
  
  .auth-option {
    padding: $spacing-2xl;
  }
  
  .management-content {
    flex-direction: column;
    gap: $spacing-2xl;
    text-align: center;
  }
}

@media (max-width: $breakpoint-md) {
  .kaiserex-auth-page {
    padding: $spacing-lg;
  }
  
  .page-title {
    font-size: $font-size-2xl;
  }
  
  .auth-option {
    padding: $spacing-xl;
  }
  
  .option-steps {
    flex-direction: column;
    gap: $spacing-md;
  }
}


// Kaiserex hover tooltip styling
.kaiserex-hover {
  color: $primary-cyan;
  cursor: help;
  border-bottom: 1px dotted $primary-cyan;
  transition: all 0.2s ease;
  
  &:hover {
    color: lighten($primary-cyan, 10%);
    border-bottom-color: lighten($primary-cyan, 10%);
  }
}

// Tooltip content styling
.tooltip-content {
  font-size: $font-size-sm;
  line-height: 1.5;
  
  strong {
    color: $primary-cyan;
    font-weight: $font-weight-semibold;
  }
}

// Card view consistency
.default-card-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  justify-content: space-between; // Distribute content evenly
}

// Login form styles
.login-form-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  justify-content: space-between; // Distribute content evenly
}

.form-header {
  margin-bottom: $spacing-xl;
  
  .back-button {
    display: flex;
    align-items: center;
    gap: $spacing-xs;
    background: none;
    border: none;
    color: $text-muted;
    cursor: pointer;
    font-size: $font-size-sm;
    margin-bottom: $spacing-lg;
    padding: $spacing-xs;
    border-radius: $border-radius-sm;
    transition: all 0.2s ease;
    
    &:hover {
      color: $primary-cyan;
      background: rgba(0, 199, 243, 0.1);
    }
  }
  
  .form-title {
    @include heading-style($font-size-xl);
    color: $text-primary;
    margin: 0 0 $spacing-sm 0;
    text-align: center;
  }
  
  .form-description {
    @include body-text($font-size-sm);
    color: $text-secondary;
    margin: 0;
    text-align: center;
  }
}

.form-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: $spacing-lg;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: $spacing-sm;
}

.form-label {
  @include text-style($font-size-sm, $font-weight-medium);
  color: $text-primary;
}

.form-input {
  padding: $spacing-md;
  border: 1px solid $border-secondary;
  border-radius: $border-radius-md;
  background: $background-secondary;
  color: $text-primary;
  font-size: $font-size-base;
  transition: border-color 0.2s ease;
  
  &:focus {
    outline: none;
    border-color: $primary-cyan;
    box-shadow: 0 0 0 2px rgba(0, 199, 243, 0.1);
  }
  
  &::placeholder {
    color: $text-muted;
  }
}

.form-actions {
  margin-top: auto;
  padding-top: $spacing-lg;
}

.forgot-password {
  text-align: center;
  margin-top: $spacing-md;
  
  .forgot-link {
    background: none;
    border: none;
    color: $primary-cyan;
    font-size: $font-size-sm;
    cursor: pointer;
    text-decoration: underline;
    
    &:hover {
      opacity: 0.8;
    }
  }
}

</style>