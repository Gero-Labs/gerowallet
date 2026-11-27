<template>
  <BaseDialog :is-open="isOpen" size="md" :min-height="0" :persistent="busy" :title="$t('gerovault.invite.verify.title', { name: inviter, vault: vaultName })" @close="emit('close')">
    <div class="joined-verify" data-test="joined-verify">
      <GNote v-if="unbuildable === 'MORE_OWNERS'" icon="mdi-information-outline" role="status" data-test="joined-verify-more-owners">
        {{ $t('gerovault.invite.verify.moreOwners', { name: inviter }) }}
      </GNote>

      <template v-else-if="saved">
        <GNote icon="mdi-check-circle-outline" role="status" data-test="joined-verify-done">
          <strong>{{ $t('gerovault.invite.verify.doneTitle', { name: inviter }) }}</strong>
          {{ $t('gerovault.invite.verify.doneText') }}
        </GNote>
        <div class="joined-verify__actions">
          <GButton tier="primary" :to="{ name: GEROVAULT_VAULT_ROUTE, params: { vaultId: saved } }" data-test="joined-verify-open">{{ $t('gerovault.create.openVault') }}</GButton>
        </div>
      </template>

      <!-- This side reads groups 5 to 8 and ticks 1 to 4. -->
      <VerifyTogether
        v-else-if="groups"
        :groups="groups"
        role="cosigner"
        :peer="invite.inviter.label"
        :busy="busy"
        @confirm="confirm()"
      />

      <template v-else>
        <p class="t-body-sm gvc-muted">{{ $t('gerovault.invite.verify.unlock') }}</p>
        <div class="joined-verify__unlock">
          <v-text-field
            v-if="keySource === 'password'"
            v-model="password"
            type="password"
            autocomplete="current-password"
            :label="$t('wallet.spendingPassword')"
            density="compact"
            variant="outlined"
            hide-details="auto"
            :disabled="busy"
            data-test="joined-verify-password"
            @keyup.enter="open()"
          />
          <GButton tier="secondary" :loading="busy" :disabled="keySource === 'password' && !password" data-test="joined-verify-unlock" @click="open()">
            {{ $t('gerovault.invite.verify.showNumber') }}
          </GButton>
        </div>
      </template>
      <GNote v-if="problem" tone="error" icon="mdi-alert-circle-outline" role="alert" data-test="joined-verify-problem">{{ $t(problem) }}</GNote>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import GNote from '@/shared/components/GNote.vue';
import { displayLabel, verificationNumber, type MultisigAccountPublicKey } from '@/shared/gerovault';
import { GEROVAULT_VAULT_ROUTE } from '@/modules/gerovault/gerovaultRoutes';
import type { VaultStore } from '@/modules/gerovault/contracts';
import type { KeySource } from '@/modules/gerovault/create/eligibility';
import { OwnAccountKeyError } from '@/modules/gerovault/create/ownAccountKeyFlow';
import { UNLOCK_PROBLEM_KEYS, saveProblemKey } from '@/modules/gerovault/create/messages';
import type { InviteClient, ReceivedView } from './inviteClient';
import { buildJoinedVault, joinedVaultProblem, saveJoinedVault, type JoinedVault } from './joinedVault';
import VerifyTogether from './VerifyTogether.vue';

/**
 * The cosigner verifies the vault they joined (canvas "Verify together", the cosigner's side):
 * their own keys from their account key behind their credential, the inviter's from the checked
 * invitation, the same 40 digits read in turns. On a match the vault is kept here, accepted, with
 * that record. Funding still waits for every cosigner (`fundingVerified`).
 */
const props = defineProps<{
  isOpen: boolean;
  invite: ReceivedView;
  keySource: KeySource | null;
  /** This wallet's CIP-1854 account key behind its credential (`ownAccountKey.ts`). */
  unlockAccountKey: (password: string) => Promise<MultisigAccountPublicKey>;
  store: VaultStore;
  client: Pick<InviteClient, 'markJoined'>;
}>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'changed', view: ReceivedView): void }>();

const inviter = computed(() => displayLabel(props.invite.inviter.label));
const vaultName = computed(() => displayLabel(props.invite.vault.name));
const unbuildable = computed(() => joinedVaultProblem(props.invite));

const password = ref('');
const busy = ref(false);
const problem = ref<string | null>(null);
const joined = shallowRef<JoinedVault | null>(null);
const saved = ref<string | null>(null);
const groups = computed(() => (joined.value?.manifestState.ok ? verificationNumber(joined.value.manifestState.manifest) : null));

async function open(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  problem.value = null;
  const typed = password.value;
  password.value = '';
  try {
    const account = await props.unlockAccountKey(typed);
    const built = await buildJoinedVault(account, props.invite, Math.floor(Date.now() / 1000));
    if (!built.manifestState.ok) {
      problem.value = 'gerovault.invite.problem.REFUSED';
      return;
    }
    joined.value = built;
  } catch (error) {
    if (error instanceof OwnAccountKeyError) problem.value = UNLOCK_PROBLEM_KEYS[error.code];
    else problem.value = (error as { code?: string })?.code === 'KEY_MISMATCH' ? 'gerovault.invite.verify.keyMismatch' : 'gerovault.invite.problem.REFUSED';
  } finally {
    busy.value = false;
  }
}

async function confirm(): Promise<void> {
  const built = joined.value;
  const join = props.invite.join;
  if (!built || !join || busy.value) return;
  busy.value = true;
  problem.value = null;
  try {
    const { record } = await saveJoinedVault(props.store, join.walletId, built, props.invite.vault.name, Math.floor(Date.now() / 1000));
    saved.value = record.vaultId;
    const view = await props.client.markJoined(props.invite.ref, record.vaultId).catch(() => null);
    if (view) emit('changed', view);
  } catch (error) {
    problem.value = saveProblemKey((error as { code?: string })?.code ?? 'UNKNOWN');
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.joined-verify {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding-top: var(--g-s-2);
}
.joined-verify p {
  margin: 0;
}
.joined-verify__unlock {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: var(--g-s-3);
}
.joined-verify__unlock :deep(.v-input) {
  flex: 1 1 220px;
}
.joined-verify__actions {
  display: flex;
  justify-content: flex-end;
}
</style>
