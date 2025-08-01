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
              <h2 class="modal-title">Get Started with Gero Credit Card</h2>
              <p class="modal-subtitle">
                You'll be redirected to our banking partner's secure portal to complete verification.
              </p>
            </div>

            <div class="check-items">
              <div class="check-item">
                <div class="check-icon">
                  <img src="@/modules/wallet/icons/check-blue.svg" alt="check" />
                </div>
                <span class="check-text">You will need your ID like passport, driving licence</span>
              </div>
              <div class="check-item">
                <div class="check-icon">
                  <img src="@/modules/wallet/icons/check-blue.svg" alt="check" />
                </div>
                <span class="check-text">Real-time face scan to match ID</span>
              </div>
              <div class="check-item">
                <div class="check-icon">
                  <img src="@/modules/wallet/icons/check-blue.svg" alt="check" />
                </div>
                <span class="check-text">Proof of Address like Utility bill, bank statement</span>
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

    <!-- KYC Modal -->
    <KYCModal :open="showKYCModal" @close="showKYCModal = false" @complete="setKYCStatus" />
  </div>
</template>

<script setup lang="ts">
import SecondaryButton from './SecondaryButton.vue';
import GradientButton from './GradientButton.vue';
import KYCModal from './KYCModal.vue';
import { ref } from 'vue';

defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const showKYCModal = ref(false);

const closeModal = () => {
  emit('close');
};

const handleGetStarted = () => {
  showKYCModal.value = true;
};

const setKYCStatus = () => {
  localStorage.setItem('kycStatus', 'pending');
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
