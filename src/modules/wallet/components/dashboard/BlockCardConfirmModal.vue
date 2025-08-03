<template>
  <v-dialog v-model="open" max-width="400" persistent content-class="block-card-confirm-modal">
    <v-card class="block-card-confirm-dialog" outlined>
      <!-- Header -->
      <div class="modal-header">
        <div class="content">
          <div class="icon-section">
            <div class="featured-icon">
              <v-icon class="card-icon">mdi-credit-card-off</v-icon>
            </div>
          </div>
          
          <div class="text-section">
            <h3 class="modal-title">Block Your Card</h3>
            <p class="modal-subtitle">
              Are you sure you want to block your card? This action cannot be undone.
            </p>
          </div>
        </div>
        
        <v-btn icon class="close-btn" @click="closeModal">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </div>

      <!-- Actions -->
      <div class="modal-actions">
        <div class="actions-content">
          <div class="password-section">
            <label class="input-label">Enter Password to confirm transaction*</label>
            <v-text-field
              v-model="password"
              type="password"
              dense
              outlined
              class="password-input"
              hide-details
              placeholder="**********"
            />
          </div>
          
          <div class="buttons-section">
            <v-btn
              class="cancel-btn"
              @click="closeModal"
            >
              Cancel
            </v-btn>
            <v-btn
              color="error"
              class="delete-btn"
              @click="confirmBlock"
              :loading="loading"
              :disabled="!password"
            >
              Delete
            </v-btn>
          </div>
        </div>
      </div>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue';

interface Props {
  open: boolean;
}

interface Emits {
  (e: 'close'): void;
  (e: 'confirm'): void;
}

defineProps<Props>();
const emit = defineEmits<Emits>();

const password = ref('');
const loading = ref(false);

const closeModal = () => {
  password.value = '';
  emit('close');
};

const confirmBlock = async () => {
  if (!password.value) return;
  
  loading.value = true;
  
  // Simulate API call
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  loading.value = false;
  
  // Add card blocking logic here
  console.log('Card blocked with password:', password.value);
  
  emit('confirm');
  closeModal();
};
</script>

<style lang="scss" scoped>
@import '../../styles/variables';
@import '../../styles/mixins';

.block-card-confirm-modal {
  .v-dialog__content {
    align-items: center;
    justify-content: center;
  }
}

.block-card-confirm-dialog {
  background: $background-dark !important;
  border-radius: $border-radius-lg !important;
  overflow: hidden;
  width: 100%;
  max-width: 400px;
  box-shadow: $shadow-md;
}

.modal-header {
  position: relative;
  @include flex-column;
  align-items: center;
  width: 100%;
}

.content {
  @include flex-column;
  gap: $spacing-sm;
  padding: $spacing-xl $spacing-xl 0;
  width: 100%;
}

.icon-section {
  display: flex;
}

.featured-icon {
  width: 48px;
  height: 48px;
  background: #d92d20;
  border-radius: 50%;
  @include flex-center;
}

.card-icon {
  color: #fecdca;
  font-size: $font-size-xl;
}

.text-section {
  @include flex-column;
  gap: $spacing-xs;
}

.modal-title {
  @include heading-style($font-size-lg);
}

.modal-subtitle {
  @include body-text($font-size-sm);
  color: $text-muted;
  margin: 0;
}

.close-btn {
  position: absolute;
  top: $spacing-sm;
  right: $spacing-sm;
  width: 44px;
  height: 44px;

  .v-icon {
    color: #85888e;
    font-size: $font-size-xl;
  }
}

.modal-actions {
  padding: $spacing-sm 0 0;
  width: 100%;
}

.actions-content {
  @include flex-column;
  gap: $spacing-sm;
  padding: 0 $spacing-xl $spacing-xl;
}

.password-section {
  @include flex-column;
  gap: $spacing-xs;
}

.input-label {
  @include body-text($font-size-sm);
  font-weight: $font-weight-medium;
  color: $text-secondary;
  margin: 0;
}

.password-input {
  :deep(.v-input__control) {
    background: $background-dark !important;
    border: 1px solid $border-primary !important;
    border-radius: $border-radius-md !important;
  }

  :deep(.v-input__slot) {
    background: transparent !important;
    box-shadow: none !important;
  }

  :deep(.v-label) {
    color: $text-secondary !important;
    font-weight: $font-weight-medium;
    font-size: $font-size-sm;
  }

  :deep(.v-text-field__details) {
    display: none;
  }

  :deep(input) {
    color: $text-primary !important;
    font-size: $font-size-base;
  }
}

.buttons-section {
  display: flex;
  gap: $spacing-sm;
  width: 100%;
}

.cancel-btn {
  height: 44px !important;
  flex: 1;
  background: $background-card !important;
  border: 1px solid $border-primary !important;
  border-radius: $border-radius-md !important;
  color: $text-secondary !important;
  font-family: $font-family-primary;
  font-weight: $font-weight-semibold;
  font-size: $font-size-base;
  line-height: $line-height-relaxed;
  text-transform: none;
  padding: $spacing-sm $spacing-sm !important;
  box-shadow: $shadow-button;
  
  &:hover {
    background: #1a1d23 !important;
  }
}

.delete-btn {
  flex: 1;
  height: 44px !important;
  background: #d92d20 !important;
  border: 2px solid rgba(255, 255, 255, 0.12) !important;
  border-radius: $border-radius-md !important;
  color: #ffffff !important;
  font-family: $font-family-primary;
  font-weight: $font-weight-semibold;
  font-size: $font-size-base;
  line-height: $line-height-relaxed;
  text-transform: none;
  padding: $spacing-sm $spacing-sm !important;
  box-shadow: $shadow-button;
  
  &:hover {
    background: #b42318 !important;
  }
  
  &:disabled {
    background: #6b7280 !important;
    border-color: #6b7280 !important;
  }
}
</style> 