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
        <v-btn color="error" class="block-btn" @click="showConfirmModal = true">
          Block Card
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
import { ref } from 'vue';
import BlockCardConfirmModal from '../BlockCardConfirmModal.vue';

const showConfirmModal = ref(false);

const handleConfirmBlock = () => {
  // Здесь можно добавить логику после подтверждения блокировки
  console.log('Card blocked successfully');
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
