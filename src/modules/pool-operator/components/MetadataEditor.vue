<template>
  <div class="mb-4">
    <label class="text-body-2 font-weight-medium">{{ $t('poolOperator.poolMetadata') }}</label>

    <v-text-field
      v-model="url"
      :label="$t('poolOperator.metadataUrl')"
      :rules="[(v) => !v || v.length <= 64 || 'Max 64 characters']"
      :hint="$t('poolOperator.metadataUrlHint')"
      outlined
      dense
      persistent-hint
      class="mt-2"
      @input="emitUpdate"
    />

    <v-text-field
      v-model="hash"
      :label="$t('poolOperator.metadataHash')"
      :hint="$t('poolOperator.metadataHashHint')"
      readonly
      outlined
      dense
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

const props = defineProps<{ value: MetadataValue }>();
const emit = defineEmits(['input']);

const url = ref(props.value?.url || '');
const hash = ref(props.value?.hash || '');

function emitUpdate() {
  emit('input', { url: url.value, hash: hash.value.trim() });
}
</script>
