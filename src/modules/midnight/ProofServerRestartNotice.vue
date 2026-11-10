<template>
  <BaseDialog
    :isOpen="open"
    @close="closeForNow"
    icon="mdi-docker"
    :title="$t('midnight.proofServerRestart.title')"
    :subtitle="$t('midnight.proofServerRestart.body')"
    size="md"
    :min-height="0"
  >
    <ol class="psr-steps t-body-sm" data-test="proof-server-restart-steps">
      <li>{{ $t('midnight.proofServerRestart.step1') }}</li>
      <li>
        {{ $t('midnight.proofServerRestart.step2') }}
        <code class="psr-inline g-mono">{{ $t('midnight.proofServerRestart.step2Command') }}</code>
        {{ $t('midnight.proofServerRestart.step2Note') }}
      </li>
      <li>
        {{ $t('midnight.proofServerRestart.step3') }}
        <div class="psr-command-row">
          <code class="psr-command g-mono" data-test="proof-server-restart-command">{{ command }}</code>
        </div>
        <CopyButton
          :value="command"
          :title="$t('midnight.proofServerRestart.copyCommand')"
          small
          data-test="proof-server-restart-copy"
        />
      </li>
      <li>{{ $t('midnight.proofServerRestart.step4') }}</li>
    </ol>
    <v-card-actions class="px-0 pt-4 pb-0 psr-actions">
      <GButton tier="primary" data-test="proof-server-restart-done" @click="done()">{{ $t('common.done') }}</GButton>
    </v-card-actions>
  </BaseDialog>
</template>

<script setup lang="ts">
// The one-time "Restart your local proof server" notice (proofServerRestartNotice.ts).
// Done ends it for good on this browser profile. Escape, the scrim and the close
// button only hide it for this page: it comes back on the next open until Done.
import { computed, ref, watch } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import { midnightStore } from '@/stores/midnightStore';
import { walletStore } from '@/stores/walletStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { midnightProofServerCommand } from '@/chains/midnight/midnightConfig';
import {
  isProofServerRestartNoticeDone,
  markProofServerRestartNoticeDone,
  proofServerRestartNoticeWanted,
} from '@/chains/midnight/proofServerRestartNotice';

const props = defineProps<{ suppressed?: boolean }>();
const emit = defineEmits<{ (e: 'open-change', open: boolean): void }>();

const isDone = ref(isProofServerRestartNoticeDone());
const closedForNow = ref(false);
/** "Prove for your phone" is per wallet; read from the worker for the open wallet. */
const serveProofs = ref(false);

const unlocked = computed(() => !!walletStore.loggedWallet && !walletStore.isLocked);
const loggedId = computed(() => (walletStore.loggedWallet as { id?: number } | null)?.id ?? null);

async function loadServeProofs(): Promise<void> {
  serveProofs.value = false;
  if (isDone.value) return;
  try {
    const res = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.GET_CROSS_DEVICE_SETTINGS,
    }) as { data?: { success?: boolean; settings?: { serveProofs?: boolean } } };
    serveProofs.value = res?.data?.success === true && res.data.settings?.serveProofs === true;
  } catch {
    serveProofs.value = false;
  }
}

watch([unlocked, loggedId], ([isUnlocked]) => {
  if (isUnlocked) void loadServeProofs();
}, { immediate: true });

const wanted = computed(() => proofServerRestartNoticeWanted({
  proofServer: midnightStore.proofServer,
  serveProofs: serveProofs.value,
  done: isDone.value,
}));

const open = computed(() => !props.suppressed && unlocked.value && !closedForNow.value && wanted.value);
watch(open, (value) => emit('open-change', value), { immediate: true });

/** The current command for the open wallet's ledger, the one Settings → Proof server shows. */
const command = computed(() => midnightProofServerCommand(walletStore.loggedWallet?.network));

function closeForNow(): void {
  closedForNow.value = true;
}

function done(): void {
  markProofServerRestartNoticeDone();
  isDone.value = true;
}
</script>

<style scoped lang="scss">
.psr-steps {
  margin: var(--g-s-3) 0 0;
  padding-left: var(--g-s-5);
  color: var(--g-text-2);
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}

.psr-inline {
  color: var(--g-text-1);
  word-break: break-all;
}

/* Solid on purpose: a code block, like the command on Settings → Proof server. */
.psr-command-row {
  background: var(--g-canvas);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  padding: var(--g-s-2) var(--g-s-3);
  margin-top: var(--g-s-2);
  overflow-x: auto;
}

.psr-command {
  color: var(--g-text-1);
  white-space: pre;
}

.psr-actions {
  display: flex;
  justify-content: flex-end;
}
</style>
