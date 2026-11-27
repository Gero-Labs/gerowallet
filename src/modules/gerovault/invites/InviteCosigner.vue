<template>
  <div class="invite-cosigner" :data-test="`invite-slot-${n}`">
    <GNote v-if="!slot" icon="mdi-lock-outline" role="status">{{ $t('gerovault.invite.card.unlockFirst') }}</GNote>

    <!-- Invited, not joined yet: who, when it expires, Remind and Revoke. -->
    <div v-else-if="slot.status === 'waiting'" class="invite-cosigner__row" data-test="invite-waiting">
      <span class="invite-cosigner__avatar t-label" aria-hidden="true">{{ initial(who) }}</span>
      <div class="invite-cosigner__who">
        <span class="t-body">{{ who }}</span>
        <span class="t-caption gvc-faint">
          {{ $t('gerovault.invite.card.invited', { when: rel(timeAgo(slot.invite!.sentAt, now)), left: rel(timeLeft(slot.invite!.expiresAt, now)) }) }}
        </span>
      </div>
      <span class="gvc-chip gvc-chip--wait t-caption">{{ $t('gerovault.invite.status.waiting') }}</span>
      <div class="invite-cosigner__actions">
        <GButton compact tier="tertiary" :loading="flow.inviteBusy.value === n" data-test="invite-remind" @click="flow.remindCosigner(n)">{{ $t('gerovault.invite.card.remind') }}</GButton>
        <GButton compact tier="tertiary" :disabled="flow.inviteBusy.value !== null" data-test="invite-revoke" @click="flow.revokeCosigner(n)">{{ $t('gerovault.invite.card.revoke') }}</GButton>
      </div>
    </div>

    <!-- Joined: Accepted, and Unverified until the number is read (GV-61). -->
    <div v-else-if="slot.status === 'accepted' && slot.accept" class="invite-cosigner__row" data-test="invite-accepted">
      <span class="invite-cosigner__avatar t-label" aria-hidden="true">{{ initial(slot.accept.label) }}</span>
      <div class="invite-cosigner__who">
        <span class="t-body">{{ displayLabel(slot.accept.label) }}</span>
        <span class="t-caption gvc-faint">{{ $t(`gerovault.invite.card.joinedVia.${slot.accept.via}`, { when: rel(timeAgo(slot.accept.acceptedAt, now)) }) }}</span>
      </div>
      <span class="gvc-chip gvc-chip--ok t-caption">{{ $t('gerovault.invite.status.accepted') }}</span>
      <span class="gvc-chip t-caption" :class="slot.verified ? 'gvc-chip--ok' : 'gvc-chip--wait'">
        {{ slot.verified ? $t('gerovault.invite.status.verified') : $t('gerovault.invite.status.unverified') }}
      </span>
    </div>

    <!-- Nobody yet (or declined, revoked, expired): one field, contacts first. -->
    <template v-else>
      <p v-if="slot.status !== 'empty'" class="t-caption invite-cosigner__ended" data-test="invite-ended">
        <span class="gvc-chip t-caption">{{ $t(`gerovault.invite.status.${slot.status}`) }}</span>
        {{ $t(`gerovault.invite.card.ended.${slot.status}`, { name: who }) }}
      </p>
      <div class="invite-cosigner__entry">
        <v-text-field
          v-model="entry"
          :label="$t('gerovault.invite.card.entry')"
          :hint="$t('gerovault.invite.card.entryHint')"
          persistent-hint
          density="compact"
          variant="outlined"
          spellcheck="false"
          autocomplete="off"
          :error-messages="resolveError ? [resolveError] : []"
          data-test="invite-entry"
          @update:model-value="onEntry()"
        />
        <ul v-if="suggestions.length" class="invite-cosigner__suggestions" :aria-label="$t('gerovault.invite.card.contacts')">
          <li v-for="c in suggestions" :key="c.address">
            <button type="button" class="invite-cosigner__suggestion" data-test="invite-contact" @click="pick(c)">
              <span class="invite-cosigner__avatar t-label" aria-hidden="true">{{ initial(c.name) }}</span>
              <span class="invite-cosigner__who">
                <span class="t-body-sm">{{ c.name }}</span>
                <span class="t-caption g-mono gvc-faint">{{ c.handle || shortAddress(c.address) }}</span>
              </span>
            </button>
          </li>
        </ul>
        <p v-if="resolved" class="t-caption gvc-muted" data-test="invite-resolved">
          <template v-if="resolved.kind === 'handle'">{{ $t('gerovault.invite.card.resolvedHandle', { handle: resolved.handle }) }}</template>
          <template v-else>{{ $t('gerovault.invite.card.resolvedAddress', { address: shortAddress(resolved.address) }) }}</template>
          · {{ chosen ? $t('gerovault.invite.card.contact') : $t('gerovault.invite.card.notContact') }}
        </p>
      </div>
      <div class="invite-cosigner__buttons">
        <GButton tier="primary" compact :disabled="!resolved || flow.inviteBusy.value !== null" :loading="flow.inviteBusy.value === n" data-test="invite-send" @click="send()">
          {{ $t('gerovault.invite.card.send') }}
        </GButton>
        <GButton tier="secondary" compact data-test="invite-show-qr" @click="emit('showQr')">
          <v-icon size="small" start aria-hidden="true">mdi-qrcode</v-icon>{{ $t('gerovault.invite.card.showQr') }}
        </GButton>
        <GButton tier="secondary" compact :loading="copying" data-test="invite-copy-link" @click="copyLink()">
          <v-icon size="small" start aria-hidden="true">mdi-link-variant</v-icon>{{ $t('gerovault.invite.card.copyLink') }}
        </GButton>
        <GButton tier="tertiary" compact data-test="create-source-external" @click="usePaste('external')">{{ $t('gerovault.invite.card.otherWallet') }}</GButton>
      </div>
      <GNote v-if="copied" icon="mdi-check" role="status" data-test="invite-link-copied">
        {{ $t('gerovault.invite.card.linkCopied', { left: rel(timeLeft(copied, now)) }) }}
      </GNote>
      <button v-if="details" type="button" class="invite-cosigner__link t-caption" data-test="invite-paste-keys" @click="usePaste('gero')">
        {{ $t('gerovault.invite.card.pasteKeys') }}
      </button>
    </template>

    <GNote v-if="problem" tone="error" icon="mdi-alert-circle-outline" role="alert" data-test="invite-problem">{{ $t(inviteProblemKey(problem.code)) }}</GNote>

    <dl v-if="details && slot?.accept" class="gvc-facts t-caption" data-test="invite-details">
      <dt>{{ $t('gerovault.invite.card.stakeCredential') }}</dt>
      <dd class="g-mono">{{ slot.accept.stakeCredential }}</dd>
      <dt>{{ $t('gerovault.create.cosigner.paymentKey') }}</dt>
      <dd class="g-mono">{{ slot.accept.payment }}</dd>
      <dt>{{ $t('gerovault.create.cosigner.stakeKey') }}</dt>
      <dd class="g-mono">{{ slot.accept.stake }}</dd>
    </dl>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import GNote from '@/shared/components/GNote.vue';
import { displayLabel } from '@/shared/gerovault';
import { useTranslation } from '@/shared/composables/useTranslation';
import type { ResolvedCosigner } from '@/services/vaultInvites/resolveCosigner';
import type { CreateVaultFlow, DraftRow } from '@/modules/gerovault/create/useCreateVault';
import { fingerprint } from '@/modules/gerovault/create/createVault';
import type { InviteClient } from './inviteClient';
import { timeAgo, timeLeft, type RelativeTime } from './inviteTime';
import { RESOLVE_PROBLEM_KEYS, inviteProblemKey } from './messages';

export interface InviteContact {
  readonly name: string;
  readonly address: string;
  readonly handle?: string;
}

/**
 * One cosigner slot by invitation (canvas "Create vault: 2 Cosigners"): one field, "Name, $handle or
 * address", with contacts first; Show QR, Copy link, "They use another wallet". Then the slot's
 * status: Waiting (with its expiry, Remind, Revoke), Accepted and Unverified or Verified. Never
 * "delivered": gero-sync's answers say nothing about delivery (issue 1772).
 */
const props = defineProps<{
  flow: CreateVaultFlow;
  draft: DraftRow;
  /** The slot: 0 for the first cosigner. */
  n: number;
  details: boolean;
  walletId: number;
  contacts: readonly InviteContact[];
  resolve: InviteClient['resolve'];
  /** Milliseconds, ticking (the page's clock). */
  now: number;
}>();

const emit = defineEmits<{ (e: 'showQr'): void }>();
const { t } = useTranslation();

const slot = computed(() => props.flow.setup.value?.slots[props.n]);
const problem = computed(() => {
  const p = props.flow.inviteProblem.value;
  return p && p.n === props.n ? p : null;
});

const who = computed(() => {
  const s = slot.value;
  if (!s) return '';
  if (s.label) return displayLabel(s.label);
  if (s.invite?.handle) return s.invite.handle;
  return s.invite ? fingerprint(s.invite.stakeCredential) : '';
});

const rel = (time: RelativeTime) => t(time.key, { n: time.n });
const initial = (label: string) => [...label.replace(/[⁦-⁩]/g, '')][0]?.toUpperCase() ?? '?';
const shortAddress = (a: string) => (a.length > 24 ? `${a.slice(0, 12)}…${a.slice(-6)}` : a);

// The entry: a contact, a $handle or an address, resolved in the worker to a stake credential.
const entry = ref('');
const chosen = ref<InviteContact | null>(null);
const resolved = ref<ResolvedCosigner | null>(null);
const resolveError = ref('');
let resolveSeq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

const suggestions = computed(() => {
  const q = entry.value.trim().toLowerCase();
  if (chosen.value || q.length === 0) return [];
  return props.contacts.filter(c => c.name.toLowerCase().includes(q) || c.handle?.toLowerCase().includes(q)).slice(0, 5);
});

async function runResolve(text: string): Promise<void> {
  const seq = ++resolveSeq;
  resolved.value = null;
  resolveError.value = '';
  const looksResolvable = text.startsWith('$') || /^(addr|stake)/i.test(text);
  if (!looksResolvable) return;
  try {
    const answer = await props.resolve(props.walletId, text);
    if (seq !== resolveSeq) return;
    if (answer.ok === true) resolved.value = answer.value;
    else resolveError.value = t(RESOLVE_PROBLEM_KEYS[answer.problem]);
  } catch {
    if (seq === resolveSeq) resolveError.value = t(RESOLVE_PROBLEM_KEYS.HANDLE_UNAVAILABLE);
  }
}

function onEntry(): void {
  chosen.value = null;
  clearTimeout(timer);
  const text = entry.value.trim();
  timer = setTimeout(() => { void runResolve(text); }, 400);
}

function pick(contact: InviteContact): void {
  chosen.value = contact;
  entry.value = contact.name;
  clearTimeout(timer);
  void runResolve(contact.address);
}

async function send(): Promise<void> {
  const target = resolved.value;
  if (!target) return;
  const label = chosen.value?.name ?? (target.handle ? target.handle.slice(1) : undefined);
  const ok = await props.flow.inviteCosigner(props.n, {
    stakeCredential: target.stakeCredential,
    ...(target.handle ? { handle: target.handle } : {}),
    ...(label ? { label } : {}),
  });
  if (ok) {
    entry.value = '';
    chosen.value = null;
    resolved.value = null;
  }
}

// Copy link: a one-time link for someone without Gero yet (their wallet opens it after install).
const copying = ref(false);
const copied = ref<number | null>(null);
async function copyLink(): Promise<void> {
  copying.value = true;
  try {
    const link = await props.flow.makeLink('link');
    if (!link) return;
    await navigator.clipboard?.writeText(link.url);
    copied.value = link.expiresAt;
  } finally {
    copying.value = false;
  }
}

function usePaste(source: 'gero' | 'external'): void {
  props.flow.updateDraft(props.draft.id, { mode: 'paste', source });
}

onBeforeUnmount(() => clearTimeout(timer));
</script>

<style scoped>
.invite-cosigner {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
}
.invite-cosigner__row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--g-s-3);
}
.invite-cosigner__avatar {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-pill);
  color: var(--g-text-2);
}
.invite-cosigner__who {
  display: flex;
  flex: 1 1 160px;
  flex-direction: column;
  min-width: 0;
  text-align: start;
}
.invite-cosigner__actions,
.invite-cosigner__buttons {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--g-s-2);
}
.invite-cosigner__entry {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}
.invite-cosigner__ended {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  margin: 0;
  color: var(--g-text-2);
}
.invite-cosigner__suggestions {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}
.invite-cosigner__suggestion {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  width: 100%;
  padding: var(--g-s-2);
  border-radius: var(--g-r-control);
  color: var(--g-text-1);
  cursor: pointer;
}
.invite-cosigner__suggestion:hover {
  background: var(--g-hairline-1);
}
.invite-cosigner__link {
  align-self: flex-start;
  padding: 0;
  color: var(--g-accent);
  cursor: pointer;
}
</style>
