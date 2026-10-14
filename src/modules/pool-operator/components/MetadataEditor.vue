<template>
  <div class="mb-4">
    <label class="text-body-2 font-weight-medium">{{ $t('poolOperator.poolMetadata') }}</label>

    <v-text-field
      v-model="url"
      :label="$t('poolOperator.metadataUrl')"
      :rules="[(v) => !v || v.length <= 64 || 'Max 64 characters']"
      :hint="$t('poolOperator.metadataUrlHint')"
      variant="outlined"
      density="compact"
      persistent-hint
      class="mt-2"
      @update:model-value="emitUpdate"
    />

    <v-text-field
      v-model="hash"
      :label="$t('poolOperator.metadataHash')"
      :hint="$t('poolOperator.metadataHashHint')"
      readonly
      variant="outlined"
      density="compact"
      persistent-hint
      class="mt-3 g-mono"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

interface MetadataValue {
  url: string;
  hash: string;
}

const props = defineProps<{ modelValue: MetadataValue }>();
const emit = defineEmits(['update:modelValue']);

const url = ref(props.modelValue?.url || '');
const hash = ref(props.modelValue?.hash || '');

function emitUpdate() {
  emit('update:modelValue', { url: url.value, hash: hash.value.trim() });
}
</script>
