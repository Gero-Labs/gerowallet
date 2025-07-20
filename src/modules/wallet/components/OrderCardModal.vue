<template>
  <div>
    <v-dialog v-model="open" max-width="584" persistent content-class="order-card-modal">
      <v-card class="modal-card">
        <div class="modal-content">
          <div class="card-mockup-section">
            <div class="cards-wrapper">
              <img src="@/assets/img/multiCards.svg" alt="Cards" class="card" />
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
                  <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="M8.74992 14.0002L12.2499 17.5002L19.2499 10.5002M25.6666 14.0002C25.6666 20.4435 20.4432 25.6668 13.9999 25.6668C7.5566 25.6668 2.33325 20.4435 2.33325 14.0002C2.33325 7.55684 7.5566 2.3335 13.9999 2.3335C20.4432 2.3335 25.6666 7.55684 25.6666 14.0002Z"
                      stroke="#00DFF3"
                      stroke-width="2.33333"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </div>
                <span class="check-text">You will need your ID like passport, driving licence</span>
              </div>
              <div class="check-item">
                <div class="check-icon">
                  <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="M8.74992 14.0002L12.2499 17.5002L19.2499 10.5002M25.6666 14.0002C25.6666 20.4435 20.4432 25.6668 13.9999 25.6668C7.5566 25.6668 2.33325 20.4435 2.33325 14.0002C2.33325 7.55684 7.5566 2.3335 13.9999 2.3335C20.4432 2.3335 25.6666 7.55684 25.6666 14.0002Z"
                      stroke="#00DFF3"
                      stroke-width="2.33333"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </div>
                <span class="check-text">Real-time face scan to match ID</span>
              </div>
              <div class="check-item">
                <div class="check-icon">
                  <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="M8.74992 14.0002L12.2499 17.5002L19.2499 10.5002M25.6666 14.0002C25.6666 20.4435 20.4432 25.6668 13.9999 25.6668C7.5566 25.6668 2.33325 20.4435 2.33325 14.0002C2.33325 7.55684 7.5566 2.3335 13.9999 2.3335C20.4432 2.3335 25.6666 7.55684 25.6666 14.0002Z"
                      stroke="#00DFF3"
                      stroke-width="2.33333"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
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

<style scoped>
.order-card-modal {
  border-radius: 12px;
}

.modal-card {
  background: #0c0e12;
  border-radius: 12px;
  box-shadow: 0px 3px 3px -1.5px rgba(255, 255, 255, 0), 0px 8px 8px -4px rgba(255, 255, 255, 0),
    0px 20px 24px -4px rgba(255, 255, 255, 0);
  position: relative;
}

.close-btn {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 10;
  color: #94979c;
}

.modal-content {
  padding: 24px;
}

.card-mockup-section {
  margin-bottom: 20px;
}

.cards-wrapper {
  position: relative;
  height: 254px;
  background: linear-gradient(135deg, #013e44 0%, #005f67 100%);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-header {
  text-align: center;
}
.header-content {
  padding: 0 32px;
}

.modal-title {
  font-weight: 600;
  font-size: 24px;
  color: #f7f7f7;
  margin: 0 0 8px 0;
  line-height: 1.17;
}

.modal-subtitle {
  font-weight: 400;
  font-size: 16px;
  color: #94979c;
  margin: 0;
  line-height: 1.5;
}

.check-items {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 32px;
}

.check-item {
  display: flex;
  align-items: center;
  gap: 12px;
}

.check-text {
  font-weight: 400;
  font-size: 16px;
  color: #94979c;
  line-height: 1.5;
}

.modal-actions {
  display: flex;
  gap: 12px;
  width: 100%;
  margin-top: 8px;
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
</style>
