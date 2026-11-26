<template>
  <BaseDialog
    :is-open="isOpen"
    :title="$t('gerovault.detail.recovery.exportTitle')"
    :subtitle="record.name ? displayLabel(record.name) : $t('gerovault.vault.title')"
    icon="mdi-file-lock-outline"
    size="md"
    :min-height="0"
    :persistent="flow.step.value === 'exporting'"
    @close="close()"
  >
    <div class="recovery-export" data-test="recovery-export">
      <!-- What the file is, before anything else: it moves no funds, and the passphrase is not the seed. -->
      <p class="t-body-sm">{{ $t('gerovault.detail.recovery.whatItIs') }}</p>
      <GNote icon="mdi-shield-check-outline" role="status" class="recovery-export__cannot-move">
        {{ $t('gerovault.detail.recovery.cannotMoveFunds') }}
      </GNote>

      <!-- 1. Which passphrase. -->
      <template v-if="flow.step.value === 'choose'">
        <div class="recovery-export__choices">
          <button type="button" class="recovery-export__choice glass-tier" data-test="recovery-export-generated" @click="flow.chooseGenerated()">
            <span class="t-body-lg">{{ $t('gerovault.detail.recovery.generated') }}</span>
            <span class="t-caption">{{ $t('gerovault.detail.recovery.generatedHint') }}</span>
          </button>
          <button type="button" class="recovery-export__choice glass-tier" data-test="recovery-export-own" @click="flow.chooseOwn()">
            <span class="t-body-lg">{{ $t('gerovault.detail.recovery.own') }}</span>
            <span class="t-caption">{{ $t('gerovault.detail.recovery.ownHint', { min: RECOVERY_PASSPHRASE_MIN_CODE_POINTS }) }}</span>
          </button>
        </div>
      </template>

      <!-- 2a. Write the generated passphrase down. -->
      <template v-else-if="flow.step.value === 'write'">
        <p class="t-body-sm">{{ $t('gerovault.detail.recovery.writeDown') }}</p>
        <PassphraseGroups :groups="flow.groups.value" />
        <p class="t-caption">{{ $t('gerovault.detail.recovery.keepWithSeed') }}</p>
        <div class="recovery-export__actions">
          <GButton tier="secondary" @click="flow.back()">{{ $t('common.back') }}</GButton>
          <GButton tier="primary" data-test="recovery-export-written" @click="flow.toConfirm()">{{ $t('gerovault.detail.recovery.written') }}</GButton>
        </div>
      </template>

      <!-- 2a. Retype one group chosen at random. -->
      <template v-else-if="flow.step.value === 'confirm'">
        <p class="t-body-sm">{{ $t('gerovault.detail.recovery.confirmGroup', { n: flow.confirmIndex.value + 1 }) }}</p>
        <v-text-field
          v-model="flow.confirmInput.value"
          :label="$t('gerovault.detail.recovery.groupLabel', { n: flow.confirmIndex.value + 1 })"
          variant="outlined"
          density="compact"
          autocomplete="off"
          spellcheck="false"
          maxlength="9"
          :error-messages="flow.confirmFailed.value ? [$t('gerovault.detail.recovery.groupMismatch')] : []"
          data-test="recovery-export-confirm-input"
          @update:model-value="flow.confirmFailed.value = false"
        />
        <SpendingPasswordField v-if="flow.needsPassword.value" v-model="flow.spendingPassword.value" :error="flow.error.value === 'WRONG_PASSWORD'" />
        <div class="recovery-export__actions">
          <GButton tier="secondary" @click="flow.back()">{{ $t('common.back') }}</GButton>
          <GButton tier="primary" :disabled="!flow.canExport.value" data-test="recovery-export-run" @click="flow.runExport()">{{ $t('gerovault.detail.recovery.export') }}</GButton>
        </div>
      </template>

      <!-- 2b. The user's own passphrase, typed twice. -->
      <template v-else-if="flow.step.value === 'own'">
        <v-text-field
          v-model="flow.ownPassphrase.value"
          type="password"
          :label="$t('gerovault.detail.recovery.ownLabel')"
          variant="outlined"
          density="compact"
          autocomplete="new-password"
          :error-messages="ownErrorKey ? [$t(ownErrorKey, { min: RECOVERY_PASSPHRASE_MIN_CODE_POINTS })] : []"
          data-test="recovery-export-own-input"
        />
        <v-text-field
          v-model="flow.ownRepeat.value"
          type="password"
          :label="$t('gerovault.detail.recovery.ownRepeat')"
          variant="outlined"
          density="compact"
          autocomplete="new-password"
          :error-messages="flow.ownCheck.value.problem === 'MISMATCH' ? [$t('gerovault.detail.recovery.ownMismatch')] : []"
          data-test="recovery-export-own-repeat"
        />
        <p v-if="flow.ownCheck.value.advice && !ownErrorKey" class="t-caption" data-test="recovery-export-advice">{{ $t('gerovault.detail.recovery.ownAdvice') }}</p>
        <p class="t-caption">{{ $t('gerovault.detail.recovery.keepWithSeed') }}</p>
        <SpendingPasswordField v-if="flow.needsPassword.value" v-model="flow.spendingPassword.value" :error="flow.error.value === 'WRONG_PASSWORD'" />
        <div class="recovery-export__actions">
          <GButton tier="secondary" @click="flow.back()">{{ $t('common.back') }}</GButton>
          <GButton tier="primary" :disabled="!flow.canExport.value" data-test="recovery-export-run" @click="flow.runExport()">{{ $t('gerovault.detail.recovery.export') }}</GButton>
        </div>
      </template>

      <!-- 3. Deriving the key and sealing take a few seconds. -->
      <div v-else-if="flow.step.value === 'exporting'" class="recovery-export__wait" role="status" data-test="recovery-export-busy">
        <v-progress-circular indeterminate :size="28" :width="3" color="var(--g-accent)" :aria-label="$t('common.loading')" />
        <p class="t-body-sm">{{ $t('gerovault.detail.recovery.exporting') }}</p>
      </div>

      <!-- 4. Saved: the file, and when to make a new one. -->
      <template v-else-if="flow.step.value === 'done' && flow.result.value">
        <div class="recovery-export__done" data-test="recovery-export-done">
          <v-icon size="40" color="var(--g-success)" aria-hidden="true">mdi-check-circle-outline</v-icon>
          <p class="t-heading">{{ $t('gerovault.detail.recovery.saved') }}</p>
          <p class="t-caption g-mono">{{ flow.result.value.fileName }}</p>
        </div>
        <GNote icon="mdi-update" role="status" data-test="recovery-export-staleness">{{ $t('gerovault.detail.recovery.stalenessReminder') }}</GNote>
        <p v-if="leftOut > 0" class="t-caption" data-test="recovery-export-left-out">{{ $t('gerovault.detail.recovery.leftOut', { count: leftOut }) }}</p>
        <div class="recovery-export__actions">
          <GButton tier="secondary" data-test="recovery-export-again" @click="flow.downloadAgain()">{{ $t('gerovault.detail.recovery.downloadAgain') }}</GButton>
          <GButton tier="primary" @click="close()">{{ $t('common.done') }}</GButton>
        </div>
      </template>

      <!-- Nothing was saved. -->
      <template v-else-if="flow.step.value === 'failed'">
        <GNote tone="error" icon="mdi-alert-circle-outline" role="alert" data-test="recovery-export-error">
          {{ $t(`gerovault.detail.recovery.exportError.${flow.error.value ?? 'FAILED'}`) }}
        </GNote>
        <div class="recovery-export__actions">
          <GButton tier="secondary" @click="close()">{{ $t('common.close') }}</GButton>
          <GButton tier="primary" @click="flow.reset()">{{ $t('common.retry') }}</GButton>
        </div>
      </template>

      <GNote v-if="flow.error.value === 'WRONG_PASSWORD' && flow.step.value !== 'failed'" tone="error" role="alert">
        {{ $t('gerovault.detail.recovery.exportError.WRONG_PASSWORD') }}
      </GNote>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import GNote from '@/shared/components/GNote.vue';
import { RECOVERY_PASSPHRASE_MIN_CODE_POINTS, displayLabel } from '@/shared/gerovault';
import type { VaultRecord } from '@/modules/gerovault/contracts';
import { useGerovaultWallet, useVaultRoleKeysSource } from '@/modules/gerovault/detail/context';
import PassphraseGroups from './PassphraseGroups.vue';
import SpendingPasswordField from './SpendingPasswordField.vue';
import { useRecoveryExport } from './useRecoveryExport';

defineOptions({ name: 'RecoveryExportDialog' });

const props = defineProps<{ isOpen: boolean; record: VaultRecord }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'exported'): void }>();

const wallet = useGerovaultWallet();
const flow = useRecoveryExport(() => props.record, {
  walletId: () => wallet()?.walletId,
  roleKeys: useVaultRoleKeysSource(),
});

const leftOut = computed(() => {
  const s = flow.result.value?.skipped;
  return s ? s.proposals + s.addressBook + s.participantLabels + s.endorsements + s.externalAttestations : 0;
});

/** The key of what is wrong with the own passphrase, once something is typed. */
const ownErrorKey = computed(() => {
  const problem = flow.ownCheck.value.problem;
  if (!flow.ownPassphrase.value || !problem || problem === 'MISMATCH') return '';
  return `gerovault.detail.recovery.ownProblem.${problem}`;
});

function close(): void {
  if (flow.step.value === 'exporting') return;
  const exported = flow.step.value === 'done';
  flow.reset();
  if (exported) emit('exported');
  emit('close');
}
</script>

<style scoped>
.recovery-export {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding-top: var(--g-s-2);
}
.recovery-export p {
  margin: 0;
}
.recovery-export__choices {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--g-s-3);
}
.recovery-export__choice {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--g-s-1);
  padding: var(--g-s-4);
  border-radius: var(--g-r-card);
  border: 1px solid var(--g-hairline-2);
  text-align: left;
  color: var(--g-text-1);
  cursor: pointer;
}
.recovery-export__choice:hover {
  border-color: var(--g-accent);
}
.recovery-export__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--g-s-3);
}
.recovery-export__wait,
.recovery-export__done {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-4) 0;
  text-align: center;
}
</style>
