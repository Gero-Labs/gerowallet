<template>
  <div>
    <v-dialog v-model="open" max-width="584" persistent content-class="order-card-modal">
      <v-card class="modal-card">
        <div class="modal-content">
          <div class="card-mockup-section">
            <div class="cards-wrapper">
              <img src="@/modules/wallet/icons/multiCards.svg" alt="Cards" class="card" />
            </div>
          </div>

          <div class="modal-header">
            <div class="header-content">
              <h2 class="modal-title">Get Started with Gero Crypto Card</h2>
              <p class="modal-subtitle">
                First, you'll create an account with Kaiserex, our trusted banking partner. Then complete verification
                to order your card.
              </p>
            </div>

            <div class="check-items">
              <div class="check-item">
                <div class="check-icon">
                  <img src="@/modules/wallet/icons/check-blue.svg" alt="check" />
                </div>
                <span class="check-text">Step 1: Create your Kaiserex account (our banking partner)</span>
              </div>
              <div class="check-item">
                <div class="check-icon">
                  <img src="@/modules/wallet/icons/check-blue.svg" alt="check" />
                </div>
                <span class="check-text">Step 2: Complete KYC verification with ID and face scan</span>
              </div>
              <div class="check-item">
                <div class="check-icon">
                  <img src="@/modules/wallet/icons/check-blue.svg" alt="check" />
                </div>
                <span class="check-text">Step 3: Receive your Gero Crypto Card</span>
              </div>
            </div>
          </div>

          <div class="modal-actions">
            <SecondaryButton text="Cancel" @click="closeModal()" />
            <GradientButton text="Get Started" @click="handleGetStarted()" />
          </div>
        </div>
      </v-card>
    </v-dialog>

    <!-- Kaiserex Registration Modal -->
    <KaiserexRegistrationModal
      :open="showKaiserexModal"
      @close="handleKaiserexClose"
      @complete="handleKaiserexComplete"
    />

    <!-- KYC Modal -->
    <KYCModal :open="showKYCModal" @close="showKYCModal = false" @complete="setKYCStatus" />
  </div>
</template>

<script setup lang="ts">
import SecondaryButton from './SecondaryButton.vue';
import GradientButton from './GradientButton.vue';
import KaiserexRegistrationModal from './KaiserexRegistrationModal.vue';
import KYCModal from './KYCModal.vue';
import { ref } from 'vue';
import cardStore from '@/stores/modules/card';

defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const showKaiserexModal = ref(false);
const showKYCModal = ref(false);

const closeModal = () => {
  emit('close');
};

const handleGetStarted = () => {
  // Check if user has already registered with Kaiserex
  const isRegistered = cardStore.state.walletStatus.isKaiserexAuthenticated;

  if (isRegistered) {
    // If already registered, go directly to KYC
    showKYCModal.value = true;
  } else {
    // Otherwise, show Kaiserex registration first
    showKaiserexModal.value = true;
  }
};

const handleKaiserexClose = () => {
  showKaiserexModal.value = false;
};

const handleKaiserexComplete = () => {
  // Close Kaiserex modal and open KYC modal
  showKaiserexModal.value = false;
  showKYCModal.value = true;
};

const setKYCStatus = () => {
  cardStore.state.walletStatus.kycStatus = 'pending';
  showKYCModal.value = false;
  closeModal();
};
</script>

<style lang="scss" scoped>
@import '../styles/variables';
@import '../styles/mixins';
.order-card-modal {
  border-radius: $border-radius-lg;
}

.modal-card {
  background: $background-dark;
  border-radius: $border-radius-lg;
  box-shadow: $shadow-md;
  position: relative;
}

.close-btn {
  position: absolute;
  top: $spacing-md;
  right: $spacing-md;
  z-index: $z-sticky;
  color: $text-secondary;
}

.modal-content {
  padding: $spacing-2xl;
}

.card-mockup-section {
  margin-bottom: $spacing-xl;
}

.cards-wrapper {
  position: relative;
  height: 254px;
  background: linear-gradient(135deg, $background-dark 0%, $primary-cyan 100%);
  border-radius: $border-radius-lg;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-header {
  text-align: center;
}
.header-content {
  padding: 0 $spacing-2xl;
}

.modal-title {
  @include heading-style($font-size-2xl);
  color: $text-primary;
  margin: 0 0 $spacing-md 0;
  line-height: 1.17;
}

.modal-subtitle {
  @include body-text($font-size-base);
  color: $text-secondary;
  margin: 0;
  line-height: 1.5;
}

.check-items {
  display: flex;
  flex-direction: column;
  gap: $spacing-xl;
  padding: $spacing-2xl;
}

.check-item {
  display: flex;
  align-items: center;
  gap: $spacing-md;
}

.check-text {
  @include body-text($font-size-base);
  color: $text-secondary;
  line-height: 1.5;
}

.modal-actions {
  display: flex;
  gap: $spacing-md;
  width: 100%;
  margin-top: $spacing-md;
}

.modal-actions :deep(.secondary-button),
.modal-actions :deep(.gradient-button) {
  flex: 1;
  width: 100%;
  height: $spacing-2xl;
  @include button-size($spacing-sm, $spacing-md, $font-size-base);
}
</style>
