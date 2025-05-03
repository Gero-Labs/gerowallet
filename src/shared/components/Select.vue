<template>
  <div class="custom-select" style="cursor: pointer!important;">
    <v-select
      solo
      flat
      :label="label"
      :items="items"
      :value="value"
      :disabled="disabled"
      :readonly="readonly"
      :autofocus="false"
      :append-icon="readonly ? '' : 'mdi-menu-down'"
      @input="$emit('input', $event)"
      hide-details
      dense
    >
      <template v-slot:item="{ item }">
        <v-avatar v-if="item.icon" size="20" class="mr-2">
          <v-img :src="assets.resolveIcon(item.icon)"></v-img>
        </v-avatar>
        {{ item.name }}
      </template>
      <template v-slot:selection="{ item }">
        <v-avatar v-if="item.icon" size="20" class="mr-2">
          <v-img :src="assets.resolveIcon(item.icon)"></v-img>
        </v-avatar>
        {{ item.name }}
      </template>
    </v-select>
  </div>
</template>

<script>
import assets from '@/utils/assets';

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
  data: () => ({
    assets,
  })
}
</script>
<style>
.custom-select {
  :is(label) {
    font-size: 14px;
    font-weight: 500;
  }

  .v-input__control > .v-input__slot {
    background-color: #0F0F0F !important;
    border: 1px solid #272930 !important;
    border-radius: 10px;

    & > .v-select__slot {
      padding: 0 10px !important;
    }
  }
}
</style>
