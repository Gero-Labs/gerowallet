<template>
  <BaseDialog
    :is-open="isOpen"
    size="sm"
    :title="$t('gerovault.create.qr.title', { label })"
    :subtitle="$t('gerovault.create.qr.subtitle')"
    @close="close()"
  >
    <v-tabs v-model="tab" density="compact" color="primary" bg-color="transparent" class="mb-3">
      <v-tab value="scan">{{ $t('gerovault.create.qr.scan') }}</v-tab>
      <v-tab value="paste">{{ $t('common.paste') }}</v-tab>
    </v-tabs>
    <div v-if="tab === 'scan'" class="qr-scan__camera">
      <AnimatedQRScanner v-if="isOpen" mode="text" @scan="submit($event)" @error="cameraError = String($event)" />
      <p v-if="cameraError" class="t-caption gvc-error">{{ cameraError }}</p>
    </div>
    <form v-else class="qr-scan__paste" @submit.prevent="submit(pasted)">
      <v-textarea
        v-model="pasted"
        :label="$t('gerovault.create.qr.pasteLabel')"
        rows="3"
        spellcheck="false"
        density="compact"
        variant="outlined"
        class="g-mono"
        hide-details="auto"
        data-test="create-qr-paste"
      />
      <GButton tier="secondary" type="submit" :disabled="!pasted.trim() || checking" :loading="checking" data-test="create-qr-check">
        {{ $t('gerovault.create.qr.check') }}
      </GButton>
    </form>
    <GNote v-if="refusal" tone="error" icon="mdi-alert-circle-outline" role="alert" class="mt-3">{{ $t(refusal) }}</GNote>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import AnimatedQRScanner from '@/shared/components/AnimatedQRScanner.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import GNote from '@/shared/components/GNote.vue';

/**
 * Reads a cosigner's verification QR: by camera, in person, or pasted as text. `check` records it
 * and answers with the i18n key of a refusal, or undefined when it matched.
 */
const props = defineProps<{
  isOpen: boolean;
  /** The cosigner's label, already passed through `displayLabel`. */
  label: string;
  check: (payload: string) => Promise<string | undefined>;
}>();

const emit = defineEmits<{ close: [] }>();

const tab = ref<'scan' | 'paste'>('scan');
const pasted = ref('');
const refusal = ref<string | undefined>();
const cameraError = ref('');
const checking = ref(false);

watch(() => props.isOpen, open => {
  if (!open) return;
  tab.value = 'scan';
  pasted.value = '';
  refusal.value = undefined;
  cameraError.value = '';
});

async function submit(payload: string): Promise<void> {
  if (checking.value || !payload.trim()) return;
  checking.value = true;
  try {
    refusal.value = await props.check(payload);
    if (!refusal.value) close();
  } finally {
    checking.value = false;
  }
}

function close(): void {
  emit('close');
}
</script>

<style scoped>
.qr-scan__camera {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}
.qr-scan__paste {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--g-s-3);
}
.qr-scan__paste :deep(.v-input) {
  width: 100%;
}
</style>
