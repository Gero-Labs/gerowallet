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
      :loading="fetching"
      outlined
      dense
      readonly
      rows="4"
      persistent-hint
      class="mt-2 g-mono"
    />

    <div v-if="hash" class="mt-2">
      <div class="text-caption grey--text">{{ $t('poolOperator.metadataHash') }}</div>
      <div class="g-mono text-body-2 mt-1 success--text">{{ hash }}</div>
    </div>

    <div v-if="jsonError" class="mt-1">
      <span class="text-caption error--text">{{ jsonError }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
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

let fetchTimer: ReturnType<typeof setTimeout> | undefined;

function onUrlChange() {
  // The JSON pane mirrors whatever the URL resolves to (read-only), so a URL
  // edit invalidates the shown JSON + hash until the new URL is fetched.
  jsonContent.value = '';
  hash.value = '';
  jsonError.value = '';
  emitUpdate();
  clearTimeout(fetchTimer);
  if (url.value) fetchTimer = setTimeout(fetchAndHash, 600);
}

// Auto-resolve the pre-filled URL (e.g. an existing pool's metadata) on open so
// the JSON pane shows the resolved document without a manual fetch.
onMounted(() => {
  if (url.value) fetchAndHash();
});

async function fetchAndHash() {
  if (!url.value) return;
  fetching.value = true;
  jsonError.value = '';
  try {
    const response = await fetch(url.value);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // Pretty-print so the read-only pane is legible; the hash is computed over
    // the raw fetched bytes (below), not this reformatted view.
    const raw = await response.text();
    try {
      jsonContent.value = JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      jsonContent.value = raw;
    }
    await computeHash(raw);
  } catch {
    jsonContent.value = '';
    hash.value = '';
    jsonError.value = t('poolOperator.fetchMetadataFailed');
    emitUpdate();
  } finally {
    fetching.value = false;
  }
}

async function computeHash(raw: string) {
  // Hash the EXACT fetched bytes - the on-chain hash must match the hosted
  // document byte-for-byte, not the pretty-printed pane above.
  jsonError.value = '';
  if (!raw.trim()) {
    hash.value = '';
    emitUpdate();
    return;
  }

  try {
    // Validate JSON structure
    const parsed = JSON.parse(raw);
    if (!parsed.name || !parsed.ticker || !parsed.description || !parsed.homepage) {
      jsonError.value = t('poolOperator.metadataRequiredFields');
    }

    // Check size limit (512 bytes)
    const bytes = new TextEncoder().encode(raw);
    if (bytes.length > 512) {
      jsonError.value = t('poolOperator.metadataTooLarge', { size: bytes.length });
    }

    // Compute Blake2b-256 hash
    const blake2b = (await import('blake2b')).default;
    const hashBytes = blake2b(32).update(bytes).digest();
    hash.value = Array.from(hashBytes as Uint8Array).map(b => b.toString(16).padStart(2, '0')).join('');
    emitUpdate();
  } catch {
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
