<template>
  <div class="positions">
    <ErrorState
      v-if="error"
      :message="$t('governance.positionsLoadFailed')"
      retryable
      @retry="$emit('retry')"
    />

    <template v-else-if="loading && !rows.length">
      <v-skeleton-loader v-for="n in 6" :key="n" type="list-item-two-line" />
    </template>

    <!-- Three different facts, three different reads. "No votes recorded yet" is
         a claim about the ACTION, so it may only be made once a fetch has
         actually come back: an empty list that was never fetched says nothing
         about who voted. -->
    <template v-else-if="!rows.length && !loaded">
      <EmptyState icon="mdi-cloud-download-outline" :message="$t('governance.positionsNotLoaded')" />
      <div class="positions__more">
        <GButton tier="tertiary" compact @click="$emit('retry')">
          {{ $t('governance.loadPositions') }}
        </GButton>
      </div>
    </template>

    <template v-else-if="!rows.length">
      <EmptyState icon="mdi-vote-outline" :message="$t('governance.noVotesYet')" />
      <p v-if="actionOpen" class="t-caption positions__note">{{ $t('governance.noVotesYetOpen') }}</p>
    </template>

    <template v-else>
      <!-- Head counts, never a bar. The only tally bar on this screen is the
           stake-weighted one on the Overview tab; a second three-segment strip
           built from head counts would read as a competing tally, and head
           counts are not what ratifies an action. -->
      <section class="positions__summary glass-panel">
        <span class="t-label positions__eyebrow">{{ $t('governance.positionsTitle') }}</span>
        <div class="positions__tiles">
          <div v-for="tile in tiles" :key="tile.choice" class="positions__tile">
            <span class="t-label">{{ tile.label }}</span>
            <span class="t-title g-num" :class="`positions__count--${tile.tone}`">{{ tile.count }}</span>
          </div>
        </div>
        <p class="t-caption positions__note">{{ $t('governance.positionsCountsNote') }}</p>
        <p v-if="roleSplit" class="t-caption positions__note">{{ roleSplit }}</p>
        <p v-if="summary.withRationale" class="t-caption positions__note">
          {{ $t('governance.rationaleCoverage', { n: summary.withRationale, total: summary.total }) }}
        </p>
        <!-- Upstream does not always count, and "of ." is not a sentence. -->
        <p v-if="truncated" class="t-caption positions__note positions__note--warn">
          {{
            total === null
              ? $t('governance.positionsCappedUnknownTotal', { n: summary.total })
              : $t('governance.positionsCapped', { n: summary.total, total: total })
          }}
        </p>
      </section>

      <YourPositionCard v-if="yourCard" :position="yourCard" :name="yourName" />
      <p v-else class="t-caption positions__note">{{ noPositionNote }}</p>

      <!-- Nothing to filter under a dozen rows, so no chrome for it. -->
      <div v-if="rows.length >= CONTROLS_MIN_ROWS" class="positions__controls">
        <v-text-field
          v-model="search"
          dense
          outlined
          hide-details
          clearable
          prepend-inner-icon="mdi-magnify"
          class="positions__search"
          :placeholder="$t('governance.searchVoters')"
        />

        <div class="positions__filter">
          <span class="t-label">{{ $t('governance.filterByBody') }}</span>
          <v-chip-group v-model="roleFilter" mandatory>
            <v-chip
              v-for="option in roleOptions"
              :key="option.value"
              :value="option.value"
              :disabled="option.count === 0"
              small
              outlined
            >
              {{ option.label }}
              <span class="g-num ml-1">{{ option.count }}</span>
            </v-chip>
          </v-chip-group>
        </div>

        <div class="positions__filter">
          <span class="t-label">{{ $t('governance.filterByChoice') }}</span>
          <v-chip-group v-model="choiceFilter" mandatory>
            <v-chip
              v-for="option in choiceOptions"
              :key="option.value"
              :value="option.value"
              :disabled="option.count === 0"
              small
              outlined
            >
              {{ option.label }}
              <span class="g-num ml-1">{{ option.count }}</span>
            </v-chip>
          </v-chip-group>
        </div>

        <!-- Hidden entirely when the projection carries no rationale anchors.
             A real <button> with aria-pressed, not a lone chip: outside a
             v-chip-group a chip renders a <span> with a click handler, which no
             keyboard and no screen reader can operate. -->
        <button
          v-if="summary.withRationale"
          type="button"
          class="t-label positions__toggle"
          :class="{ 'positions__toggle--on': rationaleOnly }"
          :aria-pressed="rationaleOnly ? 'true' : 'false'"
          @click="rationaleOnly = !rationaleOnly"
        >
          {{ $t('governance.filterWithRationale') }}
        </button>

        <!-- Hidden when no row carries a block time: nothing to reorder by. -->
        <div v-if="summary.anyVotedAt" class="positions__filter">
          <span class="t-label">{{ $t('governance.sortBy') }}</span>
          <v-chip-group v-model="sort" mandatory>
            <v-chip value="newest" small outlined>{{ $t('governance.sortNewest') }}</v-chip>
            <v-chip value="oldest" small outlined>{{ $t('governance.sortOldest') }}</v-chip>
          </v-chip-group>
        </div>

        <GButton v-if="filtersActive" tier="tertiary" compact @click="clearFilters()">
          {{ $t('common.clearFilters') }}
        </GButton>
      </div>

      <template v-if="!visibleRows.length">
        <EmptyState icon="mdi-filter-remove-outline" :message="$t('governance.noPositionsMatch')" />
        <div class="positions__more">
          <GButton tier="tertiary" compact @click="clearFilters()">
            {{ $t('common.clearFilters') }}
          </GButton>
        </div>
      </template>

      <template v-else>
        <div class="positions__list">
          <VoteRow
            v-for="row in visibleRows"
            :key="row.key"
            :row="row"
            :name="nameOf(row)"
            :image-url="imageOf(row)"
            :is-yours="isYourRow(row, identity)"
            :route="routeFor(row)"
            @open="openVoter"
            @rationale="openRationale"
          />
        </div>

        <div v-if="hiddenCount" class="positions__more">
          <GButton tier="tertiary" compact @click="revealMore()">
            {{ $t('governance.showMorePositions', { n: nextRevealCount }) }}
          </GButton>
        </div>

        <p class="t-caption positions__note">
          {{
            total === null
              ? $t('governance.showingPositionsPartial', { shown: visibleRows.length })
              : $t('governance.showingPositions', { shown: visibleRows.length, total: total })
          }}
        </p>
      </template>

      <div class="positions__footnotes">
        <p class="t-caption positions__note">{{ $t('governance.positionsLatestOnly') }}</p>
        <!-- Only where a rationale can actually be OPENED: with every anchor on
             ipfs://, nothing on this tab opens anywhere. -->
        <p v-if="summary.withRationale" class="t-caption positions__note">
          {{ $t('governance.rationaleExternalNote') }}
        </p>
        <!-- The ordering sentence follows the ordering. It used to assert
             "newest first" while the reader had chosen oldest first, and while
             a list with no block times at all cannot be ordered by time. -->
        <p class="t-caption positions__note">{{ orderNote }}</p>
        <p v-if="summary.anyVotedAt && summary.anyMissingVotedAt" class="t-caption positions__note">
          {{ $t('governance.positionsUndatedLast') }}
        </p>
        <p class="t-caption positions__note">{{ $t('governance.positionsNeutrality') }}</p>
      </div>
    </template>

    <!-- Mounted only while open: opening it is what sends the request, and a
         request to an author's host must follow a click, never a render. -->
    <RationaleDialog
      v-if="rationaleRow"
      :is-open="true"
      :url="rationaleRow.rationaleUrl"
      :hash="rationaleRow.rationaleHash"
      :subtitle="rationaleSubtitle"
      @close="rationaleRow = null"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import type { PropType } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import filters from '@/shared/utils/filters';
import GButton from '@/shared/components/GButton/GButton.vue';
import EmptyState from '@/shared/components/feedback/EmptyState.vue';
import ErrorState from '@/shared/components/feedback/ErrorState.vue';
import VoteRow from '@/modules/governance/components/actions/VoteRow.vue';
import RationaleDialog from '@/modules/governance/dialogs/RationaleDialog.vue';
import YourPositionCard from '@/modules/governance/components/actions/YourPositionCard.vue';
import { loadDRepNameIndex } from '@/modules/governance/components/actions/drepNames';
import type { DRepNameIndex } from '@/modules/governance/components/actions/drepNames';
import {
  ROLE_ORDER,
  VOTE_CHOICES,
  committeeNameOf,
  filterPositions,
  isCommitteeRow,
  isYourRow,
  orderNoteKey,
  resolveYourPosition,
  sortPositions,
  summarizePositions,
  toPositionRows,
} from '@/modules/governance/components/actions/positions';
import type { PositionIdentity, PositionRow, PositionSort } from '@/modules/governance/components/actions/positions';
import type { GovVote } from '@/api/governance.types';

const props = defineProps({
  /**
   * Body filter the panel opens with, set by the overview rail's "view votes"
   * buttons. Applied on change so re-clicking a rail button re-filters even
   * when the panel is already mounted; the user can still clear it.
   */
  presetRole: { type: String as PropType<string | null>, default: null },
  votes: { type: Array as PropType<GovVote[]>, default: () => [] },
  /** Upstream's count of ALL positions, or null when it does not count. */
  total: { type: Number as PropType<number | null>, default: null },
  loading: { type: Boolean, default: false },
  /**
   * Has a votes fetch actually come back for this action? Defaults to FALSE
   * on purpose: a caller that cannot answer must not have the panel state that
   * nobody voted.
   */
  loaded: { type: Boolean, default: false },
  error: { type: String as PropType<string | null>, default: null },
  /** True when the page cap stopped the fetch short of `total`. */
  truncated: { type: Boolean, default: false },
  /**
   * Committee credential -> published name, built from the network's committee
   * by `committeeNameIndex`. Empty by default: a caller that has not loaded the
   * committee leaves every committee row on its hash, which is the honest
   * render — it never turns into a placeholder identity.
   */
  committeeNames: {
    type: Map as PropType<ReadonlyMap<string, string>>,
    default: () => new Map<string, string>(),
  },
  identity: { type: Object as PropType<PositionIdentity | null>, default: null },
  /**
   * True while the wallet's own delegation is still unread. A null `identity`
   * then means "we do not know yet", never "you have not delegated".
   */
  identityUnknown: { type: Boolean, default: false },
  actionOpen: { type: Boolean, default: false },
  chain: { type: String, default: '' },
  network: { type: String, default: '' },
});

const emit = defineEmits<{
  (e: 'retry'): void;
  (e: 'open-drep', drepId: string): void;
}>();

const { t } = useTranslation();

/** Below this many rows there is nothing worth filtering. */
const CONTROLS_MIN_ROWS = 12;

/** Rows on screen before the first "show more". */
const PAGE_STEP = 50;

const search = ref('');
const roleFilter = ref('all');

watch(
  () => props.presetRole,
  role => {
    if (role) roleFilter.value = role;
  },
  { immediate: true },
);
const choiceFilter = ref('all');
const rationaleOnly = ref(false);
const sort = ref<PositionSort>('newest');
const visibleCount = ref(PAGE_STEP);

const names = shallowRef<DRepNameIndex>(new Map());

const rows = computed(() => toPositionRows(props.votes));
const summary = computed(() => summarizePositions(rows.value));

/**
 * The voter's published name, from whichever register knows them.
 *
 * Two registers, never crossed: DReps resolve through the directory index keyed
 * on the DRep credential, committee members through the committee index keyed on
 * theirs. A row that neither knows resolves to null and renders its id — no
 * register is consulted on the other's behalf.
 */
function nameOf(row: PositionRow): string | null {
  if (isCommitteeRow(row)) return committeeNameOf(row, props.committeeNames);
  return row.credentialHex ? (names.value.get(row.credentialHex)?.name ?? null) : null;
}

/**
 * The voter's published avatar. DReps only: the committee endpoint carries no
 * image for a member, so a committee row falls to the initial of its resolved
 * name (or the generic glyph) rather than borrowing a picture from anywhere.
 */
function imageOf(row: PositionRow): string | null {
  return row.credentialHex ? (names.value.get(row.credentialHex)?.image ?? null) : null;
}

const filtered = computed(() =>
  sortPositions(
    filterPositions(
      rows.value,
      {
        search: search.value ?? '',
        role: roleFilter.value,
        choice: choiceFilter.value,
        rationaleOnly: rationaleOnly.value,
      },
      nameOf,
    ),
    sort.value,
  ),
);

const visibleRows = computed(() => filtered.value.slice(0, visibleCount.value));
const hiddenCount = computed(() => Math.max(0, filtered.value.length - visibleRows.value.length));
const nextRevealCount = computed(() => Math.min(PAGE_STEP, hiddenCount.value));

const filtersActive = computed(
  () =>
    !!(search.value ?? '').trim() ||
    roleFilter.value !== 'all' ||
    choiceFilter.value !== 'all' ||
    rationaleOnly.value,
);

const tiles = computed(() => [
  { choice: 'Yes', tone: 'yes', label: String(t('governance.voteChoice.yes')), count: summary.value.yes },
  { choice: 'No', tone: 'no', label: String(t('governance.voteChoice.no')), count: summary.value.no },
  {
    choice: 'Abstain',
    tone: 'abstain',
    label: String(t('governance.voteChoice.abstain')),
    count: summary.value.abstain,
  },
]);

function roleLabel(role: string): string {
  const key = {
    DRep: 'governance.dReps',
    SPO: 'governance.spos',
    ConstitutionalCommittee: 'governance.roleCommittee',
  }[role];
  return key ? String(t(key)) : role;
}

/**
 * The per-body split, naming only the bodies that actually have rows. A body
 * with none is OMITTED rather than printed as zero: SPOs cannot vote on a
 * treasury withdrawal at all, and "SPOs 0" would misread ineligibility as
 * abstention.
 */
const roleSplit = computed(() => {
  const parts = summary.value.byRole.map(entry => `${roleLabel(entry.role)} ${entry.count}`);
  return parts.length > 1 ? parts.join(' · ') : '';
});

const roleOptions = computed(() => [
  { value: 'all', label: String(t('common.all')), count: summary.value.total },
  ...ROLE_ORDER.map(role => ({
    value: role as string,
    label: roleLabel(role),
    count: summary.value.byRole.find(entry => entry.role === role)?.count ?? 0,
  })),
]);

const choiceOptions = computed(() => [
  { value: 'all', label: String(t('common.all')), count: summary.value.total },
  ...VOTE_CHOICES.map(choice => ({
    value: choice as string,
    label: String(t(`governance.voteChoice.${choice.toLowerCase()}`)),
    count: { Yes: summary.value.yes, No: summary.value.no, Abstain: summary.value.abstain }[choice],
  })),
]);

/**
 * Resolved against the WHOLE loaded list, never the filtered view: filtering to
 * "No" must not turn "your DRep voted yes" into "your DRep has not voted".
 * `complete` is false when the page cap truncated the fetch, and then absence
 * proves nothing.
 */
const yourPosition = computed(() =>
  resolveYourPosition(rows.value, props.identity, !props.truncated, props.identityUnknown),
);

/** The card renders a POSITION. The two "there is no position" kinds get a line instead. */
const yourCard = computed(() => {
  const position = yourPosition.value;
  return position.kind === 'none' || position.kind === 'identityUnknown' ? null : position;
});

/**
 * "You have not delegated" is a statement about the user, and it is only made
 * once the delegation has been read.
 */
const noPositionNote = computed(() =>
  String(
    yourPosition.value.kind === 'identityUnknown'
      ? t('governance.delegationNotLoaded')
      : t('governance.noDelegationNoPosition'),
  ),
);

const yourName = computed(() =>
  yourPosition.value.kind === 'voted' ? nameOf(yourPosition.value.row) : null,
);

/**
 * How the list is ACTUALLY ordered right now. Undated rows are parked at the
 * end in either direction, so a mixed list discloses that separately rather
 * than letting "newest first" cover rows that carry no time at all.
 */
const orderNote = computed(() => String(t(orderNoteKey(sort.value, summary.value))));

/** Only DReps have a profile route; SPO and committee voters have none here. */
function routeFor(row: PositionRow): Record<string, unknown> | null {
  return row.isDRep && row.drepId ? { drepId: row.drepId } : null;
}

function openVoter(route: Record<string, unknown>): void {
  emit('open-drep', String(route['drepId'] ?? ''));
}

/** The row whose rationale is open, or null. The dialog mounts off this. */
const rationaleRow = ref<PositionRow | null>(null);

/** The voter, named where a name is published and by id otherwise. */
const rationaleSubtitle = computed(() => {
  const row = rationaleRow.value;
  if (!row) return null;
  return nameOf(row) ?? filters.truncate(row.id) ?? row.id;
});

function openRationale(row: PositionRow): void {
  rationaleRow.value = row;
}

function clearFilters(): void {
  search.value = '';
  roleFilter.value = 'all';
  choiceFilter.value = 'all';
  rationaleOnly.value = false;
}

function revealMore(): void {
  visibleCount.value += PAGE_STEP;
}

// A new filter set starts at the top of the list again.
watch([search, roleFilter, choiceFilter, rationaleOnly, sort], () => {
  visibleCount.value = PAGE_STEP;
});

// Names are a courtesy: one directory request, cached per network, and a
// failure simply leaves every row showing its id.
onMounted(async () => {
  if (!props.chain || !props.network) return;
  names.value = await loadDRepNameIndex(props.chain, props.network);
});
</script>

<style scoped>
.positions {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
}
/* Surface, border and radius come from `glass-panel` (liquid-glass.css). */
.positions__summary {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-4);
}
.positions__eyebrow {
  color: var(--g-text-3);
}
.positions__tiles {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--g-s-3);
}
.positions__tile {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  padding: var(--g-s-3) var(--g-s-4);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
}
/* The NUMBER carries the tone, never the tile: a tinted tile would read as an
   outcome rather than as a count of voters. */
.positions__count--yes {
  color: var(--g-success);
}
.positions__count--no {
  color: var(--g-error);
}
.positions__count--abstain {
  color: var(--g-text-2);
}
.positions__note {
  margin: 0;
  color: var(--g-text-3);
}
.positions__note--warn {
  color: var(--g-warning);
}
.positions__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--g-s-3);
}
.positions__search {
  flex: 1 1 220px;
  min-width: 220px;
}
.positions__filter {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}
/* Chip-shaped, but a real button: focusable, Enter/Space operable, and its
   pressed state announced. No outline reset — the baseline focus ring stands. */
.positions__toggle {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 var(--g-s-3);
  background: transparent;
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-chip);
  color: var(--g-text-2);
  cursor: pointer;
  transition: color var(--g-dur-fast) var(--g-ease), border-color var(--g-dur-fast) var(--g-ease);
}
.positions__toggle:hover {
  color: var(--g-text-1);
}
.positions__toggle--on {
  color: var(--g-accent);
  border-color: var(--g-accent);
}
.positions__list {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}
.positions__more {
  display: flex;
  justify-content: center;
}
.positions__footnotes {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}
</style>
