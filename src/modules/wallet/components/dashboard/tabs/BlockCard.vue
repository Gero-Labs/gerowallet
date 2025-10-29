<template>
  <div class="block-card">
      <h3 class="warning-title">{{ t('card.pin') }}</h3>
      <div class="form-row">
        <div class="pin-section">
          <div class="pin-container">
            <v-otp-input
              length="4"
              :readonly="true"
              :type="showPin ? 'text' : 'password'"
              :value="cardDetailsFull?.pin"
              class="pin-input"
            ></v-otp-input>
            <v-btn icon small class="eye-btn" @click="togglePinVisibility">
              <v-icon small>{{ showPin ? 'mdi-eye' : 'mdi-eye-off' }}</v-icon>
            </v-btn>
          </div>
        </div>
      </div>
      <div class="block-content">
        <div class="warning-section">
          <h3 class="warning-title">{{ t('card.temporarilyBlockCard') }}</h3>
          <p class="warning-text">
            {{ t('card.blockingCardWarning') }}
          </p>
        </div>

        <div class="action-section">
          <v-btn
            color="error"
            class="block-btn"
            :disabled="isCardBlocked"
            :loading="loading"
            @click="handleConfirmBlock"
          >
            {{ isCardBlocked ? t('card.cardAlreadyBlocked') : t('card.blockCard') }}
          </v-btn>
        </div>
      </div>

    <div class="help-section">
      <p class="help-text">{{ t('card.needHelpContactSupport') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, computed, onMounted } from 'vue';
import cardStoreModule from '@/stores/modules/card';


const { t } = useTranslation();

const loading = ref(false);
const showPin = ref(false);
// Get selected card data from store
const selectedCard = computed(() => {
  return cardStoreModule.getSelectedCard();
});

const cardData = computed(() => {
  return selectedCard.value?.cardData;
});

const togglePinVisibility = () => {
  showPin.value = !showPin.value;
};

const cardDetailsFull = computed(() => {
  const card = selectedCard.value;
  if (!card) return null;
  return {
    pin: card.cardPin?.pin,
  } as any;
});

onMounted(async () => {
  if (cardData.value?.card_uuid) {
    await cardStoreModule.fetchCardPin(cardData.value.card_uuid);
  }
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
  display: flex;
  align-items: center;
  justify-content: center;
  gap: $spacing-sm;
}
</style>
