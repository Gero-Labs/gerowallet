<template>
  <BaseDialog :is-open="isOpen" size="md" :min-height="0" :persistent="busy" :title="$t('gerovault.invite.review.title')" @close="emit('close')">
    <template #meta>
      <span v-if="invite.state === 'open'" class="gvc-chip gvc-chip--wait t-caption">{{ rel(timeLeft(invite.expiresAt, now)) }}</span>
    </template>
    <div class="invite-review" data-test="invite-review">
      <div class="invite-review__bar">
        <h2 class="t-title invite-review__headline">{{ $t('gerovault.invite.review.headline', { name: inviter, vault: vaultName }) }}</h2>
        <DetailsToggle v-model="detailsOn" :peeking="peeking" />
      </div>

      <!-- Who is asking. Labels and handles are the inviter's own words: never a check. -->
      <div class="invite-review__who glass-tier">
        <span class="invite-review__avatar t-label" aria-hidden="true">{{ initial }}</span>
        <div class="invite-review__col">
          <span class="t-body">{{ inviter }}</span>
          <span class="t-caption gvc-muted">
            {{ invite.known ? $t('gerovault.invite.review.known') : $t('gerovault.invite.review.unknown') }}<template v-if="invite.inviter.handle"> · {{ $t('gerovault.invite.review.handle', { handle: invite.inviter.handle }) }}</template>
          </span>
        </div>
      </div>

      <dl class="gvc-facts t-body-sm">
        <dt>{{ $t('gerovault.invite.review.approvals') }}</dt>
        <dd>{{ $t('gerovault.invite.review.mOfN', { threshold: invite.vault.threshold, owners: invite.vault.owners }) }}</dd>
        <dt>{{ $t('gerovault.invite.review.network') }}</dt>
        <dd>{{ invite.network }}</dd>
        <dt>{{ $t('gerovault.invite.review.cosigners') }}</dt>
        <dd>{{ people }}</dd>
      </dl>
      <GNote v-if="invite.vault.threshold === invite.vault.owners" icon="mdi-alert-outline" role="status">{{ $t('gerovault.create.template.allOwnersWarning') }}</GNote>

      <!-- Joined: one step left, the number on a call. -->
      <template v-if="invite.state === 'accepted' && invite.join">
        <GNote icon="mdi-check-circle-outline" role="status" data-test="invite-joined">
          <strong>{{ $t('gerovault.invite.review.joinedTitle', { vault: vaultName }) }}</strong>
          {{ $t('gerovault.invite.review.joinedText', { name: inviter }) }}
        </GNote>
        <div class="invite-review__actions">
          <GButton tier="secondary" data-test="invite-later" @click="emit('close')">{{ $t('gerovault.invite.review.later') }}</GButton>
          <GButton tier="primary" data-test="invite-verify" @click="emit('verify', invite)">{{ $t('gerovault.invite.review.verifyWith', { name: inviter }) }}</GButton>
        </div>
      </template>

      <!-- Answered, expired or revoked: say which, by whom and when. -->
      <GNote v-else-if="invite.state !== 'open'" icon="mdi-information-outline" role="status" data-test="invite-ended">
        {{ endedText }}
      </GNote>

      <template v-else>
        <!-- The cost first (UX rule 1). -->
        <ul class="invite-review__cost glass-tier">
          <li><strong>{{ $t('gerovault.invite.review.costFunds') }}</strong> {{ $t('gerovault.invite.review.costFundsText') }}</li>
          <li><strong>{{ $t('gerovault.invite.review.costTime') }}</strong> {{ $t('gerovault.invite.review.costTimeText', { name: inviter }) }}</li>
          <li><strong>{{ $t('gerovault.invite.review.costLater') }}</strong> {{ $t('gerovault.invite.review.costLaterText', { threshold: invite.vault.threshold }) }}</li>
        </ul>

        <dl v-if="detailsVisible" class="gvc-facts t-caption" data-test="invite-review-details">
          <dt>{{ $t('gerovault.invite.review.answering') }}</dt>
          <dd>{{ answering ? answering.name + (answering.addressed ? ` ${$t('gerovault.invite.review.addressedHere')}` : '') : '' }}</dd>
          <template v-if="preview">
            <dt>{{ $t('gerovault.create.own.index') }}</dt>
            <dd class="g-mono">{{ preview.index }}</dd>
            <dt>{{ $t('gerovault.create.own.paymentPath') }}</dt>
            <dd class="g-mono">{{ preview.payment }}</dd>
            <dt>{{ $t('gerovault.create.own.stakePath') }}</dt>
            <dd class="g-mono">{{ preview.stake }}</dd>
          </template>
          <dt>{{ $t('gerovault.invite.review.sent') }}</dt>
          <dd>{{ $t('gerovault.invite.review.sentText') }}</dd>
          <dt>{{ $t('gerovault.invite.review.inviterKey') }}</dt>
          <dd class="g-mono">{{ invite.inviter.payment }}</dd>
        </dl>

        <!-- Never a dead end: no wallet here for this network, or another wallet answers. -->
        <GNote v-if="!answering && invite.wallets.length === 0" icon="mdi-wallet-plus-outline" role="status" data-test="invite-no-wallet">
          {{ $t('gerovault.invite.review.noWallet', { network: invite.network }) }}
        </GNote>
        <GNote v-else-if="!answering" icon="mdi-swap-horizontal" role="status" data-test="invite-switch-wallet">
          {{ $t('gerovault.invite.review.switchWallet', { names: invite.wallets.map(w => w.name).join(', ') }) }}
        </GNote>
        <template v-else>
          <template v-if="!answering.backedUp">
            <GNote icon="mdi-shield-alert-outline" role="status" data-test="invite-backup-gate">{{ $t('gerovault.invite.review.backupFirst') }}</GNote>
            <GButton class="invite-review__backup" compact tier="secondary" data-test="invite-backup-now" @click="backupOpen = true">{{ $t('gerovault.invite.review.backupNow') }}</GButton>
          </template>
          <v-text-field
            v-if="keySource === 'password'"
            v-model="password"
            type="password"
            autocomplete="current-password"
            :label="$t('wallet.spendingPassword')"
            density="compact"
            variant="outlined"
            hide-details="auto"
            :disabled="busy || !answering.backedUp"
            data-test="invite-password"
            @keyup.enter="join()"
          />
        </template>

        <GNote v-if="problem" tone="error" icon="mdi-alert-circle-outline" role="alert" data-test="invite-review-problem">{{ $t(inviteProblemKey(problem)) }}</GNote>

        <div class="invite-review__actions">
          <span class="invite-review__secondary">
            <GButton tier="tertiary" :disabled="busy" data-test="invite-decline" @click="decline()">{{ $t('gerovault.invite.review.decline') }}</GButton>
            <GButton v-if="!invite.known && invite.source === 'mailbox'" tier="tertiary" :disabled="busy" data-test="invite-block" @click="block()">{{ $t('gerovault.invite.review.block') }}</GButton>
          </span>
          <GButton tier="primary" :disabled="!canJoin" :loading="busy" data-test="invite-join" @click="join()">
            {{ keySource === 'passkey' ? $t('gerovault.invite.review.joinPassKey') : $t('gerovault.invite.review.join') }}
          </GButton>
        </div>
      </template>
    </div>
    <BackupWalletDialog v-if="backupOpen" :is-open="backupOpen" @close="afterBackup()" />
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import DetailsToggle from '@/shared/components/DetailsToggle.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import GNote from '@/shared/components/GNote.vue';
import BackupWalletDialog from '@/modules/navigation/dialogs/BackupWalletDialog.vue';
import { useDetailsLayer } from '@/shared/composables/useDetailsLayer';
import { useTranslation } from '@/shared/composables/useTranslation';
import { ROLE, displayLabel, formatVaultKeyPath } from '@/shared/gerovault';
import { allocateOwnIndex } from '@/modules/gerovault/create/createVault';
import type { KeySource } from '@/modules/gerovault/create/eligibility';
import type { VaultStore } from '@/modules/gerovault/contracts';
import { inviteErrorCode, type InviteAuth, type InviteClient, type ReceivedView } from './inviteClient';
import { timeLeft, type RelativeTime } from './inviteTime';
import { inviteProblemKey } from './messages';

/**
 * The cosigner's review of an invitation (canvas "Invitation review (extension)"), opened from the
 * bell, the Vaults overview or a pasted link. The cost first, the keys and index under Details,
 * the backup gate (a wallet whose recovery phrase is not backed up backs it up and comes back), one
 * approval to join, Decline (sends nothing about the wallet), and the joined state with "Verify
 * with <name>". Every answer is the background's; this sheet only lays it out.
 */
const props = defineProps<{
  isOpen: boolean;
  invite: ReceivedView;
  /** The logged wallet: the one that answers when the invitation names it or came by link. */
  loggedWalletId: number | null;
  keySource: KeySource | null;
  client: Pick<InviteClient, 'accept' | 'decline' | 'block' | 'getInvite' | 'holds'>;
  /** The credential of the accept from what was typed (`passKeyAuth` for a PassKey wallet). */
  auth: (password: string) => Promise<InviteAuth>;
  store: Pick<VaultStore, 'list'>;
}>();

const emit = defineEmits<{ (e: 'close'): void; (e: 'changed', view: ReceivedView): void; (e: 'verify', view: ReceivedView): void }>();
const { t } = useTranslation();
const { enabled: detailsOn, peeking, visible: detailsVisible } = useDetailsLayer('gerovault.invite');

const now = ref(Date.now());
const rel = (time: RelativeTime) => t(time.key, { n: time.n });
const inviter = computed(() => displayLabel(props.invite.inviter.label));
const vaultName = computed(() => displayLabel(props.invite.vault.name));
const initial = computed(() => [...props.invite.inviter.label][0]?.toUpperCase() ?? '?');
const people = computed(() => [props.invite.inviter.label, ...props.invite.participants.map(p => p.label)].map(displayLabel).concat(t('gerovault.invite.review.you')).join(', '));
const answering = computed(() => props.invite.wallets.find(w => w.walletId === props.loggedWalletId) ?? null);

const password = ref('');
const busy = ref(false);
const problem = ref<string | null>(null);
const backupOpen = ref(false);

const canJoin = computed(() => !busy.value && !!answering.value?.backedUp && props.keySource !== null && (props.keySource !== 'password' || password.value !== ''));

const endedText = computed(() => {
  const i = props.invite;
  const when = i.endedAt ? new Date(i.endedAt).toLocaleDateString() : '';
  switch (i.state) {
    case 'expired': return t('gerovault.invite.review.ended.expired', { name: inviter.value });
    case 'revoked': return i.revokedByInviter ? t('gerovault.invite.review.ended.revokedBy', { name: inviter.value, when }) : t('gerovault.invite.review.ended.unavailable');
    case 'declined': return t('gerovault.invite.review.ended.declined');
    case 'answeredElsewhere': return t('gerovault.invite.review.ended.elsewhere');
    case 'blocked': return t('gerovault.invite.review.ended.blocked');
    case 'cancelled': return t('gerovault.invite.review.ended.cancelled', { name: inviter.value });
    default: return t('gerovault.invite.review.ended.done');
  }
});

// The index this wallet would take, for the Details layer. The background allocates again on Join.
const preview = ref<{ index: number; payment: string; stake: string } | null>(null);
watch([detailsVisible, answering], async ([visible, wallet]) => {
  if (!visible || !wallet || preview.value) return;
  try {
    const [records, holds] = await Promise.all([props.store.list(wallet.walletId), props.client.holds(wallet.walletId)]);
    const allocation = allocateOwnIndex(records, holds);
    if (allocation.ok) preview.value = { index: allocation.index, payment: formatVaultKeyPath(ROLE.PAYMENT, allocation.index), stake: formatVaultKeyPath(ROLE.STAKE, allocation.index) };
  } catch {
    preview.value = null;
  }
}, { immediate: true });

async function run(action: () => Promise<ReceivedView>): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  problem.value = null;
  try {
    emit('changed', await action());
  } catch (error) {
    problem.value = inviteErrorCode(error);
    // The invitation may have ended meanwhile: show its state as the background has it now.
    const fresh = await props.client.getInvite(props.invite.ref).catch(() => null);
    if (fresh && fresh.state !== props.invite.state) emit('changed', fresh);
  } finally {
    busy.value = false;
  }
}

async function join(): Promise<void> {
  const wallet = answering.value;
  if (!canJoin.value || !wallet) return;
  const typed = password.value;
  password.value = '';
  await run(async () => props.client.accept({ ref: props.invite.ref, walletId: wallet.walletId }, await props.auth(typed)));
}

const decline = () => run(() => props.client.decline(props.invite.ref));
const block = () => run(() => props.client.block(props.invite.ref));

/** Back from the backup: read the invitation again, which re-reads the wallet's backup flag. */
async function afterBackup(): Promise<void> {
  backupOpen.value = false;
  const fresh = await props.client.getInvite(props.invite.ref).catch(() => null);
  if (fresh) emit('changed', fresh);
}
</script>

<style scoped>
.invite-review {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding-top: var(--g-s-2);
}
.invite-review__bar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--g-s-3);
}
.invite-review__headline {
  margin: 0;
}
.invite-review__who {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  padding: var(--g-s-3);
  border-radius: var(--g-r-card);
}
.invite-review__avatar {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-pill);
  color: var(--g-text-2);
}
.invite-review__col {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.invite-review__cost {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  margin: 0;
  padding: var(--g-s-3) var(--g-s-4);
  border-radius: var(--g-r-card);
  list-style: none;
  color: var(--g-text-2);
}
.invite-review__cost strong {
  color: var(--g-text-1);
}
.invite-review__backup {
  align-self: flex-start;
}
.invite-review__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--g-s-2);
}
.invite-review__secondary {
  display: inline-flex;
  gap: var(--g-s-1);
}
</style>
