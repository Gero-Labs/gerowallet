<template>
  <BaseDialog
    :is-open="isOpen"
    :title="$t('gerovault.detail.recovery.importTitle')"
    icon="mdi-file-restore-outline"
    size="lg"
    :min-height="0"
    :persistent="busy"
    @close="close()"
  >
    <div class="recovery-import" data-test="recovery-import">
      <div class="recovery-import__bar">
        <p class="t-body-sm">{{ $t('gerovault.detail.recovery.importIntro') }}</p>
        <DetailsToggle v-model="detailsOn" :peeking="peeking" />
      </div>

      <!-- 1. The file. Cheap checks run before any passphrase is asked for. -->
      <template v-if="flow.step.value === 'pick'">
        <label class="recovery-import__file glass-tier">
          <v-icon size="28" aria-hidden="true">mdi-file-upload-outline</v-icon>
          <span class="t-body-sm">{{ $t('gerovault.detail.recovery.pickFile') }}</span>
          <input type="file" class="g-sr-only" data-test="recovery-import-file" @change="onFile" />
        </label>
        <GNote v-if="flow.error.value" tone="error" icon="mdi-alert-circle-outline" role="alert" data-test="recovery-import-error">
          {{ $t(`gerovault.detail.recovery.importError.${flow.error.value}`) }}
        </GNote>
      </template>

      <!-- 2. The passphrase. A wrong one comes back here with its error. -->
      <template v-else-if="flow.step.value === 'unlock'">
        <p class="t-caption g-mono">{{ flow.fileName.value }}</p>
        <v-text-field
          v-model="flow.passphrase.value"
          type="password"
          :label="$t('gerovault.detail.recovery.passphraseField')"
          variant="outlined"
          density="compact"
          autocomplete="off"
          spellcheck="false"
          :error="flow.error.value === 'WRONG_PASSPHRASE'"
          data-test="recovery-import-passphrase"
          @keydown.enter="flow.unlock()"
        />
        <SpendingPasswordField v-if="flow.needsPassword.value" v-model="flow.spendingPassword.value" :error="flow.error.value === 'WRONG_PASSWORD'" />
        <GNote v-if="flow.error.value" tone="error" icon="mdi-alert-circle-outline" role="alert" data-test="recovery-import-error">
          {{ $t(`gerovault.detail.recovery.importError.${flow.error.value}`) }}
        </GNote>
        <div class="recovery-import__actions">
          <GButton tier="secondary" @click="flow.reset()">{{ $t('gerovault.detail.recovery.otherFile') }}</GButton>
          <GButton tier="primary" :disabled="!flow.canUnlock.value" data-test="recovery-import-open" @click="flow.unlock()">
            {{ $t('gerovault.detail.recovery.open') }}
          </GButton>
        </div>
      </template>

      <!-- 3. Deriving the key, then reading the chain and rebuilding the scripts. -->
      <div v-else-if="busy" class="recovery-import__wait" role="status" data-test="recovery-import-busy">
        <v-progress-circular indeterminate :size="28" :width="3" color="var(--g-accent)" :aria-label="$t('common.loading')" />
        <p class="t-body-sm">{{ $t(`gerovault.detail.recovery.busy.${flow.step.value}`) }}</p>
      </div>

      <!-- 4. The quarantined candidate. -->
      <template v-else-if="(flow.step.value === 'review' || flow.step.value === 'saved') && flow.candidate.value">
        <GNote v-if="flow.held.value" icon="mdi-information-outline" role="status" data-test="recovery-import-held">
          {{ $t('gerovault.detail.recovery.alreadyHeld') }}
          <template v-if="flow.heldStaleness.value?.stale"> {{ $t('gerovault.detail.recovery.packageOlder') }}</template>
        </GNote>
        <RestoredCandidateReview
          :candidate="flow.candidate.value"
          :pkg="flow.opened.value"
          :chain="flow.chainView.value"
          :details-visible="detailsVisible"
        />
        <p v-if="flow.step.value === 'saved'" class="t-body-sm" data-test="recovery-import-saved">{{ $t('gerovault.detail.recovery.keptAsCandidate') }}</p>
        <CandidateAcceptPanel v-if="!flow.held.value" v-model:agreed="flow.agreed.value" @accept="accept()">
          <template #secondary>
            <GButton v-if="flow.step.value === 'review'" tier="secondary" data-test="recovery-import-keep" @click="keep()">
              {{ $t('gerovault.detail.recovery.keep') }}
            </GButton>
            <GButton v-else tier="secondary" @click="close()">{{ $t('common.close') }}</GButton>
          </template>
        </CandidateAcceptPanel>
        <div v-else class="recovery-import__actions">
          <GButton tier="primary" @click="close()">{{ $t('common.close') }}</GButton>
        </div>
      </template>

      <!-- Accepted. -->
      <template v-else-if="flow.step.value === 'accepted'">
        <div class="recovery-import__done" data-test="recovery-import-accepted">
          <v-icon size="40" color="var(--g-success)" aria-hidden="true">mdi-check-circle-outline</v-icon>
          <p class="t-heading">{{ $t('gerovault.detail.recovery.accepted') }}</p>
          <p class="t-body-sm">{{ $t('gerovault.detail.recovery.acceptedNext') }}</p>
        </div>
        <div class="recovery-import__actions">
          <GButton tier="primary" @click="close()">{{ $t('common.done') }}</GButton>
        </div>
      </template>

      <!-- Plutus outcomes: found nowhere, retired, or found but its state not readable here. -->
      <template v-else-if="flow.step.value === 'notFound' && flow.plutus.value">
        <GNote tone="error" icon="mdi-help-circle-outline" role="status" data-test="recovery-import-not-found">{{ $t('gerovault.detail.recovery.notFound') }}</GNote>
        <ChunkedValue :value="flow.plutus.value.address" bech32 copy />
      </template>
      <template v-else-if="flow.step.value === 'retired' && flow.retired.value">
        <div class="recovery-import__retired glass-tier" data-test="recovery-import-retired">
          <p class="t-body-lg recovery-import__retired-to" data-test="recovery-import-retired-to">
            {{ $t('gerovault.detail.recovery.retired', { to: flow.retired.value.to }) }}
            <CopyButton x-small :value="flow.retired.value.to" />
          </p>
          <p v-if="flow.retired.value.deregistrationFromMs !== undefined" class="t-caption">
            {{ $t('gerovault.detail.recovery.retiredDereg', { date: formatDate(flow.retired.value.deregistrationFromMs) }) }}
          </p>
          <p class="t-caption">{{ $t('gerovault.detail.recovery.retiredDisplayOnly') }}</p>
        </div>
      </template>
      <template v-else-if="flow.step.value === 'plutusUnreadable' && flow.plutus.value">
        <GNote icon="mdi-information-outline" role="status" data-test="recovery-import-plutus">{{ $t('gerovault.detail.recovery.plutusUnreadable') }}</GNote>
        <ChunkedValue :value="flow.plutus.value.address" bech32 copy />
      </template>

      <!-- Nothing was restored. -->
      <template v-else-if="flow.step.value === 'failed'">
        <GNote tone="error" icon="mdi-alert-circle-outline" role="alert" data-test="recovery-import-error">
          {{ $t(`gerovault.detail.recovery.importError.${flow.error.value ?? 'FAILED'}`) }}
        </GNote>
        <div class="recovery-import__actions">
          <GButton tier="secondary" @click="close()">{{ $t('common.close') }}</GButton>
          <GButton tier="primary" @click="flow.reset()">{{ $t('gerovault.detail.recovery.otherFile') }}</GButton>
        </div>
      </template>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import DetailsToggle from '@/shared/components/DetailsToggle.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import GNote from '@/shared/components/GNote.vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import { useDetailsLayer } from '@/shared/composables/useDetailsLayer';
import type { VaultRecord } from '@/modules/gerovault/contracts';
import {
  useGerovaultStore,
  useGerovaultWallet,
  useVaultChainReaderFactory,
  useVaultRoleKeysSource,
} from '@/modules/gerovault/detail/context';
import CandidateAcceptPanel from '@/modules/gerovault/detail/components/CandidateAcceptPanel.vue';
import ChunkedValue from '@/modules/gerovault/detail/components/ChunkedValue.vue';
import RestoredCandidateReview from './RestoredCandidateReview.vue';
import SpendingPasswordField from './SpendingPasswordField.vue';
import { useRecoveryImport, type PlutusStateReader } from './useRecoveryImport';

defineOptions({ name: 'RecoveryImportDialog' });

const props = defineProps<{ isOpen: boolean; plutusState?: PlutusStateReader }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved', record: VaultRecord): void }>();

const flow = useRecoveryImport({
  wallet: useGerovaultWallet(),
  store: useGerovaultStore(),
  chainReader: useVaultChainReaderFactory(),
  roleKeys: useVaultRoleKeysSource(),
  ...(props.plutusState ? { plutusState: props.plutusState } : {}),
});

const { enabled: detailsOn, peeking, visible: detailsVisible } = useDetailsLayer('gerovault.recoveryImport');

const busy = computed(() => ['opening', 'restoring', 'saving'].includes(flow.step.value));

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
function formatDate(ms: number): string {
  return dateFormatter.format(new Date(ms));
}

function onFile(event: Event): void {
  const input = event.target as HTMLInputElement | null;
  const file = input?.files?.[0];
  void flow.pickFile(file);
  if (input) input.value = '';
}

async function keep(): Promise<void> {
  const row = await flow.saveCandidate();
  if (row) emit('saved', row);
}

async function accept(): Promise<void> {
  const row = await flow.acceptCandidate();
  if (row) emit('saved', row);
}

function close(): void {
  if (busy.value) return;
  flow.reset();
  emit('close');
}
</script>

<style scoped>
.recovery-import {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding-top: var(--g-s-2);
}
.recovery-import p {
  margin: 0;
}
.recovery-import__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
  flex-wrap: wrap;
}
.recovery-import__file {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-5);
  border-radius: var(--g-r-card);
  border: 1px dashed var(--g-hairline-3);
  cursor: pointer;
  text-align: center;
}
.recovery-import__file:focus-within,
.recovery-import__file:hover {
  border-color: var(--g-accent);
}
.recovery-import__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--g-s-3);
}
.recovery-import__wait,
.recovery-import__done {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-4) 0;
  text-align: center;
}
.recovery-import__retired-to {
  overflow-wrap: anywhere;
}
.recovery-import__retired {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  padding: var(--g-s-4);
  border-radius: var(--g-r-card);
}
</style>
