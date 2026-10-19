<template>
  <div class="card-details">
    <p v-if="stillMissing" class="t-body-sm card-details__notice" role="status">{{ t('card.details.stillMissing') }}</p>
    <p class="t-body-sm">{{ t('card.details.latinHint') }}</p>

    <v-form ref="form" class="card-details__form" @submit.prevent>
      <template v-for="group in groups" :key="group.id">
        <div class="card-details__group">
          <h3 class="t-label">{{ group.title }}</h3>
          <p v-if="group.caption" class="t-caption">{{ group.caption }}</p>
        </div>

        <template v-for="field in group.fields" :key="field">
          <div v-if="field === 'phone'" class="card-details__full">
            <PhoneNumberInput
              :model-value="values.phone"
              :label="t('card.phone')"
              :placeholder="t('card.enterPhone')"
              :rules="[serverRule('phone'), rules.required()]"
              dense
              @update:model-value="update('phone', $event)"
            />
          </div>
          <v-text-field
            v-else-if="field === 'birthDate'"
            :model-value="values.birthDate"
            type="date"
            :label="t('card.details.birthDate')"
            :max="latestBirthDate"
            min="1900-01-01"
            :rules="[serverRule('birthDate'), rules.required(), adult]"
            density="compact"
            variant="outlined"
            @update:model-value="update('birthDate', $event)"
          />
          <CardCountrySelect
            v-else-if="field === 'country' || field === 'nationality'"
            :model-value="values[field]"
            :label="field === 'country' ? t('card.country') : t('card.details.nationality')"
            :placeholder="t('card.selectCountry')"
            :rules="[serverRule(field), rules.required()]"
            @update:model-value="update(field, $event)"
          />
          <v-text-field
            v-else-if="isTextField(field)"
            :class="{ 'card-details__full': field === 'address' }"
            :model-value="values[field]"
            :label="TEXT_FIELDS[field].label()"
            :hint="TEXT_FIELDS[field].kind === 'name' ? t('card.details.asOnYourId') : undefined"
            :rules="textRules(field)"
            :maxlength="CARDHOLDER_LIMITS[field]"
            :autocomplete="TEXT_FIELDS[field].autocomplete"
            density="compact"
            variant="outlined"
            @update:model-value="update(field, $event)"
            @blur="tidy(field)"
          />
        </template>
      </template>
    </v-form>

    <p v-if="error" class="t-body-sm card-details__error" role="alert">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import rules from '@/utils/rules';
import { useTranslation } from '@/shared/composables/useTranslation';
import PhoneNumberInput from '@/shared/components/PhoneNumberInput.vue';
import cardStore from '@/stores/modules/card';
import { providerReason } from '@/stores/modules/cardApiErrors';
import {
  CARDHOLDER_LIMITS, PERSONAL_FIELDS, RESIDENCE_FIELDS,
  cardholderFieldErrors, emptyCardholderDetails, invalidCharacters, isAdultBirthDate, latestAdultBirthDate,
  residentialAddress, toCardholderPayload, toProviderText,
  type CardholderField, type DetailsSaveResult, type TextKind,
} from '@/modules/wallet/utils/cardholderDetails';
import CardCountrySelect from '../../ui/CardCountrySelect.vue';

type TextField = keyof typeof CARDHOLDER_LIMITS;

const props = withDefaults(defineProps<{
  /** The missing fields, from `GET /cards/cardholder-details/missing`. */
  fields: CardholderField[];
  /** A save went through but Zione still lists these fields. */
  stillMissing?: boolean;
}>(), { stillMissing: false });

const { t } = useTranslation();

const TEXT_FIELDS: Record<TextField, { kind: TextKind; label: () => string; autocomplete: string }> = {
  firstName: { kind: 'name', label: () => t('card.details.firstName'), autocomplete: 'given-name' },
  lastName: { kind: 'name', label: () => t('card.details.lastName'), autocomplete: 'family-name' },
  address: { kind: 'text', label: () => t('card.streetAddress'), autocomplete: 'address-line1' },
  city: { kind: 'text', label: () => t('card.city'), autocomplete: 'address-level2' },
  region: { kind: 'text', label: () => t('card.stateProvince'), autocomplete: 'address-level1' },
  zipCode: { kind: 'text', label: () => t('card.zipCode'), autocomplete: 'postal-code' },
};

const form = ref<{ validate: () => Promise<{ valid: boolean }> } | null>(null);
const values = reactive(emptyCardholderDetails());
const serverErrors = ref<Partial<Record<CardholderField, string>>>({});
const error = ref('');
const latestBirthDate = latestAdultBirthDate(new Date());

const groups = computed(() => [
  { id: 'personal', title: t('card.details.aboutYou'), caption: '', fields: PERSONAL_FIELDS.filter(field => props.fields.includes(field)) },
  { id: 'home', title: t('card.details.homeAddress'), caption: t('card.details.homeAddressCaption'), fields: RESIDENCE_FIELDS.filter(field => props.fields.includes(field)) },
].filter(group => group.fields.length));

const isTextField = (field: CardholderField): field is TextField => field in TEXT_FIELDS;

/** Zione's own message for a field after a refused save, until the field is edited. */
const serverRule = (field: CardholderField) => () => serverErrors.value[field] || true;

const adult = (value: string) => isAdultBirthDate(value, new Date()) || t('card.details.mustBeAdult');

function textRules(field: TextField) {
  const { kind } = TEXT_FIELDS[field];
  return [
    serverRule(field),
    rules.required(),
    (value: string) => !value || value.length <= CARDHOLDER_LIMITS[field] || t('card.fieldTooLong', { max: CARDHOLDER_LIMITS[field] }),
    (value: string) => {
      const refused = invalidCharacters(value || '', kind);
      if (!refused.length) return true;
      return t(kind === 'name' ? 'card.details.nameCharacters' : 'card.details.textCharacters', { chars: refused.join(' ') });
    },
  ];
}

function update(field: CardholderField, value: string | null): void {
  values[field] = value ?? '';
  if (serverErrors.value[field]) serverErrors.value = { ...serverErrors.value, [field]: undefined };
}

/** Converts accents and punctuation as soon as the user leaves the field, so they see the result. */
function tidy(field: TextField): void {
  values[field] = toProviderText(values[field]);
}

/**
 * Validates and saves the shown fields. Null when something needs fixing; the reason is shown
 * on the field or under the form.
 */
async function save(): Promise<DetailsSaveResult | null> {
  error.value = '';
  for (const field of props.fields) if (isTextField(field)) tidy(field);
  if (!(await form.value?.validate())?.valid) return null;
  try {
    const remaining = await cardStore.fillCardholderDetails(toCardholderPayload(values, props.fields));
    const homeSaved = !RESIDENCE_FIELDS.some(field => remaining.includes(field));
    return { remaining, residential: homeSaved ? residentialAddress(values, props.fields) : null };
  } catch (caught: unknown) {
    const fieldErrors = cardholderFieldErrors(caught);
    if (Object.keys(fieldErrors).length) {
      serverErrors.value = fieldErrors;
      error.value = t('card.details.fixHighlighted');
      await form.value?.validate();
    } else {
      error.value = `${t('card.details.saveFailed')} ${providerReason(caught) || t('card.pleaseTryAgain')}`;
    }
    return null;
  }
}

defineExpose({ save });
</script>

<style lang="scss" scoped>
.card-details {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);

  p {
    margin: 0;
  }
}

.card-details__form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 var(--g-s-3);
}

.card-details__group {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  margin-bottom: var(--g-s-3);

  &:not(:first-child) {
    margin-top: var(--g-s-2);
  }

  h3 {
    margin: 0;
    color: var(--g-text-2);
  }
}

.card-details__full {
  grid-column: 1 / -1;
}

.card-details__notice {
  color: var(--g-warning);
}

.card-details__error {
  color: var(--g-error);
}

@media (max-width: 520px) {
  .card-details__form {
    grid-template-columns: 1fr;
  }
}
</style>
