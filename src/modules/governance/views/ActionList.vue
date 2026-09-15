<template>
  <div class="action-list">
    <div class="action-list__header">
      <div>
        <h1 class="t-title">{{ $t('governance.actionsTitle') }}</h1>
        <p class="action-list__subtitle t-caption">{{ $t('governance.actionsSubtitle') }}</p>
      </div>
      <div class="action-list__header-side">
        <GButton tier="tertiary" compact @click="goToDReps()">{{ $t('governance.dReps') }}</GButton>
        <AsOf :timestamp="state.fetchedAt" />
      </div>
    </div>

    <!-- Stat strip. Every figure describes the LOADED page, never the chain as a
         whole: the list endpoint is server-paginated and carries no aggregates. -->
    <div v-if="!state.error" class="action-list__stats">
      <div class="action-list__stat glass-panel">
        <span class="t-label">{{ $t('governance.stats.open') }}</span>
        <span v-if="state.loading" class="action-list__stat-value t-heading">{{ $t('common.notAvailable') }}</span>
        <span v-else class="action-list__stat-value t-heading g-num">{{ openCount }}</span>
      </div>

      <div class="action-list__stat action-list__stat--you glass-panel">
        <span class="t-label action-list__stat-label--accent">{{ awaitingLabel }}</span>
        <span class="action-list__stat-value t-heading" :class="{ 'g-num': awaitingCount !== null }">
          {{ awaitingCount === null ? $t('common.notAvailable') : awaitingCount }}
        </span>
        <span v-if="awaitingNote" class="action-list__stat-note t-caption">{{ awaitingNote }}</span>
      </div>

      <div class="action-list__stat glass-panel">
        <span class="t-label">{{ $t('governance.stats.closingWithin', { n: CLOSING_SOON_DAYS }) }}</span>
        <span v-if="state.loading" class="action-list__stat-value t-heading">{{ $t('common.notAvailable') }}</span>
        <span v-else class="action-list__stat-value t-heading g-num">{{ closingSoonCount }}</span>
      </div>

      <div class="action-list__stat glass-panel">
        <span class="t-label">{{ $t('governance.stats.decided') }}</span>
        <span v-if="state.loading" class="action-list__stat-value t-heading">{{ $t('common.notAvailable') }}</span>
        <span v-else class="action-list__stat-value t-heading g-num">{{ decidedCount }}</span>
        <span class="action-list__stat-note t-caption">{{ $t('governance.stats.decidedNote') }}</span>
      </div>
    </div>

    <div class="action-list__filters">
      <div class="action-list__filter-group">
        <span class="t-label action-list__filter-label">{{ $t('common.type') }}</span>
        <v-chip-group :value="state.filters.type" column @change="onTypeFilter">
          <v-chip :value="null" small outlined>{{ $t('common.all') }}</v-chip>
          <v-chip v-for="ty in ACTION_TYPES" :key="ty" :value="ty" small outlined>{{ typeLabel(ty) }}</v-chip>
        </v-chip-group>
      </div>
      <div class="action-list__filter-group">
        <span class="t-label action-list__filter-label">{{ $t('governance.status') }}</span>
        <v-chip-group :value="state.filters.status" column @change="onStatusFilter">
          <v-chip :value="null" small outlined>{{ $t('common.all') }}</v-chip>
          <v-chip v-for="st in ACTION_STATUSES" :key="st" :value="st" small outlined>{{ statusLabel(st) }}</v-chip>
        </v-chip-group>
      </div>
    </div>

    <ErrorState v-if="state.error" :message="state.error" retryable @retry="reload()" />

    <div v-else-if="state.loading" class="action-list__rows">
      <v-skeleton-loader v-for="n in 6" :key="n" type="list-item-two-line" />
    </div>

    <EmptyState v-else-if="!state.actions.length" :message="$t('governance.noGovernanceProposals')" />

    <div v-else class="action-list__rows">
      <div v-for="action in orderedActions" :key="action.govActionId" class="action-list__row">
        <!-- Batch selection: only for actions still open to votes, and only when
             this wallet is a registered DRep whose type can batch-sign. -->
        <label v-if="selectable && isActionOpen(action)" class="action-list__select">
          <input
            type="checkbox"
            class="action-list__checkbox"
            :checked="selected.includes(action.govActionId)"
            :aria-label="$t('governance.selectForVoting')"
            @change="toggleSelect(action.govActionId)"
          />
        </label>
        <ActionRow
          class="action-list__row-item"
          :action="action"
          :current-epoch="currentEpoch"
          :vote-status="rowVoteStatus(action)"
          :your-vote="state.yourVotes.byAction[action.govActionId] || null"
          :voter-kind="state.yourVotes.identityKind"
          @select="openAction"
        />
      </div>
    </div>

    <!-- The order is stated because it is only ever the order of THIS page: the
         endpoint paginates server-side, so the soonest expiry on screen need
         not be the soonest on chain. -->
    <p v-if="!state.error && !state.loading && state.actions.length" class="action-list__note t-caption">
      {{ $t('governance.actionsOrderNote') }}
    </p>

    <div v-if="totalPages > 1" class="text-center">
      <v-pagination
        :value="state.page"
        :length="totalPages"
        :total-visible="5"
        circle
        class="compact-pagination"
        @input="onPage"
      ></v-pagination>
    </div>

    <div v-if="selected.length" class="action-list__batch-bar">
      <span class="t-body-2 g-num">{{ $t('governance.selectedCount', { n: selected.length }) }}</span>
      <GButton tier="primary" compact @click="openBatchDialog()">
        {{ $t('governance.voteOnSelected') }}
      </GButton>
    </div>

    <CastVoteDialog
      :is-open="batchDialogOpen"
      :actions="selectedActions"
      @close="batchDialogOpen = false"
      @submitted="clearSelection()"
    />
  </div>
</template>

<script setup lang="ts">
import '@/shared/styles/compact-pagination.css';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router/composables';
import { walletStore } from '@/stores/walletStore';
import NetworkStore from '@/stores/networkStore';
import governanceActionsStore, { awaitingVoteCount } from '@/stores/governanceActionsStore';
import type { VoterIdentity, RowVoteStatus } from '@/stores/governanceActionsStore';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import blockchainApi from '@/api/blockchain-api';
import { parseGovActionId } from '@/shared/utils/govActionId';
import { KEYWORD_DREPS } from '@/shared/utils/drepId';
import { isOpen, daysRemaining } from '@/shared/utils/govLifecycle';
import { useVoting } from '@/shared/composables/useVoting';
import { useTranslation } from '@/shared/composables/useTranslation';
import { debugLog } from '@/utils/debug';
import { orderActions } from '@/modules/governance/components/actions/ordering';
import ActionRow from '@/modules/governance/components/actions/ActionRow.vue';
import AsOf from '@/modules/governance/components/actions/AsOf.vue';
import CastVoteDialog from '@/modules/governance/dialogs/CastVoteDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import EmptyState from '@/shared/components/feedback/EmptyState.vue';
import ErrorState from '@/shared/components/feedback/ErrorState.vue';
import type { GovProposal } from '@/api/governance.types';

/** The seven CIP-1694 action types, as Nexus spells them. */
const ACTION_TYPES = [
  'ParameterChange',
  'HardForkInitiation',
  'TreasuryWithdrawals',
  'NoConfidence',
  'NewCommittee',
  'NewConstitution',
  'InfoAction',
] as const;

const ACTION_STATUSES = ['active', 'ratified', 'enacted', 'expired', 'dropped'] as const;

/** Matches the row chip's warning threshold, and the stat strip's label. */
const CLOSING_SOON_DAYS = 15;

const router = useRouter();
const { t } = useTranslation();

const state = governanceActionsStore.state;

const network = computed(() => String(walletStore.loggedWallet?.network ?? ''));
const currentEpoch = computed(() => NetworkStore.getCurrentEpoch());

const totalPages = computed(() =>
  state.total === null ? 1 : Math.max(1, Math.ceil(state.total / state.pageSize)),
);

/**
 * What the reader is here for goes first: still-open actions, the one closing
 * next at the top. Decided ones keep their place in the list but fall below,
 * newest first. Display-only — it never changes which page was fetched.
 */
const orderedActions = computed(() => orderActions(state.actions));

// ---------------------------------------------------------------------------
// Batch voting selection
// ---------------------------------------------------------------------------

const { capability } = useVoting();

// drep129 is an array like every other key list; watch wallets have an empty
// one — guard it, never index blindly.
const drepId = computed(() => walletStore.keys?.drep129?.[0]?.address ?? '');

/**
 * Whether this wallet's DRep is registered on chain RIGHT NOW. Having a derived
 * DRep key is not registration, and neither is merely having a record: a
 * retired DRep still returns a row, carrying `registered: false`. Loaded once
 * per mount; a lookup failure leaves it false (selection simply stays hidden).
 */
const isRegisteredDrep = ref(false);

/**
 * Registration is looked up for the IDENTITY, not just for batch selection: a
 * registered DRep votes as itself on the stat strip whether or not its wallet
 * type can batch-sign. The flag and capability gates stay on `selectable`.
 */
async function loadDrepRegistration(): Promise<void> {
  if (!drepId.value || !walletStore.loggedWallet) return;
  try {
    const record = await blockchainApi.getDRepById(
      drepId.value,
      walletStore.loggedWallet.chain,
      walletStore.loggedWallet.network,
    );
    // `registered === true`, not `!!record`. A deregistered DRep still has a
    // row, so the presence of one says nothing about whether this wallet can
    // still vote as itself. Note `registered` is retirement and is permanent,
    // whereas `active: false` is only an inactivity expiry — an inactive DRep
    // may still cast votes, which is precisely how it becomes active again, so
    // liveness must NOT gate this.
    //
    // Erring toward false is the cheap direction: a registered DRep misread
    // here just falls through to the delegated branch and gets labelled "your
    // DRep" instead of "you", while a retired one misread as self would be
    // offered batch voting the chain will reject.
    isRegisteredDrep.value = record?.registered === true;
  } catch (error) {
    debugLog('ActionList: DRep registration lookup failed', error);
    isRegisteredDrep.value = false;
  }
}

const selectable = computed(
  () =>
    featureFlagsStore.isGovernanceVotingEnabled() &&
    !!drepId.value &&
    isRegisteredDrep.value &&
    capability.value.canBatch,
);

function isActionOpen(action: GovProposal): boolean {
  return isOpen(action.status);
}

// ---------------------------------------------------------------------------
// Stat strip
// ---------------------------------------------------------------------------

/**
 * Whose votes the board should join against.
 *
 * A wallet that registered as a DRep votes as ITSELF, whatever it delegated —
 * so that case wins. Otherwise the delegated DRep's record is what decides
 * whether this stake has been represented on an action. The two predefined
 * DReps cast no votes at all, so there is nothing to join and no request to
 * make.
 */
const voterIdentity = computed<VoterIdentity | null>(() => {
  if (isRegisteredDrep.value && drepId.value) return { drepId: drepId.value, kind: 'self' };
  const delegated = String(walletStore.account?.drep_id ?? '');
  if (!delegated || (KEYWORD_DREPS as readonly string[]).includes(delegated)) return null;
  return { drepId: delegated, kind: 'delegated' };
});

const openActions = computed(() => state.actions.filter(action => isOpen(action.status)));
const openCount = computed(() => openActions.value.length);

const closingSoonCount = computed(
  () =>
    openActions.value.filter(action => {
      const days = daysRemaining(currentEpoch.value, action.expiresEpoch);
      return days !== null && days <= CLOSING_SOON_DAYS;
    }).length,
);

/**
 * Actions on this page that are no longer open. Deliberately NOT "decided this
 * epoch": the list DTO carries no ratification/enactment/expiry epoch, only a
 * status, so the epoch a decision landed in is not knowable here. The label
 * says what this actually counts.
 */
const decidedCount = computed(() => state.actions.length - openCount.value);

/** null whenever the join could not establish the fact. Never rendered as 0. */
const awaitingCount = computed(() => awaitingVoteCount(state.yourVotes));

const awaitingLabel = computed(() =>
  String(
    t(
      state.yourVotes.identityKind === 'delegated'
        ? 'governance.stats.awaitingYourDRep'
        : 'governance.stats.awaitingYourVote',
    ),
  ),
);

/** The honest footnote under the number, naming exactly why it is what it is. */
const awaitingNote = computed(() => {
  const votes = state.yourVotes;
  if (votes.status === 'idle') return String(t('governance.stats.noVotingIdentity'));
  if (votes.status === 'loading') return String(t('governance.stats.checkingVotes'));
  if (votes.status === 'unavailable') return String(t('governance.stats.voteCheckUnavailable'));
  if (votes.status === 'partial') {
    return String(
      t('governance.stats.votesPartiallyChecked', { checked: votes.resolved.length, total: votes.scanned }),
    );
  }
  // Capped scan: say so rather than implying the number covers every open action.
  if (votes.scanned < openCount.value) {
    return String(t('governance.stats.firstOpenActions', { n: votes.scanned }));
  }
  return '';
});

/**
 * Absence from `resolved` means the join never got an answer for this action,
 * which must not render as "has not voted".
 */
function rowVoteStatus(action: GovProposal): RowVoteStatus {
  const votes = state.yourVotes;
  if (!votes.resolved.includes(action.govActionId)) return 'unknown';
  return votes.byAction[action.govActionId] ? 'voted' : 'awaiting';
}

const selected = ref<string[]>([]);
const batchDialogOpen = ref(false);

const selectedActions = computed(() =>
  state.actions.filter(action => selected.value.includes(action.govActionId)),
);

function toggleSelect(govActionId: string): void {
  selected.value = selected.value.includes(govActionId)
    ? selected.value.filter(id => id !== govActionId)
    : [...selected.value, govActionId];
}

function clearSelection(): void {
  selected.value = [];
  batchDialogOpen.value = false;
}

function openBatchDialog(): void {
  if (selectedActions.value.length) batchDialogOpen.value = true;
}

function typeLabel(type: string): string {
  const key = `governance.actionType.${type.toLowerCase()}`;
  const translated = String(t(key));
  return translated === key ? type : translated;
}

function statusLabel(status: string): string {
  const key = `governance.status.${status.toLowerCase()}`;
  const translated = String(t(key));
  return translated === key ? status : translated;
}

function goToDReps(): void {
  router.push({ name: 'governanceDReps' });
}

/**
 * Resolves once the DRep-registration lookup has settled, so the votes join
 * always runs against a known identity rather than racing it.
 */
let registrationReady: Promise<void> = Promise.resolve();

function reload(page = 1): void {
  // A new page/filter means new rows — a selection kept across it would let
  // "N selected" refer to actions the user can no longer see.
  selected.value = [];
  void (async () => {
    // The list renders as soon as it lands; the per-action votes join follows,
    // since it is an N+1 and must never hold the page back.
    await governanceActionsStore.loadActions(network.value, page);
    await registrationReady;
    await governanceActionsStore.loadYourVotes(network.value, voterIdentity.value);
  })();
}

/** Server-side filtering — the list is server-paginated, never filter locally. */
function onTypeFilter(type: string | undefined | null): void {
  governanceActionsStore.setFilters({ type: type ?? null });
  reload();
}

function onStatusFilter(status: string | undefined | null): void {
  governanceActionsStore.setFilters({ status: status ?? null });
  reload();
}

function onPage(page: number): void {
  reload(page);
}

function openAction(govActionId: string): void {
  const parsed = parseGovActionId(govActionId);
  if (!parsed) return;
  router.push({
    name: 'governanceAction',
    params: { txHash: parsed.txHash, index: String(parsed.index) },
  });
}

onMounted(() => {
  registrationReady = loadDrepRegistration();
  reload();
});
</script>

<style scoped>
.action-list {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-4);
}
.action-list__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-3);
}
.action-list__header-side {
  display: flex;
  align-items: baseline;
  gap: var(--g-s-3);
}
.action-list__subtitle {
  margin: 0;
  color: var(--g-text-3);
}
/* Glass comes from the shared `glass-panel` class (liquid-glass.css), never
   from a locally declared blur. The ratchet counts that property by raw text,
   so naming it here would itself trip the budget. */
.action-list__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--g-s-2);
}
.action-list__stat {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  padding: var(--g-s-3) var(--g-s-4);
}
.action-list__stat--you {
  border-color: var(--g-accent);
}
.action-list__stat-label--accent {
  color: var(--g-accent);
}
.action-list__stat-value {
  color: var(--g-text-1);
}
.action-list__stat-note {
  color: var(--g-text-3);
}
.action-list__filters {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}
.action-list__filter-group {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
}
.action-list__filter-label {
  color: var(--g-text-3);
  flex-shrink: 0;
  min-width: 48px;
}
.action-list__rows {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}
.action-list__row {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}
.action-list__row-item {
  flex: 1;
  min-width: 0;
}
.action-list__note {
  margin: 0;
  color: var(--g-text-3);
}
.action-list__select {
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: var(--g-s-1);
}
.action-list__checkbox {
  width: 16px;
  height: 16px;
  accent-color: var(--g-accent);
  cursor: pointer;
}
.action-list__batch-bar {
  position: sticky;
  bottom: var(--g-s-2);
  z-index: var(--g-z-sticky);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
  padding: var(--g-s-2) var(--g-s-3);
  background: var(--g-overlay);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-card);
}
</style>
