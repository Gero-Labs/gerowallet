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
      :rules="[rules.required(), (v => parseFloat(v) <= maximum || 'Insufficient Funds'), (v => parseFloat(v) > minimum || `Minimum Required ${minimum}`)]"
      :readonly="readOnly"
    ></v-text-field>
  </v-form>
</template>
<script>
import rules from '@/utils/rules';

export default {
  name: 'CurrencyTextField',
  props: {
    value: {
      type: [String, Number],
      default: '0'
    },
    maximum: {
      type: Number,
      default: Infinity
    },
    minimum: {
      type: Number,
      default: 0,
    },
    decimals: {
      type: Number,
      default: 2
    },
    readOnly: {
      type: Boolean,
      default: false
    }
  },
  data() {
    return {
      valid: false,
      rules,
    };
  },
  computed: {
    rawValue: {
      get() {
        return this.cleanValue(this.value);
      },
      set(newValue) {
        this.$emit('input', newValue || '0');
      }
    },
    formattedValue: {
      get() {
        return this.formatNumber(this.rawValue);
      },
      set(value) {
        this.rawValue = this.cleanValue(value || '0');
      }
    }
  },
  methods: {
    validate() {
      return this.$refs.form.validate();
    },
    handleInput(value) {
      const cleanedValue = this.cleanValue(value);
      this.rawValue = cleanedValue.length > 0 ? cleanedValue : '0';
      this.$emit('change', value.replaceAll(',', ''))
    },
    cleanValue(value) {
      return String(value).replace(/[^0-9.]/g, '').substring(0, 16);
    },
    formatNumber(value) {
      if (!value) return '0';
      const number = parseFloat(value);
      return isNaN(number) ? '0' : number.toLocaleString('en-US', { maximumFractionDigits: this.decimals });
    }
  }
};
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
  background: transparent !important;
  padding: 0 !important;
}
</style>
