<template>
  <div style="display: flex; flex-direction: row">
    <v-select
      v-model="selectedCountry"
      :label="$t('card.countryCode')"
      :items="countries"
      return-object
      outlined
      :dense="dense"
      hide-details
      item-text="dialCode"
      style="max-width: 180px;"
      class="country-code-select"
      :disabled="disabled"
      attach
      :menu-props="{ maxHeight: 200 }"
    >
      <template v-slot:selection="{ item }">
        <span class="d-flex align-center justify-start" style="width: 100%;">
          <flag :iso="item.countryCode.toLowerCase()" style="width: 24px; height: 16px; margin-right: 4px;"></flag>
          +{{ item.dialCode }}
        </span>
      </template>
      <template v-slot:item="{ item, attrs, on }">
        <v-list-item v-on="on" v-bind="attrs" dense class="px-2">
          <v-list-item-avatar size="24" tile>
            <flag :iso="item.countryCode.toLowerCase()" style="width: 28px; height: 20px;"></flag>
          </v-list-item-avatar>
          <v-list-item-content>
            <v-list-item-title>
              +{{ item.dialCode }} {{ item.countryName }}
            </v-list-item-title>
          </v-list-item-content>
        </v-list-item>
      </template>
    </v-select>
    <v-text-field
      v-model="phoneNumberLocal"
      outlined
      :dense="dense"
      :label="label"
      type="tel"
      :placeholder="placeholder"
      :disabled="disabled"
      :rules="allRules"
      class="phone-input phone-number-input"
      @keydown="phoneKeydown($event)"
      hide-details
    />
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import {
  parsePhoneNumber,
  getCountryCodeForRegionCode,
  getSupportedRegionCodes, ParsedPhoneNumber,
} from 'awesome-phonenumber';

// Generate countries list from awesome-phonenumber metadata
const generateCountriesList = () => {
  const regionCodes = getSupportedRegionCodes();
  const countries = regionCodes.map(code => {
    const dialCode = getCountryCodeForRegionCode(code);
    return {
      countryCode: code,
      dialCode: dialCode?.toString() || '',
      countryName: new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code
    };
  }).filter(country => country.dialCode); // Filter out countries without dial codes

  // Sort by country name
  return countries.sort((a, b) => a.countryName.localeCompare(b.countryName));
};

export default defineComponent({
  name: 'PhoneNumberInput',
  props: {
    dense: {
      type: Boolean,
      default: false
    },
    disabled: {
      type: Boolean,
      default: false
    },
    label: {
      type: String,
      default: ''
    },
    placeholder: {
      type: String,
      default: ''
    },
    value: {
      type: String,
      default: ''
    },
    rules: {
      type: Array,
      default: () => []
    }
  },
  data() {
    const countries = generateCountriesList();
    return {
      phoneNumberLocal: '',
      parsedPhoneNumber: null as ParsedPhoneNumber,
      selectedCountry: countries.find(c => c.countryCode === 'US') || countries[0],
      countries
    };
  },
  computed: {
    isValid(): boolean {
      return !!(this.parsedPhoneNumber?.valid);
    },
    allRules() {
      // Combine passed rules with awesome-phonenumber validation
      const awesomePhoneRule = (value: string) => {
        if (!value) return true; // Let required rule handle empty values
        return this.isValid || this.$i18n.t('common.invalidPhoneNumber');
      };
      return [...this.rules, awesomePhoneRule];
    }
  },
  methods: {
    phoneKeydown(e: KeyboardEvent) {
      if (!(/^[0-9-+]|(Backspace|ArrowLeft|ArrowRight|Shift|End|Delete|Home)/).test(e.key)) {
        e.preventDefault();
      }
    },
    parsePhone(phoneNumber: string) {
      if (phoneNumber.startsWith('+')) {
        const parsed = parsePhoneNumber(phoneNumber);
        if (parsed.valid) {
          this.phoneNumberLocal = parsed.number?.national || phoneNumber;
          const country = this.countries.find(c => c.countryCode === parsed.regionCode);
          if (country) {
            this.selectedCountry = country;
          }
        }
      } else {
        this.phoneNumberLocal = phoneNumber;
      }
    },
  },
  mounted() {
    if (this.value) {
      this.parsePhone(this.value);
    }
  },
  watch: {
    value(newVal: string) {
      if (newVal !== this.phoneNumberLocal) {
        this.parsePhone(newVal);
      }
    },
    phoneNumberLocal(newVal: string) {
      if (newVal.startsWith('+')) {
        const parsed = parsePhoneNumber(newVal);
        if (parsed.valid) {
          const country = this.countries.find(c => c.countryCode === parsed.regionCode);
          if (country) {
            this.selectedCountry = country;
          }
        }
      }
      this.parsedPhoneNumber = parsePhoneNumber(newVal, { regionCode: this.selectedCountry.countryCode });
      this.$emit('input', this.parsedPhoneNumber?.number?.e164 || newVal);
      this.$emit('change', this.parsedPhoneNumber);
    },
    selectedCountry() {
      if (this.phoneNumberLocal) {
        this.parsedPhoneNumber = parsePhoneNumber(this.phoneNumberLocal, { regionCode: this.selectedCountry.countryCode });
        this.$emit('input', this.parsedPhoneNumber?.number?.e164 || this.phoneNumberLocal);
        this.$emit('change', this.parsedPhoneNumber);
      }
    }
  },
});
</script>

<style scoped>
.phone-input {
  flex: 1;
}

.country-code-select :deep(.v-input__control) {
  border-top-right-radius: 0 !important;
  border-bottom-right-radius: 0 !important;
}

.country-code-select :deep(.v-text-field__slot) {
  border-top-right-radius: 0 !important;
  border-bottom-right-radius: 0 !important;
}

.country-code-select :deep(fieldset) {
  border-top-right-radius: 0 !important;
  border-bottom-right-radius: 0 !important;
}

.phone-number-input :deep(fieldset) {
  border-top-left-radius: 0 !important;
  border-bottom-left-radius: 0 !important;
}
</style>
