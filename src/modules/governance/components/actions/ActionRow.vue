<template>
  <!-- A concluded action keeps every word it had — the StatusPill still names
       the outcome in text — but drops to a quieter surface and tone so a live
       row wins the scan. Tone is never the ONLY cue: the pill is. -->
  <button
    type="button"
    class="action-row"
    :class="{ 'action-row--concluded': !live }"
    @click="$emit('select', action.govActionId)"
  >
    <div class="action-row__main">
      <div class="action-row__top">
        <span class="action-row__type t-label">{{ typeLabel }}</span>
        <StatusPill :status="action.status" />

        <!-- Lifetime. Whole-epoch arithmetic, so it reads "about N days", and
             it takes the warning tint only once the window is genuinely short. -->
        <span
          v-if="daysLeft !== null"
          class="action-row__chip t-caption g-num"
          :class="{ 'action-row__chip--warn': closingSoon }"
        >
          {{ $t('governance.approxDaysLeft', { n: daysLeft }) }}
        </span>

        <!-- Only rendered once the votes join has actually resolved this action.
             "Not known yet" and "has not voted" are different facts. -->
        <span
          v-if="voteStatus !== 'unknown'"
          class="action-row__chip t-caption"
          :class="voteStatus === 'voted' ? 'action-row__chip--voted' : 'action-row__chip--awaiting'"
        >
          {{ voteLabel }}
        </span>

        <!-- The list DTO carries an anchor URL and hash but no verification
             verdict, so the only anchor fact it can state is the absence of a
             document. Stamping every other row "not verified" would be noise
             about the endpoint, not about the action. -->
        <AnchorBadge v-if="!action.anchorUrl" :has-anchor="false" />

        <span class="action-row__id g-mono t-caption">{{ shortId }}</span>
      </div>
      <div class="action-row__title t-body">{{ title }}</div>
      <!-- The list endpoint carries no tally fields, so the bar only renders
           when a caller supplies a composition (the detail surface does). -->
      <TallyBar
        v-if="composition"
        class="action-row__tally"
        :class="{ 'action-row__tally--quiet': !live }"
        :yes-pct="composition.yesPct"
        :no-pct="composition.noPct"
        :threshold-pct="null"
        :available="composition.available"
      />
    </div>
    <div class="action-row__meta">
      <div v-if="epochsLeft !== null" class="action-row__lifetime">
        <span class="action-row__epochs t-caption g-num">
          {{ $t('governance.epochsRemaining', { n: epochsLeft }) }}
        </span>
        <!-- The rough calendar date the epoch count works out to. The "≈" is
             the whole point: we know the epoch, not the hour inside it, so the
             real close lands on or before this day. An unknown epoch renders
             nothing here rather than today's date. -->
        <span
          v-if="expiresOn"
          class="action-row__expires t-caption"
          :title="$t('governance.approxExpiryHint')"
        >
          {{ $t('governance.approxExpiryDate', { date: expiresOn }) }}
        </span>
      </div>
      <v-icon small class="action-row__chevron">mdi-chevron-right</v-icon>
    </div>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PropType } from 'vue';
import type { GovProposal } from '@/api/governance.types';
import type { Composition } from '@/shared/utils/govTally';
import type { VoterIdentityKind, RowVoteStatus } from '@/stores/governanceActionsStore';
import {
  epochsRemaining,
  daysRemaining,
  approxExpiryDate,
  formatApproxExpiry,
  isOpen,
} from '@/shared/utils/govLifecycle';
import { useTranslation } from '@/shared/composables/useTranslation';
import StatusPill from '@/modules/governance/components/actions/StatusPill.vue';
import TallyBar from '@/modules/governance/components/actions/TallyBar.vue';
import AnchorBadge from '@/modules/governance/components/actions/AnchorBadge.vue';

/** Below this the days-left chip takes the warning tint. */
const CLOSING_SOON_DAYS = 15;

// Runtime declaration — `number | null` / `X | null` type literals compile to
// validators containing null, which is not a constructor and warns on every
// render. See AsOf.vue.
const props = defineProps({
  action: { type: Object as PropType<GovProposal>, required: true },
  currentEpoch: { type: Number as PropType<number | null>, default: null },
  composition: { type: Object as PropType<Composition | null>, default: null },
  voteStatus: { type: String as PropType<RowVoteStatus>, default: 'unknown' },
  yourVote: { type: String as PropType<string | null>, default: null },
  voterKind: { type: String as PropType<VoterIdentityKind | null>, default: null },
});

defineEmits<{ (e: 'select', govActionId: string): void }>();

const { t } = useTranslation();

const typeLabel = computed(() => {
  const key = `governance.actionType.${String(props.action.type ?? '').toLowerCase()}`;
  const translated = String(t(key));
  return translated === key ? String(props.action.type ?? '') : translated;
});

/** Anchor title when present, otherwise the truncated canonical id. */
const title = computed(() => {
  if (props.action.title) return props.action.title;
  const hash = String(props.action.txHash ?? '');
  return `${hash.slice(0, 10)}…#${props.action.index}`;
});

/** Still open to votes. Drives both the lifetime figures and the row's weight. */
const live = computed(() => isOpen(props.action.status));

/** Remaining lifetime — only meaningful while the action is still open. */
const epochsLeft = computed(() => {
  if (!live.value) return null;
  return epochsRemaining(props.currentEpoch, props.action.expiresEpoch);
});

const daysLeft = computed(() => {
  if (!live.value) return null;
  return daysRemaining(props.currentEpoch, props.action.expiresEpoch);
});

/** The same epoch count as a rough calendar day; '' when either epoch is unknown. */
const expiresOn = computed(() => {
  if (!live.value) return '';
  return formatApproxExpiry(approxExpiryDate(props.currentEpoch, props.action.expiresEpoch));
});

const closingSoon = computed(() => daysLeft.value !== null && daysLeft.value <= CLOSING_SOON_DAYS);

/** `7d3722…8d9#0` — enough of the hash to recognise, all of the index. */
const shortId = computed(() => {
  const hash = String(props.action.txHash ?? '');
  const head = hash.slice(0, 6);
  const tail = hash.slice(-3);
  return hash.length > 9 ? `${head}…${tail}#${props.action.index}` : `${hash}#${props.action.index}`;
});

function choiceLabel(vote: string): string {
  const key = { Yes: 'common.yes', No: 'common.no', Abstain: 'governance.abstain' }[vote];
  return key ? String(t(key)) : vote;
}

/**
 * Whose vote this is changes the sentence entirely: a self-DRep wallet has not
 * voted, whereas a delegating wallet's REPRESENTATIVE has not voted, and only
 * one of those is something the reader can fix by voting.
 */
const voteLabel = computed(() => {
  const delegated = props.voterKind === 'delegated';
  if (props.voteStatus === 'voted') {
    const choice = choiceLabel(String(props.yourVote ?? ''));
    return String(t(delegated ? 'governance.yourDRepVotedChoice' : 'governance.youVotedChoice', { vote: choice }));
  }
  return String(t(delegated ? 'governance.yourDRepHasntVoted' : 'governance.youHaventVoted'));
});
</script>

<style scoped>
.action-row {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  width: 100%;
  text-align: left;
  padding: var(--g-s-3) var(--g-s-4);
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
  cursor: pointer;
  transition: border-color var(--g-dur-fast) var(--g-ease), background var(--g-dur-fast) var(--g-ease);
}
.action-row:hover {
  background: var(--g-raised);
  border-color: var(--g-hairline-2);
}
/* Concluded: a flatter surface, a hairline instead of a filled card, and one
   step down the text ramp. Sanctioned tones only — no bespoke alpha — so the
   contrast floor still holds and the row stays fully readable. */
.action-row--concluded {
  background: transparent;
}
.action-row--concluded .action-row__title {
  color: var(--g-text-2);
}
.action-row--concluded .action-row__type,
.action-row--concluded .action-row__id {
  color: var(--g-text-3);
}
/* The bar is decoration next to the pill's words, so it is the one thing that
   may recede without taking a fact with it. */
.action-row__tally--quiet {
  opacity: 0.6;
}
.action-row__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}
.action-row__top {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--g-s-2);
}
.action-row__type {
  color: var(--g-text-3);
}
.action-row__chip {
  display: inline-flex;
  align-items: center;
  padding: 0 var(--g-s-2);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-chip);
  color: var(--g-text-2);
  white-space: nowrap;
}
.action-row__chip--warn {
  color: var(--g-warning);
  border-color: var(--g-warning-line);
  background: var(--g-warning-fill);
}
.action-row__chip--voted {
  color: var(--g-success);
  border-color: var(--g-success-line);
  background: var(--g-success-fill);
}
/* Accent border + accent text, no fill: the accent is chain-dynamic, so there
   is no tinted-fill token to pair with it and inventing one per chain is how
   the palette drifts. */
.action-row__chip--awaiting {
  color: var(--g-accent);
  border-color: var(--g-accent);
}
.action-row__id {
  margin-left: auto;
  color: var(--g-text-3);
  white-space: nowrap;
}
.action-row__title {
  color: var(--g-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.action-row__meta {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  flex-shrink: 0;
}
/* Epoch count over its approximate date, right-aligned against the chevron so
   the two lifetime facts read as one unit rather than two competing figures. */
.action-row__lifetime {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--g-s-1);
  white-space: nowrap;
}
.action-row__epochs {
  color: var(--g-text-2);
}
.action-row__expires {
  color: var(--g-text-3);
}
.action-row__chevron {
  color: var(--g-text-3);
}
</style>
