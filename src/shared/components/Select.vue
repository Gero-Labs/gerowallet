<template>
  <div class="custom-select">
    <label v-if="label">{{ label }}</label>

    <v-select
      solo
      class="select"
      :items="items"
      :value="value"
      :disabled="disabled"
      :readonly="readonly"
      :append-icon="readonly ? '' : 'mdi-menu-down'"
      @input="$emit('update:value', $event)"
    >
      <template v-slot:item="{ item }">
        <v-icon left>{{ item.icon }}</v-icon>
        {{ item.text }}
      </template>
      <template v-slot:selection="{ item }">
        <v-icon left>{{ item.icon }}</v-icon>
        {{ item.text }}
      </template>
    </v-select>
  </div>
</template>

<script>
export default {
  name: "SelectComponent",
  props: {
    items: {
      type: Array,
      required: true,
    },
    label: {
      type: String,
      default: "",
    },
    value: {
      required: true,
    },
    disabled: {
      type: Boolean,
      default: false,
    },
    readonly: {
      type: Boolean,
      default: false,
    },
  },
};
</script>
<style>
.custom-select {
  label {
    font-size: 14px;
    font-weight: 500;
  }

  .v-input__control > .v-input__slot {
    background-color: transparent !important;
    border: 1px solid #272930 !important;
    border-radius: 10px;

    & > .v-select__slot {
      padding: 0 10px !important;
    }
  }
}
</style>
