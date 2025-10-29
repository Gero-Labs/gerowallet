<template>
  <v-dialog v-model="open" max-width="400" persistent content-class="password-confirm-modal">
    <v-card class="password-confirm-dialog" outlined>
      <!-- Header -->
      <div class="modal-header">
        <div class="content">
          <div class="icon-section">
            <div class="featured-icon">
              <v-icon class="lock-icon">mdi-lock</v-icon>
            </div>
          </div>

          <div class="text-section">
            <h3 class="modal-title">{{ title }}</h3>
            <p class="modal-subtitle">
              {{ subtitle }}
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
            <label class="input-label">{{ t('card.enterPasswordToConfirm') }}</label>
            <v-text-field
              v-model="password"
              type="password"
              dense
              outlined
              class="password-input"
              hide-details
              placeholder="**********"
              @keyup.enter="confirmAction"
            />
          </div>

          <div class="buttons-section">
            <SecondaryButton :text="t('common.cancel')" @click="closeModal()" />
            <GradientButton :text="confirmButtonText" @click="confirmAction" />
          </div>
        </div>
      </div>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref } from 'vue';
import SecondaryButton from '../SecondaryButton.vue';
import GradientButton from '../GradientButton.vue';

const { t } = useTranslation();

interface Props {
  open: boolean;
  title?: string;
  subtitle?: string;
  confirmButtonText?: string;
  action?: string;
}

interface Emits {
  (e: 'close'): void;
  (e: 'confirm', password: string, action: string): void;
}

const props = withDefaults(defineProps<Props>(), {
  title: t('wallet.confirmAction'),
  subtitle: t('wallet.pleaseEnterPasswordToContinue'),
  confirmButtonText: t('common.confirm'),
  action: 'default',
});

const emit = defineEmits<Emits>();

const password = ref('');
const loading = ref(false);

const closeModal = () => {
  password.value = '';
  emit('close');
};

const confirmAction = async () => {
  if (!password.value) return;

  loading.value = true;

  await new Promise(resolve => setTimeout(resolve, 1000));

  loading.value = false;

  emit('confirm', password.value, props.action);
  closeModal();
};
</script>

<style lang="scss" scoped>
@import '../../styles/variables';
@import '../../styles/mixins';

.password-confirm-modal {
  .v-dialog__content {
    align-items: center;
    justify-content: center;
  }
}

.password-confirm-dialog {
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
  background: #00c7f3;
  border-radius: 50%;
  @include flex-center;
}

.lock-icon {
  color: #ffffff;
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
  gap: $spacing-md;
  width: 100%;
  margin-top: $spacing-md;
}
.buttons-section :deep(.secondary-button),
.buttons-section :deep(.gradient-button) {
  flex: 1;
  width: 100%;
  height: $spacing-2xl;
  @include button-size($spacing-sm, $spacing-md, $font-size-base);
}
</style>
