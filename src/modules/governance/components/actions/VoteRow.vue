<template>
  <div class="vote-row" :class="{ 'vote-row--yours': isYours }">
    <DRepAvatar class="vote-row__avatar" :image-url="imageUrl" :name="name" :size="24" />

    <span class="t-caption vote-row__role">{{ roleLabel }}</span>

    <!-- One line, not two: the id sits to the RIGHT of the name instead of
         under it, which is what lets the row be this short. -->
    <div class="vote-row__identity">
      <!-- A published name only. No name means the id is promoted to the name
           slot rather than a placeholder standing in for an identity — and then
           it is NOT repeated as a trailing id. -->
      <button
        v-if="name && route"
        type="button"
        class="t-body-sm vote-row__name vote-row__name--link"
        @click="openVoter()"
      >
        {{ name }}
      </button>
      <span v-else-if="name" class="t-body-sm vote-row__name">{{ name }}</span>
      <span v-else class="t-body-sm g-mono vote-row__name" :title="fullId">{{ shortId }}</span>

      <!-- Truncated on screen, whole on hover, and selectable either way: the
           id can still be read and copied out of a row this short. -->
      <span v-if="name" class="t-caption g-mono vote-row__id" :title="fullId">{{ shortId }}</span>

      <span v-if="isYours" class="t-caption vote-row__chip vote-row__chip--yours">
        {{ $t('governance.yours') }}
      </span>
      <span
        v-if="row.hasScript"
        class="t-caption vote-row__chip"
        :title="$t('governance.scriptVoterHint')"
      >
        {{ $t('governance.scriptVoter') }}
      </span>
    </div>

    <span class="t-caption vote-row__pill" :class="`vote-row__pill--${toneClass}`">
      {{ voteLabel }}
    </span>

    <!-- Absent block time renders nothing at all: no dash, no epoch-0 date.
         The date is bare on screen but reads as "Voted <date>" to a screen
         reader, through real text rather than an `aria-label` on a plain span,
         which has no role to carry one and is simply dropped. -->
    <time v-if="votedOn" class="t-caption g-num vote-row__when" :datetime="votedOnIso">
      <span aria-hidden="true">{{ votedOn }}</span>
      <span class="vote-row__sr-only">{{ votedOnLabel }}</span>
    </time>

    <!-- A button, not a link: the rationale opens in-app, fetched and
         hash-checked by RationaleDialog, which also handles ipfs:// through the
         proxy — so every published rationale gets the affordance. -->
    <button
      v-if="row.hasRationale"
      type="button"
      class="t-caption vote-row__rationale"
      @click="emit('rationale', row)"
    >
      {{ $t('governance.readWhy') }}
      <v-icon x-small class="ml-1">mdi-message-text-outline</v-icon>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PropType } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import filters from '@/shared/utils/filters';
import type { PositionRow } from '@/modules/governance/components/actions/positions';
import DRepAvatar from '@/modules/governance/components/dreps/DRepAvatar.vue';

// Runtime declarations with PropType casts: a type-only `X | null` union
// compiles to a validator containing null and warns on every render.
const props = defineProps({
  row: { type: Object as PropType<PositionRow>, required: true },
  /** The voter's published name, or null when they have not published one. */
  name: { type: String as PropType<string | null>, default: null },
  /** The voter's published avatar, resolved by the name index; null renders the initial. */
  imageUrl: { type: String as PropType<string | null>, default: null },
  isYours: { type: Boolean, default: false },
  /** Route to this voter's profile, or null when none resolves. */
  route: { type: Object as PropType<Record<string, unknown> | null>, default: null },
});

const emit = defineEmits<{
  (e: 'open', route: Record<string, unknown>): void;
  (e: 'rationale', row: PositionRow): void;
}>();

const { t } = useTranslation();

const shortId = computed(() => filters.truncate(props.row.id) || String(t('common.notAvailable')));

/** The whole id for the hover title; undefined drops the attribute entirely. */
const fullId = computed(() => props.row.id || undefined);

const roleLabel = computed(() => {
  const key = {
    DRep: 'governance.dRep',
    SPO: 'governance.spo',
    // The full "Constitutional Committee" does not fit a role chip.
    ConstitutionalCommittee: 'governance.roleCommittee',
  }[props.row.role];
  // An unrecognised role falls through to the raw upstream token rather than
  // being dropped or relabelled.
  return key ? String(t(key)) : props.row.role;
});

const voteLabel = computed(() => {
  const key = {
    Yes: 'governance.voteChoice.yes',
    No: 'governance.voteChoice.no',
    Abstain: 'governance.voteChoice.abstain',
  }[props.row.vote];
  return key ? String(t(key)) : props.row.vote || String(t('governance.voteChoice.unknown'));
});

/** An unknown choice gets no tone, so it inherits default colour rather than implying one. */
const toneClass = computed(() =>
  ({ Yes: 'yes', No: 'no', Abstain: 'abstain' }[props.row.vote] ?? 'unknown'),
);

const votedOn = computed(() => {
  if (props.row.votedAt === null) return '';
  return new Date(props.row.votedAt * 1000).toLocaleDateString();
});

/** Machine-readable date for `<time datetime>`; empty when there is no block time. */
const votedOnIso = computed(() => {
  if (props.row.votedAt === null) return '';
  return new Date(props.row.votedAt * 1000).toISOString().slice(0, 10);
});

const votedOnLabel = computed(() =>
  votedOn.value ? String(t('governance.votedOn', { date: votedOn.value })) : '',
);

function openVoter(): void {
  if (props.route) emit('open', props.route);
}
</script>

<style scoped lang="scss">
/* Slim density: one line of content, the table row height rather than the panel
   one, and 4px of vertical padding. Both controls keep their own 24px floors
   (pinned in VoteRow.spec.ts), so the row can shrink without the targets doing
   the same. */
.vote-row {
  @include g-glass-tier(false);
  display: grid;
  grid-template-columns: auto 84px minmax(0, 1fr) auto auto auto;
  align-items: center;
  gap: var(--g-s-3);
  min-height: var(--g-row-h-table);
  padding: var(--g-s-1) var(--g-s-3);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
}
/* Your own representative's row keeps its accent, and the "Yours" chip beside
   the name keeps saying so in words — the border is never the only cue. */
.vote-row--yours {
  border-color: var(--g-accent);
}
/* Placeholder for the voter's picture. Reserves the column so every row's name
   starts on the same x whether or not a DRep has published an image. */
.vote-row__avatar {
  width: 24px;
  height: 24px;
  border-radius: var(--g-r-pill);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
}
.vote-row__role {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 var(--g-s-2);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-chip);
  color: var(--g-text-3);
  white-space: nowrap;
}
.vote-row__identity {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  min-width: 0;
}
.vote-row__name {
  color: var(--g-text-1);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 24px floor on both row controls (WCAG 2.2 target size, minimum). The label is
   wider than that on its own; the height is what a text link lacks. */
.vote-row__name--link {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  background: none;
  border: none;
  padding: 0;
  text-align: left;
  cursor: pointer;
}
.vote-row__name--link:hover {
  color: var(--g-accent);
}
/* The id gives up its width before the name does: it is the recogniser of last
   resort, and the name is what the reader is scanning for. Still selectable
   text, so it can be copied straight out of the row. */
.vote-row__id {
  flex: 0 1 auto;
  min-width: 0;
  color: var(--g-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vote-row__chip {
  flex: none;
  padding: 0 var(--g-s-2);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-chip);
  color: var(--g-text-3);
  white-space: nowrap;
}
.vote-row__chip--yours {
  color: var(--g-accent);
  border-color: var(--g-accent);
}
.vote-row__pill {
  display: inline-flex;
  align-items: center;
  padding: 0 var(--g-s-2);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-chip);
  color: var(--g-text-3);
  white-space: nowrap;
}
.vote-row__pill--yes {
  color: var(--g-success);
  background: var(--g-success-fill);
  border-color: var(--g-success-line);
}
.vote-row__pill--no {
  color: var(--g-error);
  background: var(--g-error-fill);
  border-color: var(--g-error-line);
}
.vote-row__pill--abstain {
  color: var(--g-text-2);
  background: var(--g-overlay);
}
.vote-row__when {
  color: var(--g-text-3);
  white-space: nowrap;
}
.vote-row__rationale {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  min-width: 24px;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: var(--g-accent);
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
}
.vote-row__rationale:hover {
  text-decoration: underline;
}
/* Text for assistive tech only. The visible date is short by design; the full
   sentence lives here rather than in an attribute nothing reads. */
.vote-row__sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
/* Side panel and popup: the identity line and the choice stay together on the
   first row; the date and the rationale link each take a full row below. */
@media (max-width: 720px) {
  .vote-row {
    grid-template-columns: auto auto minmax(0, 1fr) auto;
    row-gap: var(--g-s-1);
  }
  .vote-row__when,
  .vote-row__rationale {
    grid-column: 1 / -1;
  }
}
</style>
