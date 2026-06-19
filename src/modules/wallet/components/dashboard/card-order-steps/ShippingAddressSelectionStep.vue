<template>
  <div>
    <!-- Address Selection Options -->
    <v-radio-group v-model="selectedOption" hide-details class="address-radio-group mt-0 pb-5" row>
      <v-radio
        value="existing"
        color="primary"
        :disabled="!hasSavedAddress"
      >
        <template v-slot:label>
          <div class="radio-label">
              <span class="label-title">
                {{ $t('card.useExistingAddress') }}
                <span v-if="!hasSavedAddress" class="disabled-badge">{{ $t('common.comingSoon') }}</span>
              </span>
            <span class="label-description">{{ $t('card.useAddressRegisteredWithKaiserex') }}</span>
          </div>
        </template>
      </v-radio>
      <v-radio value="new" color="primary">
        <template v-slot:label>
          <div class="radio-label">
            <span class="label-title">{{ $t('card.enterNewAddress') }}</span>
            <span class="label-description">{{ $t('card.provideNewShippingAddress') }}</span>
          </div>
        </template>
      </v-radio>
    </v-radio-group>

    <!-- Address Form -->
    <v-card flat class="transparent">
      <v-card-text class="px-0">
        <v-form ref="form" v-model="isFormValid">
          <v-row>
            <v-col cols="12">
              <PhoneNumberInput
                v-model="localAddress.phone"
                :label="t('card.phone')"
                :placeholder="t('card.enterPhone')"
                :disabled="selectedOption === 'existing'"
                :rules="[rules.required()]"
                dense
              />
            </v-col>
            <v-col cols="6">
              <v-text-field
                v-model="localAddress.streetAddress"
                :label="$t('card.streetAddress')"
                dense
                outlined
                :placeholder="$t('card.enterStreetAddress')"
                :disabled="selectedOption === 'existing'"
                :rules="[rules.required()]"
                hide-details
              />
            </v-col>
            <v-col cols="6">
              <v-text-field
                v-model="localAddress.city"
                :label="$t('card.city')"
                dense
                outlined
                :placeholder="$t('card.enterCity')"
                :disabled="selectedOption === 'existing'"
                :rules="[rules.required()]"
                hide-details
              />
            </v-col>
            <v-col cols="4">
              <v-text-field
                v-model="localAddress.stateProvince"
                :label="$t('card.stateProvince')"
                dense
                outlined
                :placeholder="$t('card.enterState')"
                :disabled="selectedOption === 'existing'"
                :rules="[rules.required()]"
                hide-details
              />
            </v-col>
            <v-col cols="4">
              <v-text-field
                v-model="localAddress.zipCode"
                :label="$t('card.zipCode')"
                dense
                outlined
                :placeholder="$t('card.enterZipCode')"
                :rules="[rules.required()]"
                :disabled="selectedOption === 'existing'"
                hide-details
              />
            </v-col>
            <v-col cols="4">
              <v-select
                v-model="localAddress.countryCode"
                :label="$t('card.country')"
                :items="countries"
                item-text="label"
                item-value="code"
                dense
                outlined
                :placeholder="$t('card.selectCountry')"
                :disabled="selectedOption === 'existing'"
                :rules="[rules.required()]"
                hide-details
                :menu-props="{ top: true }"
              >
                <template v-slot:selection="{ item }">
                  <span class="d-flex align-center">
                    <flag :iso="item.code.toLowerCase()" style="font-size: 16px; margin-right: 8px;"></flag>
                    {{ item.label }}
                  </span>
                </template>
                <template v-slot:item="{ item, attrs, on }">
                  <v-list-item v-on="on" v-bind="attrs" dense>
                    <v-list-item-avatar size="24" tile>
                      <flag :iso="item.code.toLowerCase()" style="font-size: 20px;"></flag>
                    </v-list-item-avatar>
                    <v-list-item-content>
                      <v-list-item-title>{{ item.label }}</v-list-item-title>
                    </v-list-item-content>
                  </v-list-item>
                </template>
              </v-select>
            </v-col>
          </v-row>
        </v-form>
      </v-card-text>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import countries from '@/plugins/countries';
import cardStore from '@/stores/modules/card';
import rules from '@/utils/rules';
import PhoneNumberInput from '@/shared/components/PhoneNumberInput.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
const isFormValid = ref<boolean>(false);
const form = ref(null);
const { t } = useTranslation()

interface AddressData {
  streetAddress: string;
  city: string;
  stateProvince: string;
  zipCode: string;
  countryCode: string;
  phone: string;
}

interface Props {
  address: AddressData;
}

interface Emits {
  (e: 'back'): void;
  (e: 'submit', payload: { address?: AddressData }): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

// Get saved delivery address from last physical card
const getSavedDeliveryAddress = (): AddressData | null => {
  const cards = cardStore.state.cards || [];
  const physicalCards = cards.filter(card => card.cardData?.own_type === 'physical');

  if (physicalCards.length === 0) return null;

  // Get the most recent physical card (by created_at or updated_at)
  const lastPhysicalCard = physicalCards.sort((a, b) => {
    const dateA = new Date(b.cardData?.updated_at || b.cardData?.created_at || 0).getTime();
    const dateB = new Date(a.cardData?.updated_at || a.cardData?.created_at || 0).getTime();
    return dateA - dateB;
  })[0];

  // Check if card has delivery object
  const delivery = lastPhysicalCard.cardData?.delivery;
  if (!delivery) return null;

  return {
    streetAddress: delivery.address || '',
    city: delivery.city || '',
    stateProvince: delivery.region || '',
    zipCode: delivery.zip || '',
    countryCode: delivery.country_code || '',
    phone: delivery.phone || '',
  };
};

// Local state
const selectedOption = ref<'existing' | 'new'>('existing');
const savedAddress = getSavedDeliveryAddress();
const localAddress = ref<AddressData>(savedAddress || { ...props.address });
const hasSavedAddress = computed(() => !!savedAddress);

// Load saved address on mount - prefill if available
onMounted(() => {
  if (savedAddress && selectedOption.value === 'existing') {
    localAddress.value = { ...savedAddress };
  }
});

// Watch for option changes - fill or clear fields
watch(selectedOption, (newOption) => {
  if (newOption === 'existing' && savedAddress) {
    // Fill fields with saved address
    localAddress.value = { ...savedAddress };
  } else if (newOption === 'new') {
    // Clear all fields
    localAddress.value = {
      streetAddress: '',
      city: '',
      stateProvince: '',
      zipCode: '',
      countryCode: '',
      phone: '',
    };
    // Clear all errors

    if (form.value) {
      form.value.resetValidation()
    }
  }
});

watch(
  () => props.address,
  newVal => {
    if (selectedOption.value === 'new') {
      localAddress.value = { ...newVal };
    }
  },
  { deep: true }
);

// Handlers - exposed so parent can call them
const handleBack = () => {
  emit('back');
};

const handleContinue = () => {
  if (form.value.validate()) {
    emit('submit', {
      address: { ...localAddress.value }
    });
    return;
  }
};

defineExpose({
  handleBack,
  handleContinue
});
</script>

<style lang="scss" scoped>
@import '../../../styles/variables';
@import '../../../styles/mixins';

.shipping-address-selection {
  width: 100%;
  @include flex-column;
}

.address-options {
  background: transparent;
  border-radius: $border-radius-lg;
  padding: $spacing-lg;
}

.address-radio-group {
  :deep(.v-input__control) {
    width: 100%;
  }

  :deep(.v-input__slot) {
    display: flex;
    flex-direction: row;
    gap: $spacing-lg;
    width: 100%;
  }

  :deep(.v-radio) {
    flex: 1;
    margin: 0 !important;
    padding: $spacing-md;
    border-radius: $border-radius-md;
    border: 1px solid $border-primary;
    transition: all 0.3s ease;

    &:not(:last-child) {
      margin-right: $spacing-lg !important;
    }

    &:hover {
      border-color: rgba($primary-cyan, 0.5);
    }

    &.v-item--active {
      border-color: $primary-cyan;
      background: rgba($primary-cyan, 0.05);
    }

    &.v-radio--is-disabled {
      opacity: 0.5;
      cursor: not-allowed;

      &:hover {
        border-color: $border-primary;
      }
    }

    // Remove hover effect from radio button circle
    .v-input--selection-controls__ripple {
      &:hover::before {
        opacity: 0 !important;
      }
    }
  }

  :deep(.v-label) {
    width: 100%;
  }
}

.radio-label {
  display: flex;
  flex-direction: column;
  gap: $spacing-xs;
}

.label-title {
  font-family: $font-family-primary;
  font-weight: $font-weight-semibold;
  font-size: $font-size-base;
  color: $text-primary;
  display: flex;
  align-items: center;
  gap: $spacing-sm;
}

.disabled-badge {
  display: inline-block;
  padding: 2px 8px;
  background: rgba(#ff9800, 0.15);
  color: #ff9800;
  font-size: $font-size-xs;
  font-weight: $font-weight-medium;
  border-radius: 4px;
}

.label-description {
  font-family: $font-family-primary;
  font-size: $font-size-sm;
  color: $text-muted;
}

.address-form {
  @include flex-column;
  padding: $spacing-lg;
  background: $background-card;
  border-radius: $border-radius-lg;
}

.form-row {
  @include flex-column;
  gap: $spacing-xs;

  &.two-columns {
    flex-direction: row;
    gap: $spacing-lg;
  }
}

.input-full {
  width: 100%;
  @include flex-column;
  gap: $spacing-xs;
}

.input-half {
  flex: 1;
  @include flex-column;
  gap: $spacing-xs;
}

.input-label {
  font-family: $font-family-primary;
  font-weight: $font-weight-medium;
  font-size: $font-size-sm;
  color: $text-secondary;
}

@media (max-width: $breakpoint-sm) {
  .address-radio-group {
    :deep(.v-input__slot) {
      flex-direction: column;
    }

    :deep(.v-radio) {
      width: 100%;
    }
  }

  .form-row.two-columns {
    flex-direction: column;
    gap: $spacing-lg;
  }
}
</style>
