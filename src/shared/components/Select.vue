<template>
  <div class="custom-select" style="cursor: pointer!important;">
    <v-select item-title="name" item-value="id" return-object
      variant="solo"

      :label="label"
      :items="items"
      :model-value="modelValue"
      :disabled="disabled"
      :readonly="readonly"
      :autofocus="false"
      :menu-icon="readonly ? '' : 'mdi-menu-down'"
      @update:model-value="$emit('update:modelValue', $event)"
      hide-details
      density="compact"
      attach
    >
      <template v-slot:item="{ item , props: itemProps }"><v-list-item v-bind="itemProps"><template #title>
        <v-avatar v-if="item.icon" size="20" class="mr-2">
          <v-img :src="assets.resolveIcon(item.icon)"></v-img>
        </v-avatar>
        {{ item.name }}
      </template></v-list-item></template>
      <template v-slot:selection="{ item }">
        <v-avatar v-if="item.icon" size="20" class="mr-2">
          <v-img :src="assets.resolveIcon(item.icon)"></v-img>
        </v-avatar>
        {{ item.name }}
      </template>
    </v-select>
  </div>
</template>

<script setup lang="ts">
import assets from '@/utils/assets';

interface Props {
  items: Array<{ id?: number | string; name?: string; icon?: string }>;
  modelValue: { id?: number | string; name?: string; icon?: string } | null;
  label?: string;
  disabled?: boolean;
  readonly?: boolean;
}

defineProps<Props>()
defineEmits<{ (event: 'update:modelValue', value: Props['modelValue']): void }>();
</script>
<style>
.custom-select {
  min-width: 100%;

  :is(label) {
    font-size: 14px;
    font-weight: 500;
  }

  .v-field {
    background-color: #0F0F0F !important;
    border: 1px solid #272930 !important;
    border-radius: 10px;

    --v-field-padding-start: 0px;
    --v-field-padding-end: 0px;
    padding: 0 10px !important;
  }
}
</style>
