<template>
  <div class="order-address">
    <div class="order-address__choice" role="radiogroup" :aria-label="t('card.shippingAddress')">
      <CardOption
        name="address-choice"
        value="existing"
        :title="t('card.useExistingAddress')"
        :description="t('card.useAddressRegisteredWithKaiserex')"
        :selected="choice === 'existing'"
        :disabled="!savedAddress"
        @select="choose('existing')"
      >
        <template v-if="!savedAddress" #badge>
          <CardChip>{{ t('common.comingSoon') }}</CardChip>
        </template>
      </CardOption>
      <CardOption
        name="address-choice"
        value="new"
        :title="t('card.enterNewAddress')"
        :description="t('card.provideNewShippingAddress')"
        :selected="choice === 'new'"
        @select="choose('new')"
      />
    </div>

    <v-form ref="form" class="order-address__form" @submit.prevent>
      <div class="order-address__full">
        <PhoneNumberInput
          :value="address.phone"
          :label="t('card.phone')"
          :placeholder="t('card.enterPhone')"
          :disabled="locked"
          :rules="[rules.required()]"
          dense
          @input="update('phone', $event)"
        />
      </div>
      <v-text-field
        class="order-address__full"
        :value="address.streetAddress"
        :label="t('card.streetAddress')"
        :placeholder="t('card.enterStreetAddress')"
        :disabled="locked"
        :rules="[rules.required(), maxLength(ADDRESS_LIMITS.streetAddress)]"
        :counter="ADDRESS_LIMITS.streetAddress"
        :maxlength="ADDRESS_LIMITS.streetAddress"
        dense
        outlined
        @input="update('streetAddress', $event)"
      />
      <v-text-field
        :value="address.city"
        :label="t('card.city')"
        :placeholder="t('card.enterCity')"
        :disabled="locked"
        :rules="[rules.required(), maxLength(ADDRESS_LIMITS.city)]"
        :maxlength="ADDRESS_LIMITS.city"
        dense
        outlined
        @input="update('city', $event)"
      />
      <v-text-field
        :value="address.stateProvince"
        :label="t('card.stateProvince')"
        :placeholder="t('card.enterState')"
        :disabled="locked"
        :rules="[rules.required(), maxLength(ADDRESS_LIMITS.stateProvince)]"
        :maxlength="ADDRESS_LIMITS.stateProvince"
        dense
        outlined
        @input="update('stateProvince', $event)"
      />
      <v-text-field
        :value="address.zipCode"
        :label="t('card.zipCode')"
        :placeholder="t('card.enterZipCode')"
        :disabled="locked"
        :rules="[rules.required(), maxLength(ADDRESS_LIMITS.zipCode)]"
        :counter="ADDRESS_LIMITS.zipCode"
        :maxlength="ADDRESS_LIMITS.zipCode"
        dense
        outlined
        @input="update('zipCode', $event)"
      />
      <v-select
        :value="address.countryCode"
        :label="t('card.country')"
        :items="countries"
        item-text="label"
        item-value="code"
        :placeholder="t('card.selectCountry')"
        :disabled="locked"
        :rules="[rules.required()]"
        attach
        :menu-props="{ top: true, offsetY: true }"
        dense
        outlined
        @change="update('countryCode', $event)"
      >
        <template #selection="{ item }">
          <span class="order-address__country">
            <flag :iso="item.code.toLowerCase()" class="order-address__flag" />
            {{ item.label }}
          </span>
        </template>
        <template #item="{ item, attrs, on }">
          <v-list-item v-bind="attrs" dense v-on="on">
            <v-list-item-avatar size="24" tile>
              <flag :iso="item.code.toLowerCase()" class="order-address__flag" />
            </v-list-item-avatar>
            <v-list-item-content>
              <v-list-item-title>{{ item.label }}</v-list-item-title>
            </v-list-item-content>
          </v-list-item>
        </template>
      </v-select>
    </v-form>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import countries from '@/plugins/countries';
import rules from '@/utils/rules';
import { useTranslation } from '@/shared/composables/useTranslation';
import PhoneNumberInput from '@/shared/components/PhoneNumberInput.vue';
import { ADDRESS_LIMITS, emptyAddress, type ShippingAddress } from '@/modules/wallet/utils/cardOrder';
import CardChip from '../../ui/CardChip.vue';
import CardOption from '../../ui/CardOption.vue';

const props = defineProps<{
  address: ShippingAddress;
  /** The address of the last physical card, when there is one. */
  savedAddress?: ShippingAddress;
}>();

const emit = defineEmits<{ (e: 'update:address', value: ShippingAddress): void }>();

const { t } = useTranslation();
const form = ref<{ validate: () => boolean; resetValidation: () => void } | null>(null);
const choice = ref<'existing' | 'new'>(props.savedAddress ? 'existing' : 'new');
const locked = computed(() => choice.value === 'existing');

const maxLength = (max: number) => (value: string) => !value || value.length <= max || t('card.fieldTooLong', { max });

function update<K extends keyof ShippingAddress>(key: K, value: ShippingAddress[K]): void {
  emit('update:address', { ...props.address, [key]: value ?? '' });
}

function choose(next: 'existing' | 'new'): void {
  choice.value = next;
  emit('update:address', next === 'existing' && props.savedAddress ? { ...props.savedAddress } : emptyAddress());
  form.value?.resetValidation();
}

/** True when every field passes; also shows the errors. */
function validate(): boolean {
  return form.value?.validate() ?? false;
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

.order-address__form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 var(--g-s-3);
}

.order-address__full {
  grid-column: 1 / -1;
}

.order-address__country {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-2);
}

.order-address__flag {
  font-size: 16px;
}

@media (max-width: 520px) {
  .order-address__form {
    grid-template-columns: 1fr;
  }
}
</style>
