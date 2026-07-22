<template>
  <div class="wizard-step">
    <div v-if="checking" class="text-center py-4">
      <v-progress-circular indeterminate color="primary" size="24" />
    </div>

    <template v-else>
      <!-- Auto-detected from chain -->
      <template v-if="chainHash && !showUpload">
        <v-alert type="success" dense outlined>
          {{ $t('poolOperator.vrfFoundOnChain') }}
          <div class="monospace-text text-caption mt-1">{{ chainHash }}</div>
        </v-alert>
        <v-btn color="primary" block class="mt-3" :loading="saving" @click="accept(chainHash)">
          {{ $t('poolOperator.useThisVrfKey') }}
        </v-btn>
        <v-btn text x-small color="grey" class="mt-2" @click="showUpload = true">
          {{ $t('poolOperator.rotatingVrfKey') }}
        </v-btn>
      </template>

      <!-- Upload path -->
      <template v-else>
        <p class="text-body-2 grey--text">{{ $t('poolOperator.importVrfKeyDescription') }}</p>
        <v-alert type="info" dense text class="text-caption">{{ $t('poolOperator.vrfUploadOnlyPublic') }}</v-alert>
        <v-file-input
          v-model="file" :label="$t('poolOperator.vrfKeyFile')" accept=".vkey,.json"
          outlined dense prepend-icon="mdi-file-certificate-outline" @change="onFile"
        />
        <v-alert v-if="error" type="error" dense outlined class="mt-2">{{ error }}</v-alert>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useVrfImport } from '../../composables/useVrfImport';

const props = defineProps<{ poolId: string | null; chain: string; network: string }>();
const emit = defineEmits(['done', 'busy']);
const { t } = useTranslation();
const { parseVrfFile, fetchVrfFromChain, saveVrf } = useVrfImport();

const checking = ref(true);
const chainHash = ref<string | null>(null);
const showUpload = ref(false);
const file = ref<File | null>(null);
const error = ref('');
const saving = ref(false);

onMounted(async () => {
  if (props.poolId) {
    chainHash.value = await fetchVrfFromChain(props.poolId, props.chain, props.network);
  }
  if (!chainHash.value) showUpload.value = true;
  checking.value = false;
});

async function accept(hash: string) {
  saving.value = true; emit('busy', true);
  try {
    await saveVrf(hash);
    emit('done', hash);
  } finally {
    saving.value = false; emit('busy', false);
  }
}

async function onFile() {
  error.value = '';
  if (!file.value) return;
  emit('busy', true);
  try {
    const hash = await parseVrfFile(file.value);
    await saveVrf(hash);
    emit('done', hash);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : '';
    error.value = message === 'invalidVrfKeyFile' ? t('poolOperator.invalidVrfKeyFile') : (message || t('errors.unknownError'));
  } finally {
    emit('busy', false);
  }
}
</script>
