<template>
  <BaseDialog
    :isOpen="open"
    @close="closeForNow"
    icon="mdi-shield-alert-outline"
    :title="$t('midnight.proofServerRestart.title')"
    :title-lines="2"
    size="md"
    :min-height="0"
  >
    <p class="psr-body t-body-sm" data-test="proof-server-restart-body">{{ $t('midnight.proofServerRestart.body') }}</p>
    <ol class="psr-steps t-body-sm" data-test="proof-server-restart-steps">
      <li>{{ $t('midnight.proofServerRestart.step1') }}</li>
      <li>
        {{ $t('midnight.proofServerRestart.step2') }}
        <code class="psr-inline g-mono">{{ $t('midnight.proofServerRestart.step2Command') }}</code>
        <span class="psr-note">
          <i18n-t keypath="midnight.proofServerRestart.step2Note" tag="span">
            <template #flag><code class="psr-inline g-mono">--rm</code></template>
          </i18n-t>
        </span>
      </li>
      <li>{{ $t('midnight.proofServerRestart.step3') }}</li>
      <li>
        {{ $t('midnight.proofServerRestart.step4') }}
        <CommandBlock
          v-for="command in commands"
          :key="command"
          :command="command"
          :copy-label="$t('midnight.proofServerRestart.copyCommand')"
          class="psr-command"
          data-test="proof-server-restart-command"
        />
      </li>
    </ol>
    <v-card-actions class="px-0 pt-4 pb-0 psr-actions">
      <GButton tier="secondary" data-test="proof-server-restart-not-now" @click="closeForNow()">{{ $t('notify.intro.notNow') }}</GButton>
      <GButton tier="primary" data-test="proof-server-restart-done" @click="done()">{{ $t('common.done') }}</GButton>
    </v-card-actions>
  </BaseDialog>
</template>

<script setup lang="ts">
// The one-time "Restart your local proof server" notice (proofServerRestartNotice.ts).
// Done ends it for good on this browser profile. Not now, Escape, the scrim and
// the close button only hide it for this page: it comes back on the next open
// until Done. Mounted on the dashboard (ContentLayout) and in the side panel.
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import CommandBlock from '@/shared/components/CommandBlock.vue';
import { midnightStore } from '@/stores/midnightStore';
import { walletStore } from '@/stores/walletStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import {
  DEFAULT_LOCAL_PROOF_SERVER_URL,
  DEFAULT_LOCAL_PROOF_SERVER_URL_LEDGER9,
  midnightProofServerCommand,
} from '@/chains/midnight/midnightConfig';
import {
  isProofServerRestartNoticeDone,
  markProofServerRestartNoticeDone,
  proofServerRestartNoticeWanted,
} from '@/chains/midnight/proofServerRestartNotice';

const props = defineProps<{ suppressed?: boolean }>();
const emit = defineEmits<{ (e: 'open-change', open: boolean): void }>();

/** Let the page settle, and any dialog it opens on its own come first (as NotifyIntroPrompt does). */
const SETTLE_MS = 1_500;

const isDone = ref(isProofServerRestartNoticeDone());
const closedForNow = ref(false);
const settled = ref(false);
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

let settleTimer: ReturnType<typeof setTimeout> | null = null;
watch([unlocked, loggedId], ([isUnlocked]) => {
  settled.value = false;
  if (settleTimer) clearTimeout(settleTimer);
  if (!isUnlocked) return;
  settleTimer = setTimeout(() => { settled.value = true; }, SETTLE_MS);
  void loadServeProofs();
}, { immediate: true });
onBeforeUnmount(() => { if (settleTimer) clearTimeout(settleTimer); });

const wanted = computed(() => proofServerRestartNoticeWanted({
  proofServer: midnightStore.proofServer,
  serveProofs: serveProofs.value,
  done: isDone.value,
}));

const open = computed(() => !props.suppressed && unlocked.value && settled.value && !closedForNow.value && wanted.value);
watch(open, (value) => emit('open-change', value), { immediate: true });

/**
 * The current command for the open wallet's ledger, the one Settings → Proof
 * server shows. Someone who saved custom URLs for both ledgers runs both
 * servers, so both commands are shown.
 */
const commands = computed(() => {
  const ps = midnightStore.proofServer;
  if (ps.localUrl !== DEFAULT_LOCAL_PROOF_SERVER_URL && ps.localUrlLedger9 !== DEFAULT_LOCAL_PROOF_SERVER_URL_LEDGER9) {
    return [midnightProofServerCommand('Mainnet'), midnightProofServerCommand('Stagenet')];
  }
  return [midnightProofServerCommand(walletStore.loggedWallet?.network)];
});

function closeForNow(): void {
  closedForNow.value = true;
}

function done(): void {
  markProofServerRestartNoticeDone();
  isDone.value = true;
}
</script>

<style scoped lang="scss">
.psr-body {
  margin: var(--g-s-3) 0 0;
  color: var(--g-text-2);
}

.psr-steps {
  margin: var(--g-s-3) 0 0;
  padding-left: var(--g-s-5);
  color: var(--g-text-2);
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}

/* Inline code: a chip-radius solid, kept on one line. */
.psr-inline {
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-chip);
  padding: 0 var(--g-s-1);
  white-space: nowrap;
  color: var(--g-text-1);
}

.psr-note {
  display: block;
  margin-top: var(--g-s-1);
}

.psr-command {
  margin-top: var(--g-s-2);
}

.psr-actions {
  display: flex;
  gap: var(--g-s-2);
  justify-content: flex-end;
}
</style>
