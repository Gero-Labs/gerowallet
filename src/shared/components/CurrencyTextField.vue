<template>
  <v-form ref="form" v-model="valid">
    <v-text-field
      solo
      flat
      hide-details
      v-model="formattedValue"
      maxlength="16"
      @input="handleInput"
      class="text-right transparent"
      :rules="[rules.required, v => v <= maximum || 'Insufficient Funds']"
    ></v-text-field>
  </v-form>
</template>
<script>
import rules from '@/shared/utils/rules';

export default {
  name: 'CurrencyTextField',
  props: {
    value: {
      type: String,
      default: ''
    },
    maximum: {
      type: Number
    }
  },
  computed: {
    rawValue: {
      get() {
        return this.cleanValue(this.value);
      },
      set(newValue) {
        this.$emit('input', newValue);
      }
    },
    formattedValue: {
      get() {
        return this.formatNumber(this.rawValue);
      },
      set(value) {
        this.rawValue = this.cleanValue(value);
      }
    }
  },
  methods: {
    validate() {
      return this.$refs.form.validate()
    },
    handleInput(value) {
      const cleanedValue = this.cleanValue(value);
      if (cleanedValue.length <= 16) {
        this.rawValue = cleanedValue;
      }
    },
    cleanValue(value) {
      return value.replace(/[^0-9.]/g, '').substring(0, 16)
    },
    formatNumber(value) {
      if (!value) return "";
      const number = Number(value);
      return number.toLocaleString();
    }
  },
  data: () => ({
    valid: false,
    rules,
  })
}
</script>
<style>
.v-text-field.v-text-field--solo.text-right .v-input__control {
  direction: rtl;
}

.text-right .v-input__control input {
  direction: ltr;
  text-align: right;
  font-size: 22px;
}

.text-right .v-input__control .v-input__slot {
  background: #FFFFFF00!important;
  padding: 0!important;
}
</style>
