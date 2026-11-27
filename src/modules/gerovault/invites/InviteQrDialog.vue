<template>
  <BaseDialog :is-open="isOpen" size="sm" :min-height="0" :title="$t('gerovault.invite.qr.title')" :subtitle="$t('gerovault.invite.qr.subtitle')" @close="close()">
    <div class="invite-qr" data-test="invite-qr">
      <div class="invite-qr__vault glass-tier">
        <span class="t-caption gvc-faint">{{ $t('gerovault.invite.qr.vault') }}</span>
        <span class="t-body">{{ displayLabel(setupName) }}</span>
        <span class="t-caption gvc-muted">{{ $t('gerovault.invite.qr.terms', { threshold, owners, network }) }}</span>
      </div>

      <template v-if="full">
        <GNote icon="mdi-check-all" role="status" data-test="invite-qr-full">{{ $t('gerovault.invite.qr.everyoneJoined') }}</GNote>
      </template>
      <template v-else-if="current">
        <figure class="invite-qr__code">
          <canvas ref="canvas" class="invite-qr__canvas" role="img" :aria-label="$t('gerovault.invite.qr.codeLabel')" data-test="invite-qr-code" />
          <figcaption class="t-caption gvc-muted" role="timer" aria-live="off">
            {{ $t('gerovault.invite.qr.worksOnce', { left: countdown(current.expiresAt, now) }) }}
          </figcaption>
        </figure>
        <!-- A QR always has a text alternative (UX rule 11). -->
        <div class="invite-qr__alt">
          <span class="t-caption gvc-faint">{{ $t('gerovault.invite.qr.textAlternative') }}</span>
          <div class="invite-qr__url">
            <span class="t-caption g-mono">{{ current.url }}</span>
            <CopyButton :value="current.url" x-small />
          </div>
        </div>
        <p class="t-caption gvc-muted">{{ $t('gerovault.invite.qr.afterJoin') }}</p>
      </template>
      <div v-else-if="loading" class="g-skeleton invite-qr__skeleton" role="status" :aria-label="$t('common.loading')"></div>
      <InviteBusyNote v-if="flow.busyUntil.value !== null" :until="flow.busyUntil.value" />
      <GNote v-if="problem" tone="error" icon="mdi-alert-circle-outline" role="alert">{{ $t(inviteProblemKey(problem)) }}</GNote>

      <section v-if="joined.length" class="invite-qr__joined" :aria-label="$t('gerovault.invite.qr.joinedHere')">
        <span class="t-label">{{ $t('gerovault.invite.qr.joinedHere') }}</span>
        <ul>
          <li v-for="j in joined" :key="j.n" class="t-body-sm" data-test="invite-qr-joined">
            {{ displayLabel(j.label) }} · <span class="gvc-chip gvc-chip--wait t-caption">{{ $t('gerovault.invite.status.unverified') }}</span>
          </li>
        </ul>
        <p v-if="!full" class="t-caption gvc-faint">{{ $t('gerovault.invite.qr.waitingNext') }}</p>
      </section>

      <div class="invite-qr__actions">
        <button type="button" class="invite-qr__link t-caption" data-test="invite-qr-by-name" @click="close()">{{ $t('gerovault.invite.qr.byName') }}</button>
        <GButton tier="primary" data-test="invite-qr-done" @click="close()">{{ $t('common.done') }}</GButton>
      </div>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import GNote from '@/shared/components/GNote.vue';
import { displayLabel } from '@/shared/gerovault';
import { drawVerificationQr } from '@/modules/gerovault/create/verificationQr';
import type { CreateVaultFlow } from '@/modules/gerovault/create/useCreateVault';
import type { LinkAnswer } from './inviteClient';
import InviteBusyNote from './InviteBusyNote.vue';
import { countdown } from './inviteTime';
import { inviteProblemKey } from './messages';

/**
 * Invite in person (canvas "Invite in person"): a one-time QR the cosigner scans with Gero. Each
 * scan that leads to an ACCEPT fills one card, the dialog names who joined and a new code replaces
 * it (UX rule 9). A code lives ten minutes and is replaced when it runs out.
 *
 * Unlike the canvas, a scan does not verify: GV-61 amendment 2 is undecided, so whoever joined here
 * is Unverified until the number is read together.
 */
const props = defineProps<{ isOpen: boolean; flow: CreateVaultFlow; network: string }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const setup = computed(() => props.flow.setup.value);
const setupName = computed(() => setup.value?.name ?? '');
const threshold = computed(() => setup.value?.threshold ?? 0);
const owners = computed(() => setup.value?.owners ?? 0);
const full = computed(() => !!setup.value && setup.value.slots.every(s => s.status === 'accepted'));

const current = ref<LinkAnswer | null>(null);
const loading = ref(false);
const problem = ref<string | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const now = ref(Date.now());
const joined = ref<{ n: number; label: string }[]>([]);
let baseline = new Set<number>();
let ticker: ReturnType<typeof setInterval> | undefined;

async function draw(): Promise<void> {
  await nextTick();
  if (!canvas.value || !current.value) return;
  try {
    await drawVerificationQr(canvas.value, current.value.payload, 220);
  } catch {
    // The text alternative stays on screen.
  }
}

async function freshCode(): Promise<void> {
  if (loading.value || full.value) return;
  loading.value = true;
  problem.value = null;
  try {
    const answer = await props.flow.makeLink('qr');
    if (answer) {
      current.value = answer;
      await draw();
    } else {
      problem.value = props.flow.inviteProblem.value?.code ?? 'SERVER';
    }
  } finally {
    loading.value = false;
  }
}

function start(): void {
  baseline = new Set((setup.value?.slots ?? []).filter(s => s.status === 'accepted').map(s => s.n));
  joined.value = [];
  current.value = null;
  void freshCode();
  ticker = setInterval(() => {
    now.value = Date.now();
    if (current.value && now.value >= current.value.expiresAt) void freshCode();
  }, 1000);
  // While the code is on screen the flow's own poll runs faster for a while (one scan, one card).
  // It is the same poll, so it pauses with the page and waits out a rate limit; the push
  // (`vault_response`) is what shows a join at once.
  props.flow.setFastPoll(true);
}

function stop(): void {
  clearInterval(ticker);
  props.flow.setFastPoll(false);
  const open = current.value;
  current.value = null;
  // The code on screen is withdrawn: nobody can use it after the dialog closed.
  if (open) void props.flow.withdrawLink(open.joinTokenHash);
}

// Someone joined from the code on screen: name them, and show a new code.
watch(setup, next => {
  if (!props.isOpen || !next) return;
  const used = current.value && next.links.find(l => l.joinTokenHash === current.value!.joinTokenHash)?.state !== 'open';
  for (const s of next.slots) {
    if (s.status === 'accepted' && s.accept && s.accept.via === 'qr' && !baseline.has(s.n)) {
      baseline.add(s.n);
      joined.value = [...joined.value, { n: s.n, label: s.accept.label }];
    }
  }
  if (used && !loading.value) void freshCode();
});

watch(() => props.isOpen, open => (open ? start() : stop()), { immediate: true });
onBeforeUnmount(stop);

function close(): void {
  emit('close');
}
</script>

<style scoped>
.invite-qr {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding-top: var(--g-s-2);
}
.invite-qr p {
  margin: 0;
}
.invite-qr__vault {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  padding: var(--g-s-3);
  border-radius: var(--g-r-card);
}
.invite-qr__code {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--g-s-2);
  margin: 0;
}
.invite-qr__canvas {
  width: 220px;
  height: 220px;
  border-radius: var(--g-r-control);
}
.invite-qr__skeleton {
  height: 220px;
}
.invite-qr__alt {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}
.invite-qr__url {
  display: flex;
  align-items: center;
  gap: var(--g-s-1);
  overflow-wrap: anywhere;
}
.invite-qr__joined ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.invite-qr__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
}
.invite-qr__link {
  padding: 0;
  color: var(--g-accent);
  cursor: pointer;
}
</style>
