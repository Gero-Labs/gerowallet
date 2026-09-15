<template>
  <div class="drep-directory">
    <!-- Header -->
    <div class="drep-directory__header">
      <div class="drep-directory__intro">
        <span class="t-label">{{ $t('governance.breadcrumbDReps') }}</span>
        <h1 class="t-title">{{ $t('governance.drepDirectoryTitle') }}</h1>
        <p class="t-body drep-directory__subtitle">
          {{
            totalItems === null
              ? $t('governance.drepDirectorySubtitleShort')
              : $t('governance.drepDirectorySubtitle', { n: formatInt(totalItems) })
          }}
        </p>
      </div>
      <v-text-field
        v-model="search"
        dense
        outlined
        hide-details
        clearable
        prepend-inner-icon="mdi-magnify"
        class="drep-directory__search"
        :label="$t('governance.searchDReps')"
        :placeholder="$t('governance.drepSearchPlaceholder')"
        :loading="loading"
      />
    </div>

    <!-- The match CTA stands on its own line, deliberately off the search row.
         Sitting beside the field it read as the field's own submit key; here it
         is plainly a separate offer with its own prompt. -->
    <div class="drep-directory__match">
      <span class="t-body drep-directory__match-prompt">{{ $t('governance.matchPrompt') }}</span>
      <GButton tier="primary" @click="matchOpen = true">
        <v-icon small left>mdi-account-search-outline</v-icon>{{ $t('governance.findMatch') }}
      </GButton>
    </div>

    <ErrorState v-if="error" :message="error" retryable @retry="reload()" />

    <!-- The waiting state is the table, drawn empty. It is built on the SAME grid
         as the real rows (`--drep-cols`, and the same focus-column switch), so
         when the register lands nothing reflows: the ghosts are replaced in
         place instead of the page re-laying itself out under the reader. A
         generic stack of two-line cards did neither, and read as a different
         page that then jumped. -->
    <div v-else-if="loading" class="drep-directory__loading">
      <!-- Ordering by a figure the server cannot sort means loading every DRep
           first. That is a wait worth naming rather than an unexplained delay. -->
      <span v-if="loadingRegister" class="t-caption drep-directory__loading-note" role="status">
        {{ $t('governance.orderingRegister') }}
      </span>
      <div class="drep-directory__rows" aria-hidden="true">
        <div
          v-for="n in 6"
          :key="n"
          class="drep-directory__row drep-directory__row--ghost glass-panel"
          :class="{ 'drep-directory__grid--focus': focusAvailable }"
        >
          <span class="drep-directory__col-name drep-directory__identity">
            <span class="g-skeleton drep-directory__ghost-avatar"></span>
            <span class="drep-directory__identity-text">
              <span class="g-skeleton drep-directory__ghost-line drep-directory__ghost-line--name"></span>
              <span class="g-skeleton drep-directory__ghost-line drep-directory__ghost-line--id"></span>
            </span>
          </span>
          <span v-for="column in columns" :key="column.key" :class="column.cls">
            <span class="g-skeleton drep-directory__ghost-line"></span>
          </span>
          <span class="drep-directory__col-action">
            <span class="g-skeleton drep-directory__ghost-action"></span>
          </span>
        </div>
      </div>
    </div>

    <EmptyState v-else-if="!rows.length" :message="t('governance.noDRepsFound')" />

    <template v-else>
      <div class="drep-directory__table" role="table" :aria-label="String($t('governance.drepDirectoryTitle'))">
        <!-- The one case where a header does NOT reach every page. It is stated
             here, against the sort control itself, because a caveat in the footer
             would be read after the order has already been believed. -->
        <p v-if="!orderSpansRegister" class="t-caption drep-directory__scope-note" role="status">
          <v-icon size="14" color="var(--g-warning)">mdi-alert-outline</v-icon>
          {{ $t('governance.sortPageOnlyNotice') }}
        </p>

        <!-- Column header. The headers ARE the sort control: each sortable one is
             a real button, so it is reachable by keyboard and carries the
             baseline focus ring, and its column announces `aria-sort`. -->
        <div
          class="drep-directory__columns"
          role="row"
          :class="{ 'drep-directory__grid--focus': focusAvailable }"
        >
          <span class="t-label drep-directory__col-name" role="columnheader">{{ $t('governance.dRep') }}</span>
          <span
            v-for="column in columns"
            :key="column.key"
            role="columnheader"
            :class="['t-label', column.cls]"
            :aria-sort="column.sort ? ariaSort(column.sort) : null"
          >
            <button
              v-if="column.sort"
              type="button"
              class="t-label drep-directory__sort"
              :class="{ 'drep-directory__sort--active': sortKey === column.sort }"
              :title="String($t('governance.sortByColumn', { column: $t(column.label) }))"
              @click="toggleSort(column.sort)"
            >
              <span class="drep-directory__sort-text">{{ $t(column.label) }}</span>
              <!-- Always rendered, so the slot is reserved whether this column is
                   the sorted one or not: appearing only when active made the
                   label jump sideways on every sort, and pushed the glyph past
                   the column's own track into its neighbour's header. -->
              <span
                class="drep-directory__sort-glyph"
                :class="{ 'drep-directory__sort-glyph--idle': sortKey !== column.sort }"
                aria-hidden="true"
              >
                {{ sortDir === 'asc' ? '↑' : '↓' }}
              </span>
            </button>
            <template v-else>{{ $t(column.label) }}</template>
          </span>
          <span class="drep-directory__col-action" role="columnheader"></span>
        </div>

        <div class="drep-directory__rows" role="rowgroup">
          <div
            v-for="row in rows"
            :key="row.key"
            role="row"
            class="drep-directory__row glass-panel"
            :class="{ 'drep-directory__grid--focus': focusAvailable }"
          >
            <!-- Identity -->
            <div role="cell" class="drep-directory__col-name drep-directory__identity">
              <!-- Routed through the in-app ipfs proxy: public gateways answer the
                   extension with 403 + CORP, which is why raw urls rendered blank. -->
              <DRepAvatar class="drep-directory__avatar" :image-url="row.image" :name="row.name" :size="36" />
              <span class="drep-directory__identity-text">
                <span class="drep-directory__name-line">
                  <button type="button" class="t-body-lg drep-directory__name" @click="openProfile(row.id)">
                    {{ row.name }}
                  </button>
                  <span
                    v-if="row.status"
                    class="t-caption drep-directory__pill"
                    :class="`drep-directory__pill--${row.status.tone}`"
                  >
                    {{ row.status.label }}
                  </span>
                  <span v-if="row.isCurrent" class="t-caption drep-directory__pill drep-directory__pill--accent">
                    {{ $t('governance.yours') }}
                  </span>
                </span>
                <span class="t-caption g-mono drep-directory__id">{{ truncate(row.id) }}</span>
              </span>
            </div>

            <!-- Participation -->
            <div role="cell" class="drep-directory__col-stat">
              <template v-if="row.stats.participation.pct !== null">
                <span class="t-body-lg g-num">{{ row.stats.participation.pct }}%</span>
                <span class="drep-directory__bar">
                  <span class="drep-directory__bar-fill" :style="{ width: `${row.stats.participation.pct}%` }"></span>
                </span>
              </template>
              <span v-else class="t-caption">{{ $t('governance.pendingStat') }}</span>
            </div>

            <!-- Rationale -->
            <div role="cell" class="drep-directory__col-stat">
              <template v-if="row.stats.rationaleRate.pct !== null">
                <span class="t-body-lg g-num">{{ row.stats.rationaleRate.pct }}%</span>
                <span class="t-caption">{{ $t('governance.writesReasons') }}</span>
              </template>
              <span v-else class="t-caption">{{ $t('governance.pendingStat') }}</span>
            </div>

            <!-- Vote pattern -->
            <div role="cell" class="drep-directory__col-pattern">
              <template v-if="row.stats.votePattern.total > 0">
                <span class="drep-directory__pattern" role="img" :aria-label="row.patternLabel">
                  <span
                    class="drep-directory__pattern--yes"
                    :style="{ width: `${row.stats.votePattern.yesPct}%` }"
                  ></span>
                  <span class="drep-directory__pattern--no" :style="{ width: `${row.stats.votePattern.noPct}%` }"></span>
                  <span
                    class="drep-directory__pattern--abstain"
                    :style="{ width: `${row.stats.votePattern.abstainPct}%` }"
                  ></span>
                </span>
                <span class="t-caption g-num">{{ row.patternLabel }}</span>
              </template>
              <span v-else class="t-caption">{{ $t('governance.noVotesYet') }}</span>
            </div>

            <!-- Focus areas. The whole column is hidden when action types are not
                 loaded: inventing a category from a proposal id is not an option. -->
            <div v-if="focusAvailable" role="cell" class="drep-directory__col-focus">
              <span v-for="area in row.focus" :key="area.type" class="t-caption drep-directory__chip">
                {{ area.label }}
              </span>
            </div>

            <!-- Delegators -->
            <div role="cell" class="drep-directory__col-num">
              <span v-if="row.stats.delegatorCount !== null" class="t-body g-num">
                {{ formatInt(row.stats.delegatorCount) }}
              </span>
              <span v-else class="t-caption">{{ $t('governance.pendingStat') }}</span>
            </div>

            <!-- Last vote -->
            <div role="cell" class="drep-directory__col-num">
              <span v-if="row.lastVote" class="t-body g-num">{{ row.lastVote }}</span>
              <span v-else class="t-caption">{{ $t('governance.noVoteShort') }}</span>
            </div>

            <!-- Voting power -->
            <div role="cell" class="drep-directory__col-power">
              <span class="t-body-lg g-num">{{ row.power }}</span>
              <span v-if="row.inflow" class="t-caption g-num delta-up">{{ row.inflow }}</span>
            </div>

            <!-- Action zone. Separated from the data columns by a hairline so the
                 delegate control reads as an action on the row, not a figure in
                 it. -->
            <div role="cell" class="drep-directory__col-action">
              <GButton
                tier="secondary"
                compact
                :disabled="row.isCurrent"
                :loading="building === row.id"
                @click="onDelegate(row.record)"
              >
                {{ row.isCurrent ? $t('governance.delegated') : $t('governance.delegate') }}
              </GButton>
            </div>
          </div>
        </div>
      </div>

      <!-- Always Abstain and Always No Confidence used to sit here, below 1,682
           rows. They are not DReps and they are not a browsing decision: they
           are how you change YOUR OWN delegation, so they live on My governance
           where that is the subject. The side panel still hands its parked
           choice to this page through `pendingIntent` below — that path has no
           cards and never did. -->

      <!-- Footer -->
      <div class="drep-directory__footer">
        <span class="t-caption">
          {{
            $t(orderSpansRegister ? 'governance.directoryFooter' : 'governance.directoryFooterPageLocal', {
              showing: rows.length,
              total: formatInt(totalItems || 0),
            })
          }}
          ·
          {{
            eligibleCount
              ? $t('governance.statsWindow', { n: eligibleCount })
              : $t('governance.statsWindowPending')
          }}
        </span>
        <AsOf :timestamp="fetchedAt" />
      </div>

      <div v-if="totalPages > 1" class="text-center">
        <v-pagination
          :value="page"
          :length="totalPages"
          :total-visible="5"
          circle
          class="compact-pagination"
          @input="onPage"
        ></v-pagination>
      </div>
    </template>

    <MatchPanel
      :is-open="matchOpen"
      :stats-context="statsContext"
      :seed="shuffleSeed"
      @close="matchOpen = false"
      @delegate="onDelegate"
      @open-profile="openProfile"
    />

    <DRepDelegateDialog
      :isOpen="isDialogOpen"
      :drep="selectedDRep"
      :tx="tx"
      @close="closeDialog()"
    ></DRepDelegateDialog>
  </div>
</template>

<script setup lang="ts">
import '@/shared/styles/compact-pagination.css';
import { computed, onMounted, onUnmounted, ref, watch, getCurrentInstance } from 'vue';
import { useRouter } from 'vue-router/composables';
import blockchainApi from '@/api/blockchain-api';
import { walletStore } from '@/stores/walletStore';
import NetworkStore, { networkStore } from '@/stores/networkStore';
import governanceActionsStore from '@/stores/governanceActionsStore';
import { useTranslation } from '@/shared/composables/useTranslation';
import { delegationHealth } from '@/shared/composables/useDelegationHealth';
import { drepStats, type DRepRecord, type DRepStats, type DRepStatsContext } from '@/shared/utils/drepStats';
import {
  actionTypeResolverFor,
  drepDisplayName,
  eligibleActionIdsFor,
  epochInflow,
} from '@/shared/utils/drepView';
import { drepImageSource } from '@/modules/governance/utils/govAnchor';
import { parseDRepId, sameDRep, toCip129 } from '@/shared/utils/drepId';
import { toLovelace } from '@/shared/utils/lovelace';
import {
  ariaSortFor,
  DEFAULT_SORT,
  nextSort,
  serverSortFor,
  sortDirectory,
  type SortDir,
  type SortKey,
  type SortState,
} from '@/modules/governance/views/drepDirectory.sort';
import { loadDRepRegister } from '@/modules/governance/views/drepRegister';
import { formatInt } from '@/shared/utils/format';
import filters from '@/shared/utils/filters';
import networks from '@/utils/networks';
import { debugLog } from '@/utils/debug';
import snackbar from '@/plugins/snackbar';
import {
  onPendingDRepDelegation,
  takePendingDRepDelegation,
  type PendingDRep,
  type PendingDRepDelegation,
} from '@/shared/utils/pendingDelegation';
import GButton from '@/shared/components/GButton/GButton.vue';
import EmptyState from '@/shared/components/feedback/EmptyState.vue';
import ErrorState from '@/shared/components/feedback/ErrorState.vue';
import AsOf from '@/modules/governance/components/actions/AsOf.vue';
import DRepAvatar from '@/modules/governance/components/dreps/DRepAvatar.vue';
import MatchPanel from '@/modules/governance/components/dreps/MatchPanel.vue';
import DRepDelegateDialog from '@/modules/governance/dialogs/DRepDelegateDialog.vue';
import { useDRepDelegation, type PredefinedDRep } from '@/modules/governance/composables/useDRepDelegation';

/**
 * The DRep directory.
 *
 * The page's job is to let someone judge a representative by their record, so
 * every column is a fact off `/api/dreps` run through `drepStats` — never an
 * opinion. Three neutrality rules shape the code:
 *
 *  - The default order is PARTICIPATION, descending. Voting power is one
 *    sortable column among five and is only ever applied because the user
 *    clicked its header.
 *  - Ordering uses a BigInt comparator for power. Ties break on the DRep
 *    credential, never on power, so a tie can never quietly become a power
 *    ranking.
 *  - A statistic the data cannot support renders as "pending", not as 0, and
 *    sorts LAST in both directions — unknown is not "worst". The focus-area
 *    column disappears entirely when governance actions are not loaded rather
 *    than showing an empty category.
 *
 * Sorting lives on the column headers rather than in a pill row above them: one
 * control instead of two, and the direction is visible where the figures are.
 *
 * EVERY SORT SPANS EVERY PAGE. It used to span the loaded page of 15, which made
 * "Voting power ↓" a claim the control could not honour. Two mechanisms replace
 * that, chosen per column by `SERVER_SORT_BY`:
 *
 *  - Power and delegators go to `/api/dreps` as `sort_by`, and paging then walks
 *    the server's global order. Cost: unchanged.
 *  - Participation, rationale and last-vote cannot be ordered upstream at all, so
 *    the whole register is loaded once (measured: 4 requests, 10.74 MB gzipped,
 *    ~2 s — see `drepRegister.ts`) and paged IN MEMORY. Since the default sort is
 *    participation, this is the arriving path, and it arrives behind a skeleton
 *    that says what it is waiting for.
 *
 * When the register cannot be loaded the page still renders — from one server
 * page, with the order plainly labelled as page-local next to the headers.
 * A header never implies an order the data behind it does not deliver.
 */

interface Column {
  key: string;
  /** i18n key for the header label. */
  label: string;
  /** null for a column that carries no orderable figure. */
  sort: SortKey | null;
  /** Must match the class on the matching row cell — one grid, two elements. */
  cls: string;
}

const PER_PAGE = 15;

const router = useRouter();
const instance = getCurrentInstance();
const { t } = useTranslation();
const { truncate, toCurrency } = filters;

const { selectedDRep, tx, isDialogOpen, building, delegateToDRep, delegateToPredefined, closeDialog } =
  useDRepDelegation();

const records = ref<DRepRecord[]>([]);
const loading = ref(false);
/** True while the whole register is on its way, so the wait can be explained. */
const loadingRegister = ref(false);
/** True when `records` holds the whole matching set, so paging is a local slice. */
const registerLoaded = ref(false);
/**
 * Whether the order on screen covers every page. False only on the degraded
 * fallback, and the UI then says so beside the headers.
 */
const orderSpansRegister = ref(true);
const error = ref<string | null>(null);
const fetchedAt = ref<number | null>(null);
const page = ref(1);
const totalItems = ref<number | null>(null);
/** The server's page count. Only meaningful while the server is doing the paging. */
const serverTotalPages = ref(1);
const search = ref('');
const sortKey = ref<SortKey>(DEFAULT_SORT.key);
const sortDir = ref<SortDir>(DEFAULT_SORT.dir);
const matchOpen = ref(false);

const sortState = computed<SortState>(() => ({ key: sortKey.value, dir: sortDir.value }));

const actionsState = governanceActionsStore.state;
const currentEpoch = computed(() => NetworkStore.getCurrentEpoch());

// ---------------------------------------------------------------------------
// Stats context
// ---------------------------------------------------------------------------

/**
 * Any one `proposal_id` off the loaded page. It decides which literal id form
 * the eligible-action list has to be written in — see `eligibleActionIdsFor`.
 */
const sampleProposalId = computed(() => {
  for (const record of records.value) {
    for (const vote of record?.votes ?? []) {
      if (typeof vote?.proposal_id === 'string' && vote.proposal_id.trim()) return vote.proposal_id.trim();
    }
  }
  return null;
});

const typeResolver = computed(() =>
  actionsState.actions.length ? actionTypeResolverFor(actionsState.actions) : null,
);

const eligibleActionIds = computed(() =>
  actionsState.actions.length ? eligibleActionIdsFor(sampleProposalId.value, actionsState.actions) : null,
);

/** How many actions participation is measured against, or 0 when unknown. */
const eligibleCount = computed(() => eligibleActionIds.value?.length ?? actionsState.actions.length);

const statsContext = computed<DRepStatsContext>(() => ({
  // With ids we get an exact window; without them the bare count is the honest
  // fallback the plan calls for. Never both — the ids win when present.
  eligibleActionIds: eligibleActionIds.value ?? undefined,
  totalEligibleActions: eligibleActionIds.value ? undefined : actionsState.actions.length || undefined,
  typeResolver: typeResolver.value ?? undefined,
}));

const focusAvailable = computed(() => typeResolver.value !== null);

/** Stable within an epoch, different per wallet — see `drepMatch`. */
const shuffleSeed = computed(
  () => `${walletStore.loggedWallet?.stakeAddress ?? ''}:${currentEpoch.value ?? 0}`,
);

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

interface StatusPill {
  tone: 'success' | 'warning' | 'neutral';
  label: string;
}

function statusFor(record: DRepRecord): StatusPill | null {
  const health = delegationHealth(record, {
    currentEpoch: currentEpoch.value,
    activityWindow: (networkStore.epochParams as { dRepInactivityPeriod?: number } | null)?.dRepInactivityPeriod ?? null,
    // Enables the recent-vote veto against a stale indexed expiry.
    nowSec: Math.floor(Date.now() / 1000),
  });
  if (health.retired) return { tone: 'neutral', label: String(t('governance.retired')) };
  if (health.expired) return { tone: 'warning', label: String(t('governance.noLongerCounting')) };
  if (health.inactiveSoon && health.epochsLeft !== null) {
    return { tone: 'warning', label: String(t('governance.inactiveInEpochs', { n: health.epochsLeft })) };
  }
  if (record.active === true) return { tone: 'success', label: String(t('governance.status.active')) };
  return null;
}

interface DirectoryRow {
  key: string;
  id: string;
  name: string;
  image?: string;
  record: DRepRecord;
  stats: DRepStats;
  status: StatusPill | null;
  isCurrent: boolean;
  patternLabel: string;
  focus: { type: string; label: string }[];
  power: string;
  inflow: string | null;
  /** Short local date of the newest vote, or null when there is none. */
  lastVote: string | null;
}

function typeLabel(type: string): string {
  const key = `governance.actionType.${type.toLowerCase()}`;
  const label = String(t(key));
  return label === key ? type : label;
}

function ada(value: bigint): string {
  const wallet = walletStore.loggedWallet;
  return toCurrency(value.toString(), false, 2, networks.resolveCurrencySymbol(wallet?.chain, wallet?.network), '', true);
}

/**
 * `block_time` is unix SECONDS upstream (useDelegationHealth compares it against
 * `nowSec` directly). Rendered short and locale-aware; the column sorts on the
 * raw timestamp, never on this string.
 */
function lastVoteLabel(blockTime: number | null): string | null {
  if (blockTime === null || !Number.isFinite(blockTime)) return null;
  return new Date(blockTime * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * The comparator's view of a DRep: an identity and the figures, nothing else.
 *
 * Split out from `rows` deliberately. Under a client-ordered column this runs
 * over the whole register — 1,682 records on mainnet — every time the stats
 * context changes, and the presentation work below (currency formatting,
 * translated labels, a health check per row) has no business running 1,682 times
 * to render 15 rows.
 */
interface SortableEntry {
  key: string;
  id: string;
  record: DRepRecord;
  stats: DRepStats;
}

const sortable = computed<SortableEntry[]>(() =>
  records.value
    .map(record => {
      const stats = drepStats(record, statsContext.value);
      if (!stats) return null;
      const id = String(record.drep_id ?? '');
      return { key: stats.credentialHex ?? id, id, record, stats } as SortableEntry;
    })
    .filter((entry): entry is SortableEntry => entry !== null),
);

/**
 * Everything loaded, in order.
 *
 * Applied on the server path too, where it is a no-op on the figure itself
 * (`voting_power` and `delegators` order on exactly the fields this comparator
 * reads) but still contributes the BigInt precision and the credential tie-break
 * that the endpoint makes no promise about.
 */
const ordered = computed<SortableEntry[]>(() => sortDirectory(sortable.value, sortState.value));

/**
 * How many pages the pager offers. In register mode it counts the ROWS THAT WILL
 * RENDER, not the records received: a record `drepStats` cannot identify never
 * reaches a row, and counting it would offer a final page that comes up empty.
 */
const totalPages = computed(() =>
  registerLoaded.value
    ? Math.max(1, Math.ceil(ordered.value.length / PER_PAGE))
    : serverTotalPages.value,
);

/**
 * The rows this page shows. In register mode the slice is ours to take, and
 * paging costs nothing; on the server path the server already sliced, and
 * slicing again would empty every page but the first.
 */
const visible = computed<SortableEntry[]>(() =>
  registerLoaded.value
    ? ordered.value.slice((page.value - 1) * PER_PAGE, page.value * PER_PAGE)
    : ordered.value,
);

const rows = computed<DirectoryRow[]>(() =>
  visible.value.map(({ key, id, record, stats }) => {
    const pattern = stats.votePattern;
    const inflow = epochInflow(record.delegators, currentEpoch.value);
    return {
      key,
      id,
      name: drepDisplayName(record) ?? truncate(id),
      image: drepImageSource(record),
      record,
      stats,
      status: statusFor(record),
      isCurrent: sameDRep(id, walletStore.account?.drep_id),
      patternLabel: String(
        t('governance.votePatternSummary', {
          yes: pattern.yesPct ?? 0,
          no: pattern.noPct ?? 0,
          abstain: pattern.abstainPct ?? 0,
        }),
      ),
      // Only the DRep's own top categories; this orders nothing across DReps.
      focus: (stats.focusAreas ?? [])
        .filter(area => area.voted > 0)
        .slice(0, 3)
        .map(area => ({ type: area.type, label: typeLabel(area.type) })),
      power: ada(stats.votingPower),
      inflow: inflow !== null && inflow > 0n ? `+${ada(inflow)}` : null,
      lastVote: lastVoteLabel(stats.lastVoteBlockTime),
    } as DirectoryRow;
  }),
);

/**
 * Header order. The focus column only exists when action types are loaded, and
 * the grid track list is switched by the same condition, so the two cannot
 * drift. Voting power is a column like any other: never the arriving order.
 */
const columns = computed<Column[]>(() => [
  { key: 'participation', label: 'governance.colParticipation', sort: 'participation', cls: 'drep-directory__col-stat' },
  { key: 'rationale', label: 'governance.colRationale', sort: 'rationale', cls: 'drep-directory__col-stat' },
  { key: 'pattern', label: 'governance.colVotePattern', sort: null, cls: 'drep-directory__col-pattern' },
  ...(focusAvailable.value
    ? [{ key: 'focus', label: 'governance.colFocusAreas', sort: null, cls: 'drep-directory__col-focus' } as Column]
    : []),
  { key: 'delegators', label: 'governance.delegators', sort: 'delegators', cls: 'drep-directory__col-num' },
  { key: 'lastVote', label: 'governance.lastVote', sort: 'lastVote', cls: 'drep-directory__col-num' },
  { key: 'power', label: 'governance.votingPower', sort: 'power', cls: 'drep-directory__col-power' },
]);

/** `aria-sort` for one column: only the active one carries a direction. */
function ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
  return ariaSortFor({ key: sortKey.value, dir: sortDir.value }, key);
}

/**
 * Clicking a header. The ordering rule lives in `nextSort`; what changes here is
 * that a new order spans the register, so the fifteen rows on screen are usually
 * no longer the right fifteen.
 *
 * The reload is skipped in exactly one case: the register is already in memory
 * and the new column is one the client orders. Every client-ordered column reads
 * the same records, so re-ordering them is free — a two-second reload to move
 * between Participation and Rationale would be a cost with nothing bought.
 */
function toggleSort(key: SortKey): void {
  const next = nextSort(sortState.value, key);
  const haveRegister = registerLoaded.value;
  sortKey.value = next.key;
  sortDir.value = next.dir;
  if (serverSortFor(next) === null && haveRegister) {
    page.value = 1; // a new order starts at the top
    return;
  }
  void load(1);
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * `/api/dreps` matches `drep_id` literally, and the same DRep can be written
 * three ways. Canonicalise a recognised id to CIP-129 (the form the endpoint
 * returns) so a pasted CIP-105 or raw hex still finds its owner.
 */
function searchTerm(raw: string): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  const parsed = parseDRepId(value);
  if (!parsed || parsed.form === 'keyword') return value;
  return toCip129(parsed.credentialHex, parsed.credentialType) ?? value;
}

/**
 * One page from the server, in whatever order the active column asks for.
 *
 * `serverSortFor` is an allow-list, not a pass-through: `/api/dreps` answers an
 * unrecognised `sort_by` with HTTP 200 and its default order, so forwarding the
 * client's sort key would paint an arbitrary order under a sorted header.
 */
async function fetchServerPage(
  wallet: { chain: string; network: string },
  nextPage: number,
  term: string,
): Promise<void> {
  const response = await blockchainApi.getDRepsPaginated(
    { page: nextPage, per_page: PER_PAGE, search: term, ...(serverSortFor(sortState.value) ?? {}) },
    wallet.chain,
    wallet.network,
  );
  records.value = (response?.items ?? []) as DRepRecord[];
  totalItems.value = response?.meta?.total_items ?? null;
  serverTotalPages.value = Math.max(1, response?.meta?.total_pages ?? 1);
  registerLoaded.value = false;
  fetchedAt.value = Date.now();
}

/**
 * Guards against an out-of-order landing. A register walk takes ~2 s and a server
 * page ~0.3 s, so a sort toggled mid-walk would otherwise let the stale result
 * overwrite the fresh one and leave the headers describing an order that is not
 * on screen.
 */
let loadToken = 0;

async function load(nextPage = 1): Promise<void> {
  const wallet = walletStore.loggedWallet;
  if (!wallet) return;
  const token = (loadToken += 1);
  const serverSorted = serverSortFor(sortState.value) !== null;
  loading.value = true;
  loadingRegister.value = !serverSorted;
  error.value = null;
  page.value = nextPage;
  const term = searchTerm(search.value);

  try {
    if (serverSorted) {
      // The server orders every page, so paging IS the global order.
      await fetchServerPage(wallet, nextPage, term);
      if (token !== loadToken) return;
      orderSpansRegister.value = true;
      return;
    }

    // Nothing upstream can order this column, so hold the whole matching set and
    // page it locally. See `drepRegister.ts` for what that costs and why.
    const register = await loadDRepRegister(wallet.chain, wallet.network, term);
    if (token !== loadToken) return;

    if (register.records.length) {
      records.value = register.records;
      totalItems.value = register.totalItems ?? register.records.length;
      registerLoaded.value = true;
      orderSpansRegister.value = register.complete;
      fetchedAt.value = register.fetchedAt;
      return;
    }

    // The walk delivered nothing. Render one server page rather than an empty
    // directory, and label the order as covering only that page — the header
    // must not imply a reach the data behind it does not have.
    await fetchServerPage(wallet, nextPage, term);
    if (token !== loadToken) return;
    orderSpansRegister.value = false;
  } catch (err) {
    if (token !== loadToken) return;
    debugLog('DRepDirectory: load failed', err);
    error.value = err instanceof Error ? err.message : String(t('errors.unknownError'));
    records.value = [];
  } finally {
    if (token === loadToken) {
      loading.value = false;
      loadingRegister.value = false;
    }
  }
}

function reload(): void {
  void load(page.value);
}

/**
 * Paging. With the register in memory this is a slice, not a request: page 3 is
 * rows 31–45 of the global order. On the server path it is the request it always
 * was, against an order the server is now applying across all of its pages.
 */
function onPage(next: number): void {
  if (registerLoaded.value) {
    page.value = next;
    return;
  }
  void load(next);
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void load(1), 400);
});

function openProfile(drepId: string | null): void {
  if (!drepId) return;
  router.push({ name: 'governanceDRep', params: { drepId } });
}

async function onDelegate(record: DRepRecord): Promise<void> {
  if (sameDRep(record?.drep_id, walletStore.account?.drep_id)) return;
  await delegateToDRep({
    id: String(record?.drep_id ?? ''),
    name: drepDisplayName(record) ?? truncate(String(record?.drep_id ?? '')),
    image: drepImageSource(record),
    delegators: Array.isArray(record?.delegators) ? record.delegators.length : 0,
    votes: Array.isArray(record?.votes) ? record.votes.length : 0,
    voting_power: drepStats(record)?.votingPower ?? 0n,
    hex: record?.hex ?? undefined,
    has_script: record?.has_script ?? false,
    links: record?.metadata?.meta_json?.body?.['references'],
  });
}

// ---------------------------------------------------------------------------
// Deferred delegation intents
// ---------------------------------------------------------------------------

/**
 * Two surfaces hand a delegation to this page rather than building it
 * themselves, and both land in the same queue:
 *
 *  - The side panel has no signing surface for certificates (hardware, PassKey
 *    and Keystone all live in DRepDelegateDialog), so it parks the choice via
 *    `setPendingDRepDelegation` and opens this route.
 *  - A `?choice=` deep link, still honoured for any older surface or bookmark
 *    that carries one. My governance no longer needs it: it signs its own
 *    abstain / no-confidence certificates in place.
 *
 * Neither fires on mount. A tab opened straight from either surface mounts well
 * before its wallet data lands, and building then would hit a null `epochParams`
 * or, worse, mistake a not-yet-loaded account for an unregistered stake key and
 * attach a registration certificate the chain would reject. Both wait on
 * `delegationInputsReady`.
 */
type PendingIntent =
  | { kind: PredefinedDRep }
  | { kind: 'drep'; drep: PendingDRep };

const pendingIntent = ref<PendingIntent | null>(null);

function asChoice(value: unknown): PredefinedDRep | null {
  return value === 'abstain' || value === 'noConfidence' ? value : null;
}

/** Narrow a parked handoff to something this page can act on. */
function asIntent(pending: PendingDRepDelegation): PendingIntent | null {
  if (pending.kind === 'drep') {
    return pending.drep?.id ? { kind: 'drep', drep: pending.drep } : null;
  }
  const choice = asChoice(pending.kind);
  return choice ? { kind: choice } : null;
}

/** Unsubscribe for the storage listener below. */
let stopPendingListener: (() => void) | null = null;

const delegationInputsReady = computed(
  () =>
    !!walletStore.loggedWallet &&
    !walletStore.isSyncing &&
    !!networkStore.epochParams &&
    !!walletStore.keys?.stake?.[0]?.cred &&
    !!walletStore.keys?.payment?.[0]?.address &&
    !!walletStore.utxos,
);

async function runPendingIntent(): Promise<void> {
  const intent = pendingIntent.value;
  if (!intent || !delegationInputsReady.value) return;
  pendingIntent.value = null; // claim it before any await — the watcher can re-fire

  if (intent.kind !== 'drep') {
    await delegateToPredefined(intent.kind);
    return;
  }

  const drep = intent.drep;
  // Re-delegating to the DRep you already have builds a transaction that changes
  // nothing. Arriving from the panel that would look exactly like the bug this
  // handoff exists to fix, so say it out loud instead of silently doing nothing.
  if (sameDRep(drep.id, walletStore.account?.drep_id)) {
    snackbar.setError(String(t('governance.alreadyDelegatedToDRep')));
    return;
  }

  await delegateToDRep({
    id: drep.id,
    name: drep.name,
    image: drep.image,
    delegators: drep.delegators,
    votes: drep.votes,
    // Parked records predate the BigInt precision fix, so this arrives as a
    // string, a number or a bigint. toLovelace normalises all three.
    voting_power: toLovelace(drep.voting_power),
    hex: drep.hex,
    has_script: drep.has_script,
  });
}

watch(delegationInputsReady, () => {
  void runPendingIntent();
});

onMounted(async () => {
  // A `?drep=` deep link from global search pre-fills the search box, exactly
  // as the pre-split surface did.
  const query = instance?.proxy?.$route?.query?.['drep'];
  if (typeof query === 'string' && query) search.value = query;

  // Keep listening for a handoff parked while this tab is already open: the
  // panel focuses an existing dashboard tab sitting on this route, so nothing
  // remounts and onMounted never runs again.
  stopPendingListener = onPendingDRepDelegation(pending => {
    pendingIntent.value = asIntent(pending);
    void runPendingIntent();
  });

  const choice = asChoice(instance?.proxy?.$route?.query?.['choice']);
  if (choice) {
    pendingIntent.value = { kind: choice };
    // Strip the query once claimed. Leaving it would re-open a signing dialog
    // on every refresh or back-navigation to this URL, which the user never
    // asked for a second time.
    router.replace({ name: 'governanceDReps' }).catch(() => undefined);
  } else {
    // Only read the parked handoff when the URL is not already carrying an
    // intent: takePendingDRepDelegation consumes it, and clearing one the user
    // will not see acted on would lose it silently.
    const parked = await takePendingDRepDelegation();
    if (parked) {
      pendingIntent.value = asIntent(parked);
    }
  }
  void runPendingIntent();

  void load(1);

  // Governance actions supply the participation denominator and the action-type
  // resolver. They are optional: without them the page still renders, with
  // "pending" statistics and no focus column. A failure is the actions store's
  // to report, not this page's.
  const network = String(walletStore.loggedWallet?.network ?? '');
  if (network && !actionsState.actions.length) {
    void governanceActionsStore.loadActions(network).catch(() => undefined);
  }
});

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer);
  stopPendingListener?.();
  stopPendingListener = null;
});
</script>

<style scoped>
.drep-directory {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-4);
}
.drep-directory__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--g-s-4);
  flex-wrap: wrap;
}
.drep-directory__intro {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  min-width: 0;
}
.drep-directory__subtitle {
  margin: 0;
  max-width: 62ch;
}
.drep-directory__search {
  width: 300px;
  flex: none;
}
/* The match CTA gets its own line and its own prompt. Beside the search field it
   read as the field's submit button, which is the one thing it must not be. */
.drep-directory__match {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--g-s-3);
  flex-wrap: wrap;
  padding-bottom: var(--g-s-2);
  border-bottom: 1px solid var(--g-hairline-1);
}
.drep-directory__match-prompt {
  color: var(--g-text-2);
}
.drep-directory__table {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  min-width: 0;
}
.drep-directory__loading {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}
.drep-directory__loading-note {
  color: var(--g-text-2);
}
/* Ghost rows sit on the real row grid, so the columns are already in the right
   places when the data replaces them. Slightly recessed, because a placeholder
   that reads as confidently as a value invites the reader to believe it. */
.drep-directory__row--ghost {
  opacity: 0.55;
}
.drep-directory__ghost-avatar {
  width: 36px;
  height: 36px;
  flex: none;
  border-radius: var(--g-r-pill);
}
.drep-directory__ghost-line {
  display: block;
  height: 12px;
  width: 100%;
  max-width: 120px;
}
.drep-directory__ghost-line--name {
  height: 14px;
  max-width: 168px;
}
.drep-directory__ghost-line--id {
  height: 10px;
  max-width: 104px;
}
.drep-directory__ghost-action {
  display: block;
  height: 32px;
  width: 100%;
  border-radius: var(--g-r-control);
}
/* The page-local caveat. Warning-toned because it narrows a claim the control
   otherwise makes, but a line rather than a banner: the data is still good. */
.drep-directory__scope-note {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  margin: 0;
  padding: var(--g-s-2) var(--g-s-3);
  border: 1px solid var(--g-warning-line);
  background: var(--g-warning-fill);
  border-radius: var(--g-r-control);
  color: var(--g-text-2);
}
.drep-directory__columns {
  display: grid;
  grid-template-columns: var(--drep-cols);
  align-items: center;
  gap: var(--g-s-3);
  padding: 0 var(--g-s-4);
}
/* A grid item's default `min-width: auto` lets it grow past its track rather
   than fit it, which is how an over-long header ended up drawn on top of the
   next column. */
.drep-directory__columns > * {
  min-width: 0;
}
/* Sortable header. A real button, so the baseline focus ring applies and no
   outline is cleared anywhere in this file. */
.drep-directory__sort {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);
  background: none;
  border: none;
  padding: 0;
  color: inherit;
  cursor: pointer;
  text-align: inherit;
  /* Never wider than the column it labels. */
  max-width: 100%;
  min-width: 0;
}
.drep-directory__sort:hover:not(.drep-directory__sort--active) {
  color: var(--g-text-2);
}
.drep-directory__sort--active {
  color: var(--g-accent);
}
/* A reserved slot, not an inline character: fixed width so the label sits in the
   same place sorted or not, and so the arrow can never widen the header past its
   grid track. */
.drep-directory__sort-glyph {
  line-height: 1;
  flex: none;
  width: 10px;
  text-align: center;
}
.drep-directory__sort-glyph--idle {
  visibility: hidden;
}
.drep-directory__sort-text {
  min-width: 0;
}
/* Right-aligned headers sit over right-aligned figures. */
.drep-directory__col-num,
.drep-directory__col-power {
  text-align: right;
}
.drep-directory__col-num .drep-directory__sort,
.drep-directory__col-power .drep-directory__sort {
  justify-content: flex-end;
  width: 100%;
}
.drep-directory__rows {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}
.drep-directory__row {
  display: grid;
  grid-template-columns: var(--drep-cols);
  align-items: center;
  gap: var(--g-s-3);
  padding: var(--g-s-3) var(--g-s-4);
  border-radius: var(--g-r-card);
}
/* One column definition for the header and the rows, so they cannot drift.
   Every track is fixed or fractional (never `auto`): the header and the rows are
   two separate grids, so an auto track would size differently in each and the
   columns would no longer line up. The focus column only exists when governance
   action types are loaded, so the track list is switched by a class rather than
   inferred from the DOM. */
.drep-directory__columns,
.drep-directory__row {
  --drep-cols: minmax(0, 2.3fr) 124px 100px 116px 76px 76px minmax(0, 1.1fr) 124px;
}
.drep-directory__grid--focus {
  --drep-cols: minmax(0, 2fr) 124px 100px 116px minmax(0, 0.9fr) 76px 76px minmax(0, 1.1fr) 124px;
}
@media (max-width: 1180px) {
  /* The header stops being a grid and becomes the page's sort strip: the
     sortable headers are the only sort control, so they must survive the
     collapse even though the columns they label do not. */
  .drep-directory__columns {
    display: flex;
    flex-wrap: wrap;
    gap: var(--g-s-3);
    padding: 0;
  }
  .drep-directory__columns .drep-directory__col-name,
  .drep-directory__columns .drep-directory__col-pattern,
  .drep-directory__columns .drep-directory__col-focus,
  .drep-directory__columns .drep-directory__col-action {
    display: none;
  }
  .drep-directory__columns .drep-directory__col-num,
  .drep-directory__columns .drep-directory__col-power {
    text-align: left;
    align-items: flex-start;
  }
  .drep-directory__columns .drep-directory__sort {
    width: auto;
    justify-content: flex-start;
  }
  .drep-directory__row,
  .drep-directory__grid--focus {
    --drep-cols: minmax(0, 1fr);
  }
}
.drep-directory__col-stat,
.drep-directory__col-pattern {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  min-width: 0;
}
.drep-directory__col-focus {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-1);
  min-width: 0;
}
.drep-directory__identity {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  min-width: 0;
}
.drep-directory__avatar {
  flex: none;
}
.drep-directory__identity-text {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  min-width: 0;
}
.drep-directory__name-line {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  flex-wrap: wrap;
}
.drep-directory__name {
  background: none;
  border: none;
  padding: 0;
  color: var(--g-text-1);
  cursor: pointer;
  text-align: left;
  max-width: 22ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.drep-directory__name:hover {
  color: var(--g-accent);
}
.drep-directory__id {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.drep-directory__pill {
  display: inline-flex;
  align-items: center;
  padding: 0 var(--g-s-2);
  border-radius: var(--g-r-chip);
  border: 1px solid var(--g-hairline-2);
  color: var(--g-text-3);
}
.drep-directory__pill--success {
  color: var(--g-success);
  background: var(--g-success-fill);
  border-color: var(--g-success-line);
}
.drep-directory__pill--warning {
  color: var(--g-warning);
  background: var(--g-warning-fill);
  border-color: var(--g-warning-line);
}
.drep-directory__pill--accent {
  color: var(--g-accent);
  border-color: var(--g-hairline-3);
}
.drep-directory__bar {
  display: block;
  height: var(--g-s-1);
  border-radius: var(--g-r-pill);
  background: var(--g-raised);
  overflow: hidden;
}
.drep-directory__bar-fill {
  display: block;
  height: 100%;
  background: var(--g-accent);
  transition: width var(--g-dur-base) var(--g-ease);
}
.drep-directory__pattern {
  display: flex;
  height: 6px;
  border-radius: var(--g-r-pill);
  overflow: hidden;
  background: var(--g-raised);
}
.drep-directory__pattern--yes {
  background: var(--g-success);
}
.drep-directory__pattern--no {
  background: var(--g-error);
}
.drep-directory__pattern--abstain {
  background: var(--g-text-3);
}
.drep-directory__chip {
  display: inline-flex;
  align-items: center;
  padding: 0 var(--g-s-2);
  border-radius: var(--g-r-chip);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  color: var(--g-text-2);
}
.drep-directory__col-num,
.drep-directory__col-power {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--g-s-1);
  min-width: 0;
}
/* The action zone. A hairline and its own padding put the delegate control
   visually outside the data columns while keeping it on the row. */
.drep-directory__row .drep-directory__col-action {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  align-self: stretch;
  padding-left: var(--g-s-4);
  border-left: 1px solid var(--g-hairline-1);
}
.drep-directory__footer {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-3);
  padding-top: var(--g-s-3);
  border-top: 1px solid var(--g-hairline-1);
  flex-wrap: wrap;
}
</style>
