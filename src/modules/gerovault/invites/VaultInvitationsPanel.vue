<template>
  <div v-if="inv.state.value !== 'unavailable'" class="vault-invitations" data-test="overview-invitations">
    <div class="vault-invitations__bar">
      <GButton tier="tertiary" compact data-test="overview-have-invite" @click="openOpen = true">
        <v-icon size="small" start aria-hidden="true">mdi-email-open-outline</v-icon>{{ $t('gerovault.invite.overview.haveInvite') }}
      </GButton>
    </div>

    <!-- Invitations for this device: Needs you first, then joined ones waiting for the number. -->
    <ul v-if="inv.forYou.value.length || inv.toVerify.value.length" class="vault-invitations__list">
      <li v-for="i in inv.forYou.value" :key="i.ref" class="glass-panel vault-invitations__row" :data-test="`overview-invite-${i.ref}`">
        <div class="vault-invitations__text">
          <span class="t-body">{{ $t('gerovault.invite.review.headline', { name: displayLabel(i.inviter.label), vault: displayLabel(i.vault.name) }) }}</span>
          <span class="t-caption gvc-muted">{{ $t('gerovault.invite.overview.terms', { threshold: i.vault.threshold, owners: i.vault.owners, left: rel(timeLeft(i.expiresAt, now)) }) }}</span>
        </div>
        <GButton tier="primary" compact data-test="overview-review" @click="review(i)">{{ $t('gerovault.invite.overview.review') }}</GButton>
      </li>
      <li v-for="i in inv.toVerify.value" :key="i.ref" class="glass-panel vault-invitations__row" :data-test="`overview-joined-${i.ref}`">
        <div class="vault-invitations__text">
          <span class="t-body">{{ $t('gerovault.invite.overview.joined', { vault: displayLabel(i.vault.name) }) }}</span>
          <span class="t-caption gvc-muted">{{ $t('gerovault.invite.overview.verifyNext', { name: displayLabel(i.inviter.label) }) }}</span>
        </div>
        <span class="gvc-chip gvc-chip--wait t-caption">{{ $t('gerovault.invite.status.unverified') }}</span>
        <GButton tier="secondary" compact data-test="overview-verify" @click="verifying = i">{{ $t('gerovault.invite.review.verifyWith', { name: displayLabel(i.inviter.label) }) }}</GButton>
      </li>
    </ul>

    <!-- Setups in progress (UX rule 3). -->
    <section v-if="inv.openSetups.value.length" class="vault-invitations__section">
      <h2 class="t-label">{{ $t('gerovault.invite.overview.settingUp') }}</h2>
      <SetupCard
        v-for="s in inv.openSetups.value"
        :key="s.setupId"
        :setup="s"
        :now="now"
        @remind="inv.remind(s.setupId, $event)"
        @cancel="inv.cancelSetup(s.setupId)"
      />
    </section>

    <!-- From someone with no contact or shared vault here: never straight to Needs you. -->
    <section v-if="inv.requests.value.length" class="vault-invitations__section" data-test="overview-requests">
      <h2 class="t-label">{{ $t('gerovault.invite.overview.requests') }}</h2>
      <ul class="vault-invitations__list">
        <li v-for="i in inv.requests.value" :key="i.ref" class="glass-panel vault-invitations__row">
          <div class="vault-invitations__text">
            <span class="t-body">{{ $t('gerovault.invite.review.headline', { name: displayLabel(i.inviter.label), vault: displayLabel(i.vault.name) }) }}</span>
            <span class="t-caption gvc-muted">{{ $t('gerovault.invite.review.unknown') }}</span>
          </div>
          <GButton tier="secondary" compact @click="review(i)">{{ $t('gerovault.invite.overview.review') }}</GButton>
        </li>
      </ul>
    </section>

    <GNote v-if="inv.problem.value" tone="error" icon="mdi-alert-circle-outline" role="alert">{{ $t(inviteProblemKey(inv.problem.value)) }}</GNote>
    <p v-if="inv.refused.value > 0" class="t-caption gvc-faint" role="status">{{ $t('gerovault.invite.overview.refused', { count: inv.refused.value }) }}</p>

    <OpenInviteDialog v-if="openOpen" :is-open="openOpen" :open="inv.openLink" :problem="() => inv.problem.value" @close="openOpen = false" @opened="opened($event)" />
    <InviteReviewDialog
      v-if="reviewing"
      :is-open="reviewing !== null"
      :invite="reviewing"
      :logged-wallet-id="walletId"
      :key-source="keySource"
      :client="client"
      :auth="auth"
      :store="store"
      @close="reviewing = null"
      @changed="changed($event)"
      @verify="startVerify($event)"
    />
    <JoinedVerifyDialog
      v-if="verifying"
      :is-open="verifying !== null"
      :invite="verifying"
      :key-source="keySource"
      :unlock-account-key="unlockAccountKey"
      :store="store"
      :client="client"
      @close="closeVerify()"
      @changed="inv.replaceInvite($event)"
    />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import GButton from '@/shared/components/GButton/GButton.vue';
import GNote from '@/shared/components/GNote.vue';
import { displayLabel, type MultisigAccountPublicKey } from '@/shared/gerovault';
import { useTranslation } from '@/shared/composables/useTranslation';
import type { VaultStore } from '@/modules/gerovault/contracts';
import type { KeySource } from '@/modules/gerovault/create/eligibility';
import type { InviteAuth, InviteClient, ReceivedView } from './inviteClient';
import { timeLeft, type RelativeTime } from './inviteTime';
import { inviteProblemKey } from './messages';
import { useVaultInvitations } from './useVaultInvitations';
import InviteReviewDialog from './InviteReviewDialog.vue';
import JoinedVerifyDialog from './JoinedVerifyDialog.vue';
import OpenInviteDialog from './OpenInviteDialog.vue';
import SetupCard from './SetupCard.vue';

/**
 * Invitations on the Vaults overview (canvas "Vaults overview: Setting up"): invitations for this
 * device, joined vaults waiting for the number, setups in progress, requests from strangers, and
 * "Have an invite?" for a pasted link or a scanned QR. `?invite=<ref>` (from the bell or a push)
 * opens that invitation's review.
 */
const props = defineProps<{
  walletId: number | null;
  keySource: KeySource | null;
  client: InviteClient;
  auth: (password: string) => Promise<InviteAuth>;
  unlockAccountKey: (password: string) => Promise<MultisigAccountPublicKey>;
  store: VaultStore;
}>();

const { t } = useTranslation();
const route = useRoute();
const router = useRouter();
const inv = useVaultInvitations({ client: props.client, walletId: () => props.walletId ?? undefined });

const now = ref(Date.now());
const clock = setInterval(() => { now.value = Date.now(); }, 30_000);
const rel = (time: RelativeTime) => t(time.key, { n: time.n });

const openOpen = ref(false);
const reviewing = shallowRef<ReceivedView | null>(null);
const verifying = shallowRef<ReceivedView | null>(null);

function review(i: ReceivedView): void {
  reviewing.value = i;
}

function opened(view: ReceivedView): void {
  openOpen.value = false;
  reviewing.value = view;
}

function changed(view: ReceivedView): void {
  inv.replaceInvite(view);
  reviewing.value = view;
}

function closeVerify(): void {
  verifying.value = null;
  void inv.reload();
}

function startVerify(view: ReceivedView): void {
  reviewing.value = null;
  verifying.value = view;
}

async function openFromRoute(): Promise<void> {
  const ref = route.query['invite'];
  if (typeof ref !== 'string' || !/^(?:[0-9a-f]{32}|l[0-9a-f]{64})$/.test(ref)) return;
  const view = await inv.get(ref);
  if (view) reviewing.value = view;
  // The query is consumed: closing the sheet does not reopen it.
  void router.replace({ query: { ...route.query, invite: undefined } }).catch(() => undefined);
}

onMounted(async () => {
  await inv.reload();
  await openFromRoute();
});
watch(() => route.query['invite'], () => { void openFromRoute(); });
watch(() => props.walletId, () => { void inv.reload(); });
onBeforeUnmount(() => clearInterval(clock));
</script>

<style scoped>
.vault-invitations {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
}
.vault-invitations__bar {
  display: flex;
  justify-content: flex-end;
}
.vault-invitations__section {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}
.vault-invitations__section h2 {
  margin: 0;
}
.vault-invitations__list {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.vault-invitations__row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--g-s-3);
  padding: var(--g-s-3) var(--g-s-4);
  border-radius: var(--g-r-card);
}
.vault-invitations__text {
  display: flex;
  flex: 1 1 220px;
  flex-direction: column;
  min-width: 0;
}
</style>
