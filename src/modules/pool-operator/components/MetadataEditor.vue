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
      @input="onUrlChange"
    >
      <template v-slot:append>
        <v-btn icon x-small :loading="fetching" @click="fetchAndHash" :disabled="!url">
          <v-icon small>mdi-download</v-icon>
        </v-btn>
      </template>
    </v-text-field>

    <v-textarea
      v-model="jsonContent"
      :label="$t('poolOperator.metadataJson')"
      :hint="$t('poolOperator.metadataJsonHint')"
      outlined
      dense
      rows="4"
      persistent-hint
      class="mt-2"
      @input="computeHash"
    />

    <div v-if="hash" class="mt-2">
      <div class="text-caption grey--text">{{ $t('poolOperator.metadataHash') }}</div>
      <div class="monospace-text text-body-2 mt-1 success--text">{{ hash }}</div>
    </div>

    <div v-if="jsonError" class="mt-1">
      <span class="text-caption error--text">{{ jsonError }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';

const { t } = useTranslation();

interface MetadataValue {
  url: string;
  hash: string;
}

const props = defineProps<{ value: MetadataValue }>();
const emit = defineEmits(['input']);

const url = ref(props.value?.url || '');
const hash = ref(props.value?.hash || '');
const jsonContent = ref('');
const jsonError = ref('');
const fetching = ref(false);

function onUrlChange() {
  hash.value = '';
  emitUpdate();
}

async function fetchAndHash() {
  if (!url.value) return;
  fetching.value = true;
  try {
    const response = await fetch(url.value);
    jsonContent.value = await response.text();
    await computeHash();
  } catch (e) {
    jsonError.value = t('poolOperator.fetchMetadataFailed');
  } finally {
    fetching.value = false;
  }
}

async function computeHash() {
  jsonError.value = '';
  if (!jsonContent.value.trim()) {
    hash.value = '';
    emitUpdate();
    return;
  }

  try {
    // Validate JSON structure
    const parsed = JSON.parse(jsonContent.value);
    if (!parsed.name || !parsed.ticker || !parsed.description || !parsed.homepage) {
      jsonError.value = t('poolOperator.metadataRequiredFields');
    }

    // Check size limit (512 bytes)
    const bytes = new TextEncoder().encode(jsonContent.value);
    if (bytes.length > 512) {
      jsonError.value = t('poolOperator.metadataTooLarge', { size: bytes.length });
    }

    // Compute Blake2b-256 hash
    const blake2b = (await import('blake2b')).default;
    const hashBytes = blake2b(32).update(bytes).digest();
    hash.value = Array.from(hashBytes as Uint8Array).map(b => b.toString(16).padStart(2, '0')).join('');
    emitUpdate();
  } catch (e: any) {
    if (!jsonError.value) {
      jsonError.value = t('poolOperator.invalidJson');
    }
    hash.value = '';
    emitUpdate();
  }
}

function emitUpdate() {
  emit('input', { url: url.value, hash: hash.value });
}
</script>
