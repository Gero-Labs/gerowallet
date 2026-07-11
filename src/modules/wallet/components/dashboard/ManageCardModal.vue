<template>
  <BaseDialog
    :isOpen="open"
    @close="$emit('close')"
    :title="t('card.manageCardTitle')"
    :subtitle="t('card.manageCardSubtitleSecurely')"
    :width="600"
    :min-height="0"
    persistent
    icon="mdi-account-credit-card"
  >
    <v-card-text class="pb-0">
      <v-card flat class="transparent px-0">
        <v-card-title class="px-0">{{ t('card.pin') }}</v-card-title>
        <v-card-text class="pa-0">
          <div class="pin-container">
            <v-otp-input
              length="4"
              :readonly="true"
              :type="showPin ? 'text' : 'password'"
              :value="displayPin"
              class="pin-input"
            />
            <v-btn icon class="eye-btn" :loading="loadingPin" @click="togglePinVisibility">
              <v-icon>{{ showPin ? 'mdi-eye' : 'mdi-eye-off' }}</v-icon>
            </v-btn>
          </div>
        </v-card-text>
        <v-card-title class="px-0">{{ t('card.temporarilyBlockCard') }}</v-card-title>
        <v-card-text class="pa-0">
          <v-alert type="warning" prominent border="left" outlined color="error">
            <div class="px-2">
              {{ t('card.blockingCardWarning') }}
            </div>

            <div style="width: 100%" class="pt-4 text-center">
              <v-btn
                color="error"
                :disabled="isCardBlocked"
                :loading="loading"
                @click="handleConfirmBlock"
                small
              >
                {{ isCardBlocked ? t('card.cardAlreadyBlocked') : t('card.blockCard') }}
              </v-btn>
            </div>

          </v-alert>
          <div class="block-content">
            <div class="warning-section">

            </div>
            <div class="action-section">

            </div>
          </div>
          <div class="help-section">
            <p class="help-text">{{ t('card.needHelpContactSupport') }}</p>
          </div>
        </v-card-text>
      </v-card>
    </v-card-text>
  </BaseDialog>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, computed } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import cardStoreModule from '@/stores/modules/card';

defineProps<{
  open: boolean;
}>();

interface Emits {
  (e: 'close'): void;
}

defineEmits<Emits>();

const { t } = useTranslation();

const loading = ref(false);
const showPin = ref(false);
const loadingPin = ref(false);

// Get selected card data from store
const selectedCard = computed(() => {
  return cardStoreModule.getSelectedCard();
});

const cardData = computed(() => {
  return selectedCard.value?.cardData;
});

const togglePinVisibility = async () => {
  if (!showPin.value && !selectedCard.value?.cardPin?.pin && cardData.value?.card_uuid) {
    // Fetch PIN if not already fetched and user wants to show it
    loadingPin.value = true;
    try {
      await cardStoreModule.fetchCardPin(cardData.value.card_uuid);
    } catch (error) {
      console.error('Failed to fetch card PIN:', error);
    }
    loadingPin.value = false;
  }
  showPin.value = !showPin.value;
};

const cardDetailsFull = computed(() => {
  const card = selectedCard.value;
  if (!card) return null;
  return {
    pin: card.cardPin?.pin,
  };
});

// Display PIN: show dots when loading, actual PIN when loaded and visible, or masked when hidden
const displayPin = computed(() => {
  if (loadingPin.value) {
    return '••••';
  }
  return cardDetailsFull.value?.pin || '••••';
});

// Check if card is blocked based on state
const isCardBlocked = computed(() => {
  return selectedCard.value?.cardBalance?.state === 'BLOCKED';
});

const handleConfirmBlock = async () => {
  loading.value = true;
  try {
    if (isCardBlocked.value) {
      await cardStoreModule.unblockCard(cardData.value?.card_uuid);
    } else {
      await cardStoreModule.blockCard(cardData.value?.card_uuid);
    }
  } catch (error) {
    console.error('Failed to block card:', error);
  }
  loading.value = false;
};
</script>

<style lang="scss" scoped>
@import '../../styles/variables';
@import '../../styles/mixins';

.manage-card-modal {
  .v-dialog__content {
    align-items: center;
    justify-content: center;
  }
}

.manage-card-dialog {
  background: var(--g-surface) !important;
  border-radius: var(--g-r-card) !important;
  overflow: hidden;
  width: 100%;
  max-width: 700px;
}

.modal-header {
  position: relative;
  padding: 32px 32px 0;
  display: flex;
  align-items: flex-start;
}

.modal-title {
  font-family: var(--g-font-ui);
  font-weight: 600;
  font-size: 24px;
  line-height: 1.17;
  color: var(--g-text-1);
  margin: 0 0 8px 0;
}

.modal-subtitle {
  font-family: var(--g-font-ui);
  font-weight: 400;
  font-size: 16px;
  line-height: 1.5;
  color: var(--g-text-3);
  margin: 0;
  text-align: center;
}

.close-btn {
  position: absolute;
  right: 16px;
  top: 16px;
  width: 44px;
  height: 44px;

  .v-icon {
    color: var(--g-text-3);
    font-size: 24px;
  }
}

.tabs-container {
  padding: 32px 32px 0;
  border-bottom: 1px solid var(--g-hairline-2);
}

.tabs-wrapper {
  display: flex;
  gap: 12px;
}

.tab-btn {
  font-family: var(--g-font-ui);
  font-weight: 600;
  font-size: 14px;
  line-height: 1.43;
  color: var(--g-text-3) !important;
  text-transform: none;
  padding: 0 4px 12px !important;
  min-width: auto !important;
  height: 32px !important;
  border-radius: 0 !important;

  &.active {
    color: var(--g-accent) !important;
    border-bottom: 2px solid var(--g-accent);
  }

  &:hover {
    background: transparent !important;
  }
}

.tab-content {
  padding: 32px;
}

// BlockCard styles
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
  background: var(--g-error) !important;
  border: 1px solid $border-primary !important;
  border-radius: $border-radius-md !important;
  color: var(--g-text-1) !important;
  font-family: $font-family-primary;
  font-weight: $font-weight-semibold;
  font-size: $font-size-sm;
  line-height: $line-height-normal;
  text-transform: none;
  padding: $spacing-sm $spacing-sm !important;
  min-width: 120px;

  &:hover {
    background: var(--g-error) !important;
  }

  &:disabled {
    background: var(--g-raised) !important;
  }
}

.help-section {
  margin-top: $spacing-sm;
}

.help-text {
  @include body-text($font-size-sm);
  color: $text-muted;
}

.small-input {
  width: 112px !important;
  flex: none;
}

.input-label {
  @include body-text($font-size-sm);
  font-weight: $font-weight-medium;
  color: $text-secondary;
  margin: 0 0 6px 0;
}

.pin-input {
  :deep(.v-otp-input) {
    gap: 8px !important;
  }

  :deep(input) {
    width: 32px !important;
    height: 32px !important;
    font-size: 20px !important;
    background: transparent !important;
  }

  :deep(.v-input__control) {
    background: transparent !important;
  }

  :deep(.v-input__slot) {
    background: transparent !important;
  }

  :deep(.v-text-field__slot) {
    background: transparent !important;
  }

  :deep(.v-text-field) {
    background: transparent !important;
  }
}

.form-row {
  display: flex;
  justify-content: center;
  gap: $spacing-md;
  width: 100%;
  margin: 0 auto;
}

.pin-container {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.eye-btn {
  position: absolute;
  left: 50%;
  transform: translateX(150px);
  bottom: 20px;
}
</style>
