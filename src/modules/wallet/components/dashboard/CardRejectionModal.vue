<template>
  <v-dialog v-model="dialog" max-width="500" persistent content-class="card-rejection-modal">
    <v-card class="modal-card">
      <!-- Header -->
      <div class="modal-header">
        <div class="header-content">
          <div class="icon-wrapper">
            <v-icon class="rejection-icon">mdi-close-circle</v-icon>
          </div>
          <h2 class="modal-title">{{ $t('card.cardRejected') }}</h2>
          <p class="modal-subtitle">{{ $t('card.cardRejectedMessage') }}</p>
        </div>
      </div>

      <!-- Content -->
      <div class="modal-content">
        <div class="acknowledgment-section">
          <v-checkbox
            v-model="acknowledged"
            :label="$t('card.iHaveReadRejectionMessage')"
            hide-details
            class="acknowledgment-checkbox"
          />
        </div>
      </div>

      <!-- Actions -->
      <div class="modal-actions">
        <GradientButton
          :text="$t('card.orderNewCard')"
          :disabled="!acknowledged"
          @click="handleOrderNewCard"
        />
      </div>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import GradientButton from '../GradientButton.vue';


interface Props {
  open: boolean;
}

interface Emits {
  (e: 'close'): void;
  (e: 'orderNewCard'): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const acknowledged = ref(false);

const dialog = computed({
  get: () => props.open,
  set: (value) => {
    if (!value) {
      emit('close');
    }
  },
});

const handleOrderNewCard = () => {
  if (acknowledged.value) {
    emit('orderNewCard');
    acknowledged.value = false;
  }
};

// Reset acknowledgment when modal closes
watch(() => props.open, (newVal) => {
  if (!newVal) {
    acknowledged.value = false;
  }
});
</script>

<style lang="scss" scoped>
@import '../../styles/variables';
@import '../../styles/mixins';

.card-rejection-modal {
  border-radius: $border-radius-lg;
}

.modal-card {
  background: $background-dark !important;
  border-radius: $border-radius-lg !important;
  overflow: hidden;
}

.modal-header {
  position: relative;
  padding: $spacing-3xl $spacing-3xl $spacing-lg;
  display: flex;
  align-items: flex-start;
  text-align: center;
}

.header-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.icon-wrapper {
  margin-bottom: $spacing-md;
  
  .rejection-icon {
    font-size: 64px;
    color: #f44336;
  }
}

.modal-title {
  font-family: $font-family-primary;
  font-weight: $font-weight-bold;
  font-size: $font-size-2xl;
  line-height: $line-height-tight;
  color: $text-primary;
  margin: 0 0 $spacing-sm 0;
}

.modal-subtitle {
  font-family: $font-family-primary;
  font-weight: $font-weight-normal;
  font-size: $font-size-base;
  line-height: $line-height-relaxed;
  color: $text-muted;
  margin: 0;
}

.modal-content {
  padding: 0 $spacing-3xl $spacing-lg;
}

.acknowledgment-section {
  display: flex;
  justify-content: center;
  padding: $spacing-md 0;
}

.acknowledgment-checkbox {
  :deep(.v-input__control) {
    .v-input__slot {
      .v-input--selection-controls__input {
        .v-icon {
          color: $primary-cyan;
        }
      }
    }
  }
  
  :deep(.v-label) {
    color: $text-secondary;
    font-size: $font-size-sm;
  }
}

.modal-actions {
  display: flex;
  gap: $spacing-md;
  padding: $spacing-lg $spacing-3xl $spacing-3xl;
}

.modal-actions :deep(.gradient-button) {
  flex: 1;
  width: 100%;
  height: 44px;
  font-size: $font-size-base;
  font-weight: $font-weight-semibold;
  text-transform: none;
}

@media (max-width: $breakpoint-sm) {
  .modal-header {
    padding: $spacing-2xl $spacing-2xl $spacing-md;
  }

  .modal-content {
    padding: 0 $spacing-2xl $spacing-md;
  }

  .modal-actions {
    padding: $spacing-md $spacing-2xl $spacing-2xl;
  }
}
</style>
