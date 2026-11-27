<template>
  <article class="glass-panel setup-card" :data-test="`overview-setup-${setup.setupId}`">
    <header class="setup-card__head">
      <div class="setup-card__title">
        <h3 class="t-heading">{{ displayLabel(setup.name) }}</h3>
        <span class="t-caption gvc-faint">{{ $t('gerovault.invite.setup.terms', { threshold: setup.threshold, owners: setup.owners, network: setup.network }) }}</span>
      </div>
      <span class="gvc-chip gvc-chip--wait t-caption">{{ $t('gerovault.invite.setup.settingUp') }}</span>
    </header>

    <ul class="setup-card__people">
      <li class="setup-card__person">
        <span class="t-body-sm">{{ $t('gerovault.invite.setup.you', { name: displayLabel(setup.ownLabel) }) }}</span>
        <span class="gvc-chip gvc-chip--ok t-caption">{{ $t('gerovault.invite.status.accepted') }}</span>
      </li>
      <li v-for="slot in setup.slots" :key="slot.n" class="setup-card__person" :data-test="`overview-slot-${slot.n}`">
        <span class="t-body-sm">
          {{ nameOf(slot) }}
          <span v-if="slot.status === 'waiting' && slot.invite" class="gvc-faint t-caption">
            · {{ $t('gerovault.invite.setup.invitedLeft', { when: rel(timeAgo(slot.invite.sentAt, now)), left: rel(timeLeft(slot.invite.expiresAt, now)) }) }}
          </span>
        </span>
        <span class="setup-card__chips">
          <span class="gvc-chip t-caption" :class="chipClass(slot.status)">{{ $t(`gerovault.invite.status.${slot.status}`) }}</span>
          <span v-if="slot.status === 'accepted'" class="gvc-chip t-caption" :class="slot.verified ? 'gvc-chip--ok' : 'gvc-chip--wait'">
            {{ slot.verified ? $t('gerovault.invite.status.verified') : $t('gerovault.invite.status.unverified') }}
          </span>
        </span>
      </li>
    </ul>

    <p class="t-body-sm gvc-muted" data-test="overview-setup-next">{{ next }}</p>
    <p v-if="setup.refused > 0" class="t-caption gvc-error" role="status">{{ $t('gerovault.invite.setup.refused', { count: setup.refused }) }}</p>
    <p v-for="(d, i) in setup.duplicates ?? []" :key="i" class="t-caption gvc-muted" role="status" data-test="overview-duplicate-join">
      {{ $t('gerovault.invite.setup.duplicate', { name: displayLabel(d.label) }) }}
    </p>
    <p v-if="reminded" class="t-caption gvc-muted" role="status" data-test="overview-reminded">{{ $t('gerovault.invite.card.reminded') }}</p>

    <footer class="setup-card__actions">
      <GButton v-if="firstWaiting" tier="tertiary" compact data-test="overview-remind" @click="emit('remind', firstWaiting.n)">
        {{ $t('gerovault.invite.setup.remindName', { name: nameOf(firstWaiting) }) }}
      </GButton>
      <GButton tier="tertiary" compact data-test="overview-cancel-setup" @click="emit('cancel')">{{ $t('gerovault.invite.setup.cancel') }}</GButton>
      <GButton tier="primary" compact :to="{ name: GEROVAULT_CREATE_ROUTE, query: { setup: setup.setupId } }" data-test="overview-continue">
        {{ $t('gerovault.invite.setup.continue') }}
      </GButton>
    </footer>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { displayLabel } from '@/shared/gerovault';
import { useTranslation } from '@/shared/composables/useTranslation';
import { GEROVAULT_CREATE_ROUTE } from '@/modules/gerovault/gerovaultRoutes';
import { fingerprint } from '@/modules/gerovault/create/createVault';
import type { SetupViewModel, SlotStatus, SlotView } from './inviteClient';
import { timeAgo, timeLeft, type RelativeTime } from './inviteTime';

/**
 * A vault in setup on the Vaults overview (canvas "Vaults overview: Setting up", UX rule 3): each
 * cosigner's status with the same chips as the create screen, the next step, "Remind" for whoever
 * has not joined and "Continue setup", which opens the create screen on this setup.
 */
const props = defineProps<{ setup: SetupViewModel; now: number; /** A reminder for this setup just went out. */ reminded?: boolean }>();
const emit = defineEmits<{ (e: 'remind', n: number): void; (e: 'cancel'): void }>();
const { t } = useTranslation();

const rel = (time: RelativeTime) => t(time.key, { n: time.n });

function nameOf(slot: SlotView): string {
  if (slot.accept) return displayLabel(slot.accept.label);
  if (slot.label) return displayLabel(slot.label);
  if (slot.invite?.handle) return slot.invite.handle;
  return slot.invite ? fingerprint(slot.invite.stakeCredential) : t('gerovault.invite.setup.open', { n: slot.n + 2 });
}

function chipClass(status: SlotStatus): string {
  if (status === 'accepted') return 'gvc-chip--ok';
  if (status === 'waiting') return 'gvc-chip--wait';
  return '';
}

const firstWaiting = computed(() => props.setup.slots.find(s => s.status === 'waiting'));

/** The next step, in the order the setup takes them. */
const next = computed(() => {
  const slots = props.setup.slots;
  const names = (list: readonly SlotView[]) => list.map(nameOf).join(', ');
  const open = slots.filter(s => s.status !== 'accepted' && s.status !== 'waiting');
  const waiting = slots.filter(s => s.status === 'waiting');
  const unverified = slots.filter(s => s.status === 'accepted' && !s.verified);
  if (open.length) return t('gerovault.invite.setup.next.invite', { count: open.length });
  if (waiting.length) return t('gerovault.invite.setup.next.join', { names: names(waiting) });
  if (unverified.length) return t('gerovault.invite.setup.next.verify', { names: names(unverified) });
  return t('gerovault.invite.setup.next.save');
});
</script>

<style scoped>
.setup-card {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-4);
  border-radius: var(--g-r-card);
}
.setup-card p {
  margin: 0;
}
.setup-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--g-s-3);
}
.setup-card__title {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.setup-card__title h3 {
  margin: 0;
}
.setup-card__people {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}
.setup-card__person {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--g-s-2);
  padding: var(--g-s-2) 0;
  border-top: 1px solid var(--g-hairline-1);
}
.setup-card__chips {
  display: inline-flex;
  gap: var(--g-s-1);
}
.setup-card__actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--g-s-2);
}
</style>
