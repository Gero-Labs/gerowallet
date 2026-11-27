<template>
  <BaseDialog :is-open="isOpen" size="sm" :min-height="0" :persistent="busy" :title="$t('gerovault.invite.open.title')" :subtitle="$t('gerovault.invite.open.subtitle')" @close="emit('close')">
    <div class="open-invite" data-test="open-invite">
      <v-tabs v-model="tab" density="compact" color="primary" bg-color="transparent">
        <v-tab value="paste">{{ $t('common.paste') }}</v-tab>
        <v-tab value="scan">{{ $t('gerovault.invite.open.scan') }}</v-tab>
      </v-tabs>
      <div v-if="tab === 'scan'">
        <AnimatedQRScanner v-if="isOpen" mode="text" @scan="submit($event)" @error="cameraError = true" />
        <!-- No camera: the number and the link still work (never a dead end). -->
        <p v-if="cameraError" class="t-caption gvc-muted">{{ $t('gerovault.invite.open.noCamera') }}</p>
      </div>
      <template v-else>
        <v-textarea
          v-model="pasted"
          :label="$t('gerovault.invite.open.pasteLabel')"
          rows="3"
          spellcheck="false"
          density="compact"
          variant="outlined"
          class="g-mono"
          hide-details="auto"
          data-test="open-invite-text"
        />
        <GButton tier="primary" :disabled="!pasted.trim() || busy" :loading="busy" data-test="open-invite-submit" @click="submit(pasted)">
          {{ $t('gerovault.invite.open.submit') }}
        </GButton>
      </template>
      <GNote v-if="problem" tone="error" icon="mdi-alert-circle-outline" role="alert" data-test="open-invite-problem">{{ $t(inviteProblemKey(problem)) }}</GNote>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import AnimatedQRScanner from '@/shared/components/AnimatedQRScanner.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import GNote from '@/shared/components/GNote.vue';
import type { ReceivedView } from './inviteClient';
import { inviteProblemKey } from './messages';

/**
 * "Have an invite?": a pasted link or code, or the invite QR scanned with the webcam (the scanner
 * the Verify step uses). The background fetches the link copy and opens it under the capability;
 * this dialog only hands over the text.
 */
const props = defineProps<{
  isOpen: boolean;
  /** Opens the text; resolves with the invitation, or null (then `problem()` says why). */
  open: (text: string) => Promise<ReceivedView | null>;
  problem: () => string | null;
}>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'opened', view: ReceivedView): void }>();

const tab = ref<'paste' | 'scan'>('paste');
const pasted = ref('');
const busy = ref(false);
const problem = ref<string | null>(null);
const cameraError = ref(false);

async function submit(text: string): Promise<void> {
  if (busy.value || !text.trim()) return;
  busy.value = true;
  problem.value = null;
  try {
    const view = await props.open(text.trim());
    if (view) {
      pasted.value = '';
      emit('opened', view);
    } else {
      problem.value = props.problem() ?? 'SERVER';
    }
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.open-invite {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding-top: var(--g-s-2);
}
.open-invite p {
  margin: 0;
}
</style>
