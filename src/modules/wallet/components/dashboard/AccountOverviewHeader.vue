<template>
  <div class="header-section">
    <div class="header-content">
      <span class="header-title">Account Overview</span>
      <div class="header-actions">
        <v-btn class="action-btn secondary-btn" variant="outlined" @click="showTopUpModal = true">
          <img src="@/modules/wallet/icons/currency-dollar.svg" alt="Top up" class="btn-icon" />
          Top up
        </v-btn>
        <v-btn class="action-btn primary-btn" variant="outlined" @click="handleManageCard">
          <img src="@/modules/wallet/icons/credit-card.svg" alt="Manage Card" class="btn-icon" />
          Manage Card
        </v-btn>
        <v-btn class="action-btn primary-btn" variant="outlined">
          <img src="@/modules/wallet/icons/qr-code.svg" alt="QR Scan" class="btn-icon" />
          QR Scan
        </v-btn>
      </div>
    </div>
    
    <!-- Password Confirm Modal - only for Manage Card -->
    <PasswordConfirmModal
      :open="showPasswordModal"
      :title="passwordModalTitle"
      :subtitle="passwordModalSubtitle"
      :confirm-button-text="passwordModalConfirmText"
      :action="currentAction"
      @close="closePasswordModal"
      @confirm="handlePasswordConfirm"
    />
    
    <!-- Original Modals -->
    <TopUpModal :open="showTopUpModal" @close="showTopUpModal = false" />
    <ManageCardModal :open="showManageCardModal" @close="showManageCardModal = false" />
  </div>
</template>

<script setup lang="ts">
import TopUpModal from './TopUpModal.vue';
import ManageCardModal from './ManageCardModal.vue';
import PasswordConfirmModal from './PasswordConfirmModal.vue';
import { ref } from 'vue';

const showTopUpModal = ref(false);
const showManageCardModal = ref(false);
const showPasswordModal = ref(false);
const currentAction = ref('');
const passwordModalTitle = ref('');
const passwordModalSubtitle = ref('');
const passwordModalConfirmText = ref('');

const handleManageCard = () => {
  currentAction.value = 'manage-card';
  passwordModalTitle.value = 'Manage Card';
  passwordModalSubtitle.value = 'Please enter your password to manage your card settings.';
  passwordModalConfirmText.value = 'Continue';
  showPasswordModal.value = true;
};

const closePasswordModal = () => {
  showPasswordModal.value = false;
  currentAction.value = '';
};

const handlePasswordConfirm = (password: string, action: string) => {
  console.log('Password confirmed for action:', action, 'Password:', password);
  
  if (action === 'manage-card') {
    showManageCardModal.value = true;
  }
};
</script>

<style lang="scss" scoped>
@import '../../styles/variables';
@import '../../styles/mixins';

.header-section {
  .header-content {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: $spacing-3xl;
  }

  .header-title {
    font-family: $font-family-primary;
    font-weight: $font-weight-semibold;
    font-size: $font-size-xl;
    line-height: 1.4;
    color: $text-primary;
    margin: 0;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: $spacing-md;
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 16px;
    border-radius: $border-radius-md;
    font-family: $font-family-primary;
    font-weight: $font-weight-semibold;
    font-size: $font-size-base;
    line-height: 1.5;
    text-transform: none;
    color: $text-primary;
    border-radius: $border-radius-md;
    background: $background-card;
    border: 1px solid $primary-cyan;
    box-shadow: $shadow-button;

    &:hover {
      background: lighten($background-card, 5%);
    }

    &:focus {
      outline: none;
    }

    .btn-icon {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
      margin-right: 6px;
    }
  }
}
</style>
