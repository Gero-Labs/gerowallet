<template>
  <div class="order-address">
    <div v-if="known" class="order-address__choice" role="radiogroup" :aria-label="t('card.shippingAddress')">
      <CardOption
        name="address-choice"
        value="known"
        :title="known.source === 'residential' ? t('card.shipToHomeAddress') : t('card.shipToLastAddress')"
        :description="knownLine"
        :selected="choice === 'known'"
        @select="choose('known')"
      />
      <CardOption
        name="address-choice"
        value="new"
        :title="t('card.enterNewAddress')"
        :description="t('card.provideNewShippingAddress')"
        :selected="choice === 'new'"
        @select="choose('new')"
      />
    </div>

    <p v-if="choice === 'new'" class="t-body-sm order-address__hint">{{ t('card.details.latinHint') }}</p>

    <v-form ref="form" class="order-address__form" @submit.prevent>
      <div class="order-address__full">
        <PhoneNumberInput
          :model-value="address.phone"
          :label="t('card.phone')"
          :placeholder="t('card.enterPhone')"
          :disabled="isLocked('phone')"
          :rules="[rules.required()]"
          dense
          @update:model-value="update('phone', $event)"
        />
      </div>
      <v-text-field
        class="order-address__full"
        :model-value="address.streetAddress"
        :label="t('card.streetAddress')"
        :placeholder="t('card.enterStreetAddress')"
        :disabled="isLocked('streetAddress')"
        :rules="textRules('streetAddress')"
        :counter="ADDRESS_LIMITS.streetAddress"
        :maxlength="ADDRESS_LIMITS.streetAddress"
        autocomplete="shipping address-line1"
        density="compact"
        variant="outlined"
        @update:model-value="update('streetAddress', $event)"
        @blur="tidy('streetAddress')"
      />
      <v-text-field
        :model-value="address.city"
        :label="t('card.city')"
        :placeholder="t('card.enterCity')"
        :disabled="isLocked('city')"
        :rules="textRules('city')"
        :maxlength="ADDRESS_LIMITS.city"
        autocomplete="shipping address-level2"
        density="compact"
        variant="outlined"
        @update:model-value="update('city', $event)"
        @blur="tidy('city')"
      />
      <v-text-field
        :model-value="address.stateProvince"
        :label="t('card.stateProvince')"
        :placeholder="t('card.enterState')"
        :disabled="isLocked('stateProvince')"
        :rules="textRules('stateProvince')"
        :maxlength="ADDRESS_LIMITS.stateProvince"
        autocomplete="shipping address-level1"
        density="compact"
        variant="outlined"
        @update:model-value="update('stateProvince', $event)"
        @blur="tidy('stateProvince')"
      />
      <v-text-field
        :model-value="address.zipCode"
        :label="t('card.zipCode')"
        :placeholder="t('card.enterZipCode')"
        :disabled="isLocked('zipCode')"
        :rules="textRules('zipCode')"
        :counter="ADDRESS_LIMITS.zipCode"
        :maxlength="ADDRESS_LIMITS.zipCode"
        autocomplete="shipping postal-code"
        density="compact"
        variant="outlined"
        @update:model-value="update('zipCode', $event)"
        @blur="tidy('zipCode')"
      />
      <CardCountrySelect
        :model-value="address.countryCode"
        :label="t('card.country')"
        :placeholder="t('card.selectCountry')"
        :disabled="isLocked('countryCode')"
        :rules="[rules.required()]"
        @update:model-value="update('countryCode', $event)"
      />
    </v-form>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import countries from '@/plugins/countries';
import rules from '@/utils/rules';
import { useTranslation } from '@/shared/composables/useTranslation';
import PhoneNumberInput from '@/shared/components/PhoneNumberInput.vue';
import {
  ADDRESS_LIMITS, addressLine, emptyAddress, type KnownAddress, type ShippingAddress,
} from '@/modules/wallet/utils/cardOrder';
import { invalidCharacters, toProviderText } from '@/modules/wallet/utils/cardholderDetails';
import CardCountrySelect from '../../ui/CardCountrySelect.vue';
import CardOption from '../../ui/CardOption.vue';

type TextKey = keyof typeof ADDRESS_LIMITS;

const props = defineProps<{
  address: ShippingAddress;
  /** An address the wallet already knows; offered as the first choice when there is one. */
  known?: KnownAddress;
}>();

const emit = defineEmits<{ (e: 'update:address', value: ShippingAddress): void }>();

const { t } = useTranslation();
const form = ref<{ validate: () => Promise<{ valid: boolean }>; resetValidation: () => void } | null>(null);
const choice = ref<'known' | 'new'>(props.known ? 'known' : 'new');

const knownLine = computed(() => {
  const address = props.known?.address;
  if (!address) return '';
  return addressLine(address, countries.find(country => country.code === address.countryCode)?.label);
});

const maxLength = (max: number) => (value: string) => !value || value.length <= max || t('card.fieldTooLong', { max });

const latinOnly = (value: string) => {
  const refused = invalidCharacters(value || '', 'text');
  return !refused.length || t('card.details.textCharacters', { chars: refused.join(' ') });
};

const textRules = (key: TextKey) => [rules.required(), maxLength(ADDRESS_LIMITS[key]), latinOnly];

function acceptable(key: keyof ShippingAddress, value: string): boolean {
  if (!value) return false;
  if (key === 'phone' || key === 'countryCode') return true;
  return value.length <= ADDRESS_LIMITS[key] && !invalidCharacters(value, 'text').length;
}

/**
 * A field is locked while the known address is chosen and supplies a usable value for it. An
 * empty or unusable value stays editable, so the form can always be completed.
 */
function isLocked(key: keyof ShippingAddress): boolean {
  return choice.value === 'known' && !!props.known && acceptable(key, props.known.address[key]);
}

function update<K extends keyof ShippingAddress>(key: K, value: ShippingAddress[K] | null): void {
  emit('update:address', { ...props.address, [key]: value ?? '' });
}

/** Converts accents and punctuation as soon as the user leaves the field, so they see the result. */
function tidy(key: TextKey): void {
  const tidied = toProviderText(props.address[key]);
  if (tidied !== props.address[key]) update(key, tidied);
}

function choose(next: 'known' | 'new'): void {
  choice.value = next;
  // The phone belongs to the person, not the address, so it carries over.
  const phone = props.address.phone;
  emit('update:address', next === 'known' && props.known
    ? { ...props.known.address, phone: props.known.address.phone || phone }
    : { ...emptyAddress(), phone });
  form.value?.resetValidation();
}

/** True when every field passes; also shows the errors. */
async function validate(): Promise<boolean> {
  return (await form.value?.validate())?.valid ?? false;
}

defineExpose({ validate });
</script>

<style lang="scss" scoped>
.order-address {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
}

.order-address__choice {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
  gap: var(--g-s-3);
}

.order-address__hint {
  margin: 0;
}

.order-address__form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 var(--g-s-3);
}

.order-address__full {
  grid-column: 1 / -1;
}

@media (max-width: 520px) {
  .order-address__form {
    grid-template-columns: 1fr;
  }
}
</style>
