<template>
  <v-select
    :model-value="modelValue || null"
    :label="label"
    :items="countries"
    item-title="label"
    item-value="code"
    :placeholder="placeholder"
    :disabled="disabled"
    :rules="rules"
    attach
    :menu-props="{ location: 'top' }"
    density="compact"
    variant="outlined"
    @update:model-value="emit('update:modelValue', $event ?? '')"
  >
    <template #selection="{ item }">
      <span class="card-country">
        <flag :iso="item.code.toLowerCase()" class="card-country__flag" />
        {{ item.label }}
      </span>
    </template>
    <template #item="{ item, props: itemProps }">
      <v-list-item v-bind="itemProps" :title="''" density="compact">
        <v-avatar size="24" rounded="0">
          <flag :iso="item.code.toLowerCase()" class="card-country__flag" />
        </v-avatar>
        <div class="g-list-content">
          <v-list-item-title>{{ item.label }}</v-list-item-title>
        </div>
      </v-list-item>
    </template>
  </v-select>
</template>

<script setup lang="ts">
import countries from '@/plugins/countries';

withDefaults(defineProps<{
  modelValue: string;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  rules?: ((value: string) => true | string)[];
}>(), { placeholder: '', disabled: false, rules: () => [] });

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>();
</script>

<style lang="scss" scoped>
.card-country {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-2);
}

.card-country__flag {
  font-size: 16px;
}
</style>
