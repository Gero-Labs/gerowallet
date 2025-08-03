<template>
  <div class="block-card">
    <div class="block-content">
      <div class="warning-section">
        <h3 class="warning-title">Temporarily block your card</h3>
        <p class="warning-text">
          Blocking your card will immediately stop all transactions. This action can't be reversed instantly — you'll
          need to contact our support team to unblock it.
        </p>
      </div>

      <div class="action-section">
        <v-btn 
          color="error" 
          class="block-btn" 
          :disabled="isCardBlocked"
          :loading="loading"
          @click="showConfirmModal = true"
        >
          {{ isCardBlocked ? 'Card Already Blocked' : 'Block Card' }}
        </v-btn>
      </div>
    </div>

    <div class="help-section">
      <p class="help-text">Need help? Contact our support team to unblock or replace your card.</p>
    </div>

    <!-- Confirmation Modal -->
    <BlockCardConfirmModal
      :open="showConfirmModal"
      @close="showConfirmModal = false"
      @confirm="handleConfirmBlock"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import cardStore from '@/stores/modules/card';
import BlockCardConfirmModal from '../BlockCardConfirmModal.vue';

const showConfirmModal = ref(false);
const loading = ref(false);

// Check if card is blocked based on state
const isCardBlocked = computed(() => {
  return cardStore.state.cardBalance?.state === 'BLOCKED';
});

const handleConfirmBlock = async () => {
  loading.value = true;
  try {
    // Here you would call the API to block the card
    console.log('Blocking card:', cardStore.state.cardNumber?.number);
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Update the card state (in real app this would come from API response)
    if (cardStore.state.cardBalance) {
      cardStore.state.cardBalance.state = 'BLOCKED';
    }
    
    console.log('Card blocked successfully');
  } catch (error) {
    console.error('Failed to block card:', error);
  } finally {
    loading.value = false;
    showConfirmModal.value = false;
  }
};
</script>

<style lang="scss" scoped>
@import '../../../styles/variables';
@import '../../../styles/mixins';

.block-card {
  width: 100%;
  @include flex-column;
  gap: $spacing-xl;
}

.block-content {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
}

.warning-section {
  @include flex-column;
  gap: $spacing-xs;
}

.warning-title {
  @include heading-style($font-size-lg);
  margin: 0;
}

.warning-text {
  @include body-text($font-size-sm);
  color: $text-muted;
  margin: 0;
}

.action-section {
  display: flex;
  justify-content: center;
  align-items: center;
}

.block-btn {
  background: #d92d20 !important;
  border: 1px solid $border-primary !important;
  border-radius: $border-radius-md !important;
  color: #ffffff !important;
  font-family: $font-family-primary;
  font-weight: $font-weight-semibold;
  font-size: $font-size-sm;
  line-height: $line-height-normal;
  text-transform: none;
  padding: $spacing-sm $spacing-sm !important;
  min-width: 120px;

  &:hover {
    background: #b42318 !important;
  }

  &:disabled {
    background: #6b7280 !important;
  }
}

.help-section {
  margin-top: $spacing-sm;
}

.help-text {
  @include body-text($font-size-sm);
  color: $text-muted;
}
</style>
