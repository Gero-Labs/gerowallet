<template>
  <div class="drep-profile">
    <div class="drep-profile__crumbs t-caption">
      <GButton tier="tertiary" compact @click="goToDirectory()">{{ $t('governance.dReps') }}</GButton>
    </div>

    <ErrorState v-if="error" :message="error" retryable @retry="load()" />

    <div v-else-if="loading" class="drep-profile__rows">
      <v-skeleton-loader type="list-item-avatar-three-line" />
      <v-skeleton-loader type="table-heading" />
      <v-skeleton-loader type="list-item-two-line@3" />
    </div>

    <EmptyState v-else-if="!record" :message="t('governance.profileNotFound')" icon="mdi-account-question-outline" />

    <template v-else>
      <!-- Header -->
      <div class="drep-profile__header">
        <div class="drep-profile__identity">
          <v-avatar rounded size="56" color="var(--g-raised)" class="drep-profile__avatar">
            <v-img v-if="image" :src="image" contain>
              <template v-slot:error>
                <v-icon size="26" color="var(--g-text-3)">mdi-account</v-icon>
              </template>
            </v-img>
            <v-icon v-else size="26" color="var(--g-text-3)">mdi-account</v-icon>
          </v-avatar>
          <div class="drep-profile__identity-text">
            <div class="drep-profile__title-line">
              <h1 class="t-title">{{ name }}</h1>
              <span v-if="status" class="t-caption drep-profile__pill" :class="`drep-profile__pill--${status.tone}`">
                {{ status.label }}
              </span>
              <!-- Tri-state, and it never says "invalid" for "nobody checked". -->
              <span class="t-caption drep-profile__pill" :class="`drep-profile__pill--${anchorTone}`">
                <v-icon x-small class="drep-profile__pill-icon">{{ anchorIcon }}</v-icon>
                {{ anchorLabel }}
              </span>
            </div>
            <div class="t-caption g-mono drep-profile__id">
              {{ truncate(drepId) }}<CopyButton v-if="drepId" class="ml-1" x-small :value="drepId" />
            </div>
            <p v-if="bio" class="t-body drep-profile__bio">{{ bio }}</p>
          </div>
        </div>
        <div class="drep-profile__cta">
          <GButton
            tier="primary"
            :disabled="isCurrent"
            :loading="building === drepId"
            @click="onDelegate()"
          >
            {{ isCurrent ? $t('governance.delegated') : $t('governance.delegate') }}
          </GButton>
          <span class="t-caption">{{ $t('governance.oneTxChangeAnytime') }}</span>
          <AsOf :timestamp="fetchedAt" />
        </div>
      </div>

      <!-- Stats -->
      <div class="drep-profile__stats">
        <div class="drep-profile__stat glass-panel">
          <span class="t-label">{{ $t('governance.votingPower') }}</span>
          <span class="t-heading g-num">{{ power }}</span>
          <span v-if="inflow" class="t-caption g-num delta-up">{{ inflow }}</span>
        </div>
        <div class="drep-profile__stat glass-panel">
          <span class="t-label">{{ $t('governance.colParticipation') }}</span>
          <span v-if="stats && stats.participation.pct !== null" class="t-heading g-num">
            {{ stats.participation.pct }}%
          </span>
          <span v-else class="t-heading">{{ $t('governance.pendingStat') }}</span>
          <span v-if="stats && stats.participation.state === 'ok'" class="t-caption g-num">
            {{
              $t('governance.participationOf', {
                voted: stats.participation.numerator,
                total: stats.participation.denominator,
              })
            }}
          </span>
          <span v-else class="t-caption">{{ $t('governance.statsWindowPending') }}</span>
        </div>
        <div class="drep-profile__stat glass-panel">
          <span class="t-label">{{ $t('governance.colRationale') }}</span>
          <span v-if="stats && stats.rationaleRate.pct !== null" class="t-heading g-num">
            {{ stats.rationaleRate.pct }}%
          </span>
          <span v-else class="t-heading">{{ $t('governance.pendingStat') }}</span>
          <span class="t-caption g-num">
            {{ $t('governance.writtenRationales', { n: stats ? stats.rationaleRate.numerator : 0 }) }}
          </span>
        </div>
        <div class="drep-profile__stat glass-panel">
          <span class="t-label">{{ $t('governance.delegators') }}</span>
          <span v-if="stats && stats.delegatorCount !== null" class="t-heading g-num">
            {{ formatInt(stats.delegatorCount) }}
          </span>
          <span v-else class="t-heading">{{ $t('governance.pendingStat') }}</span>
        </div>
        <div class="drep-profile__stat glass-panel">
          <span class="t-label">{{ $t('governance.status') }}</span>
          <!-- A stale expiry (health.expiryStale) is withheld, not printed:
               it is provably behind the chain and would misdate the DRep. -->
          <span v-if="record.expires_epoch_no && !health.expiryStale" class="t-heading g-num">
            {{ $t('governance.expiresEpochLabel', { n: record.expires_epoch_no }) }}
          </span>
          <span v-else class="t-heading">{{ $t('governance.pendingStat') }}</span>
          <span v-if="health.epochsLeft !== null" class="t-caption g-num">
            {{ $t('governance.epochsRemaining', { n: health.epochsLeft }) }}
          </span>
        </div>
      </div>

      <div class="drep-profile__body">
        <!-- Voting record -->
        <section class="drep-profile__record glass-panel">
          <div class="drep-profile__record-head">
            <span class="t-label">{{ $t('governance.votingRecord') }}</span>
            <v-chip-group :value="voteFilter" column @change="onVoteFilter">
              <v-chip :value="'all'" small outlined>{{ $t('common.all') }}</v-chip>
              <v-chip :value="'rationale'" small outlined>{{ $t('governance.filterWithRationale') }}</v-chip>
            </v-chip-group>
          </div>

          <EmptyState v-if="!visibleVotes.length" :message="t('governance.noVotesYet')" />

          <div v-else class="drep-profile__votes">
            <div v-for="vote in visibleVotes" :key="vote.key" class="drep-profile__vote">
              <div class="drep-profile__vote-head">
                <span class="t-caption drep-profile__vote-pill" :class="`drep-profile__vote-pill--${vote.tone}`">
                  {{ vote.choiceLabel }}
                </span>
                <!-- The proposal id resolves to a real route only when it parses
                     as a governance action id; otherwise the title stays inert
                     rather than offering a link that would 404. -->
                <button
                  v-if="vote.actionRoute"
                  type="button"
                  class="t-body-sm drep-profile__vote-title drep-profile__vote-link"
                  @click="openAction(vote.actionRoute)"
                >
                  {{ vote.title }}
                </button>
                <span v-else class="t-body-sm drep-profile__vote-title">{{ vote.title }}</span>
                <span class="t-caption drep-profile__vote-meta">{{ vote.meta }}</span>
              </div>
              <!-- Rationale documents are author hosted. The dialog fetches one
                   on click only, hash-checks it, and says how far to trust it. -->
              <button
                v-if="vote.rationaleUrl"
                type="button"
                class="t-caption drep-profile__rationale"
                @click="openRationale(vote)"
              >
                {{ $t('governance.readWhy') }}<v-icon x-small class="ml-1">mdi-message-text-outline</v-icon>
              </button>
            </div>
          </div>

          <div v-if="canShowMore" class="drep-profile__more">
            <GButton tier="tertiary" compact @click="showAll = true">
              {{ $t('governance.showAllVotes', { n: filteredVotes.length }) }}
            </GButton>
          </div>
          <p class="t-caption drep-profile__note">{{ $t('governance.rationaleExternalNote') }}</p>
        </section>

        <!-- Right rail -->
        <aside class="drep-profile__rail">
          <div v-if="focusAreas.length" class="drep-profile__card glass-panel">
            <span class="t-label">{{ $t('governance.whereTheyVote') }}</span>
            <div class="drep-profile__where">
              <!-- Label and count share the top line, the bar spans the row
                   beneath them. Side by side, a fixed label track ellipsised
                   every action type long enough to matter ("Treasury Wit…",
                   "New Committ…") — the reader could not tell WHICH type they
                   were reading, which is the entire point of the block. -->
              <div v-for="area in focusAreas" :key="area.type" class="drep-profile__where-row">
                <span class="drep-profile__where-head">
                  <span class="t-body-sm drep-profile__where-label">{{ area.label }}</span>
                  <span class="t-caption g-num drep-profile__where-value">{{ area.value }}</span>
                </span>
                <!-- A bar needs a denominator. Without eligible counts this is a
                     tally, not a rate, and it is drawn as one. -->
                <span v-if="area.pct !== null" class="drep-profile__where-track">
                  <span class="drep-profile__where-fill" :style="{ width: `${area.pct}%` }"></span>
                </span>
              </div>
            </div>
            <span class="t-caption">
              {{ hasDenominators ? $t('governance.whereTheyVoteNote') : $t('governance.whereTheyVoteNoDenominator') }}
            </span>
          </div>

          <div class="drep-profile__card glass-panel">
            <span class="t-label">{{ $t('governance.votingPower') }}</span>
            <span class="t-heading g-num">{{ power }}</span>
            <span v-if="inflow" class="t-caption g-num delta-up">{{ inflow }}</span>
            <span class="t-caption">{{ $t('governance.powerHistoryUnavailable') }}</span>
          </div>

          <div v-if="links.length" class="drep-profile__card glass-panel">
            <span class="t-label">{{ $t('governance.fromTheirProfile') }}</span>
            <a
              v-for="(link, index) in links"
              :key="index"
              class="t-body-sm drep-profile__link"
              :href="link.href"
              target="_blank"
              rel="noopener noreferrer"
            >
              <v-icon x-small class="mr-1">{{ link.icon }}</v-icon>{{ link.href }}
            </a>
            <span class="t-caption">{{ $t('governance.externalLinksNote') }}</span>
          </div>
        </aside>
      </div>
    </template>

    <DRepDelegateDialog
      :isOpen="isDialogOpen"
      :drep="selectedDRep"
      :tx="tx"
      @close="closeDialog()"
    ></DRepDelegateDialog>
    <!-- Mounted only while open: opening it is what sends the request, and a
         request to an author's host must follow a click, never a render. -->
    <RationaleDialog
      v-if="rationaleVote"
      :is-open="true"
      :url="rationaleVote.rationaleUrl"
      :hash="rationaleVote.rationaleHash"
      :subtitle="rationaleVote.title"
      @close="rationaleVote = null"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router/composables';
import { walletStore } from '@/stores/walletStore';
import NetworkStore, { networkStore } from '@/stores/networkStore';
import governanceActionsStore from '@/stores/governanceActionsStore';
import { useTranslation } from '@/shared/composables/useTranslation';
import { delegationHealth } from '@/shared/composables/useDelegationHealth';
import { drepStats, type DRepRecord, type DRepVoteRecord } from '@/shared/utils/drepStats';
import {
  actionTypeResolverFor,
  canonicalActionKey,
  drepAnchorState,
  drepBio,
  drepDisplayName,
  eligibleActionIdsFor,
  epochInflow,
} from '@/shared/utils/drepView';
import { drepImageSource } from '@/modules/governance/utils/govAnchor';
import { parseDRepId, sameDRep, toCip129 } from '@/shared/utils/drepId';
import {
  drepRecordFetchedAt,
  hasDRepRecord,
  loadDRepRecord,
} from '@/shared/composables/useGovernanceHydration';
import { parseGovActionId, type GovActionId } from '@/shared/utils/govActionId';
import { toSafeLinks } from '@/shared/utils/externalLink';
import { formatInt } from '@/shared/utils/format';
import filters from '@/shared/utils/filters';
import networks from '@/utils/networks';
import { debugLog } from '@/utils/debug';
import CopyButton from '@/shared/components/CopyButton.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import EmptyState from '@/shared/components/feedback/EmptyState.vue';
import ErrorState from '@/shared/components/feedback/ErrorState.vue';
import AsOf from '@/modules/governance/components/actions/AsOf.vue';
import DRepDelegateDialog from '@/modules/governance/dialogs/DRepDelegateDialog.vue';
import RationaleDialog from '@/modules/governance/dialogs/RationaleDialog.vue';
import { useDRepDelegation } from '@/modules/governance/composables/useDRepDelegation';

/**
 * One DRep's full record.
 *
 * Everything on this page is either on chain or explicitly marked as unknown.
 * Two rules earn their own comments in the template:
 *
 *  - The verification chip is TRI-state. `is_valid: true` is verified,
 *    `is_valid: false` is a real mismatch, and an absent flag is "unverified" —
 *    a DRep nobody has checked has not failed anything.
 *  - Rationale documents live on the author's own host. The wallet fetches one
 *    ONLY when the reader clicks "Read why" — never on render, so a row cannot
 *    leak the user's IP to an author just by existing — and RationaleDialog
 *    hash-checks the bytes against the on-chain anchor and says how far to
 *    trust them. `ipfs://` anchors go through gero-backend's proxy; http(s)
 *    ones are fetched directly, read-only, without credentials.
 */

const HEAD_VOTES = 4;

const route = useRoute();
const router = useRouter();
const { t } = useTranslation();
const { truncate, toCurrency } = filters;

const { selectedDRep, tx, isDialogOpen, building, delegateToDRep, closeDialog } = useDRepDelegation();

const record = ref<DRepRecord | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const fetchedAt = ref<number | null>(null);
const voteFilter = ref<'all' | 'rationale'>('all');
const showAll = ref(false);

/** The vote whose rationale is open, or null. The dialog mounts off this. */
const rationaleVote = ref<VoteRow | null>(null);

function openRationale(vote: VoteRow): void {
  rationaleVote.value = vote;
}

const actionsState = governanceActionsStore.state;
const currentEpoch = computed(() => NetworkStore.getCurrentEpoch());

const routeDRepId = computed(() => String(route.params['drepId'] ?? ''));

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

async function load(): Promise<void> {
  const wallet = walletStore.loggedWallet;
  const raw = routeDRepId.value;
  if (!wallet || !raw) return;

  // The route accepts any of the three id forms; the endpoint keys on the
  // CIP-129 string it returns, so canonicalise first and only fall back to the
  // raw parameter if that lookup finds nothing.
  const parsed = parseDRepId(raw);
  const canonical =
    parsed && parsed.form !== 'keyword' ? toCip129(parsed.credentialHex, parsed.credentialType) : null;

  // A record already in hand is rendered immediately rather than behind a
  // skeleton. Coming back to a profile you were just looking at should not blank
  // the page and rebuild it — that read as a page that had lost its place.
  const cached = canonical && hasDRepRecord(canonical, wallet);
  loading.value = !cached;
  error.value = null;
  try {
    let found = canonical ? await loadDRepRecord(canonical, wallet) : null;
    if (!found && (!canonical || canonical !== raw)) {
      found = await loadDRepRecord(raw, wallet);
    }
    record.value = (found ?? null) as DRepRecord | null;
    // The stamp comes from the CACHE, not the clock: a record served from memory
    // can be minutes old, and "as of now" would be a claim the data cannot back.
    fetchedAt.value = (canonical && drepRecordFetchedAt(canonical, wallet)) || Date.now();
  } catch (err) {
    debugLog('DRepProfile: load failed', err);
    error.value = err instanceof Error ? err.message : String(t('errors.unknownError'));
    record.value = null;
  } finally {
    loading.value = false;
  }
}

watch(routeDRepId, () => {
  showAll.value = false;
  void load();
});

onMounted(() => {
  void load();
  const network = String(walletStore.loggedWallet?.network ?? '');
  if (network && !actionsState.actions.length) {
    void governanceActionsStore.loadActions(network).catch(() => undefined);
  }
});

// ---------------------------------------------------------------------------
// Derived facts
// ---------------------------------------------------------------------------

const sampleProposalId = computed(() => {
  for (const vote of record.value?.votes ?? []) {
    if (typeof vote?.proposal_id === 'string' && vote.proposal_id.trim()) return vote.proposal_id.trim();
  }
  return null;
});

const eligibleActionIds = computed(() =>
  actionsState.actions.length ? eligibleActionIdsFor(sampleProposalId.value, actionsState.actions) : null,
);

const typeResolver = computed(() =>
  actionsState.actions.length ? actionTypeResolverFor(actionsState.actions) : null,
);

const stats = computed(() =>
  record.value
    ? drepStats(record.value, {
        eligibleActionIds: eligibleActionIds.value ?? undefined,
        totalEligibleActions: eligibleActionIds.value ? undefined : actionsState.actions.length || undefined,
        typeResolver: typeResolver.value ?? undefined,
      })
    : null,
);

const health = computed(() =>
  delegationHealth(record.value, {
    currentEpoch: currentEpoch.value,
    activityWindow: (networkStore.epochParams as { dRepInactivityPeriod?: number } | null)?.dRepInactivityPeriod ?? null,
    // Enables the recent-vote veto against a stale indexed expiry.
    nowSec: Math.floor(Date.now() / 1000),
  }),
);

const drepId = computed(() => String(record.value?.drep_id ?? routeDRepId.value));
const name = computed(() => drepDisplayName(record.value) ?? truncate(drepId.value));
const bio = computed(() => drepBio(record.value));
const image = computed(() => drepImageSource(record.value));
const isCurrent = computed(() => sameDRep(drepId.value, walletStore.account?.drep_id));
const links = computed(() => toSafeLinks(record.value?.metadata?.meta_json?.body?.['references']));

function ada(value: bigint): string {
  const wallet = walletStore.loggedWallet;
  return toCurrency(value.toString(), false, 2, networks.resolveCurrencySymbol(wallet?.chain, wallet?.network), '', true);
}

const power = computed(() => ada(stats.value?.votingPower ?? 0n));
const inflow = computed(() => {
  const value = epochInflow(record.value?.delegators, currentEpoch.value);
  return value !== null && value > 0n ? `+${ada(value)}` : null;
});

const status = computed(() => {
  if (!record.value) return null;
  if (health.value.retired) return { tone: 'neutral', label: String(t('governance.retired')) };
  if (health.value.expired) return { tone: 'warning', label: String(t('governance.noLongerCounting')) };
  if (health.value.inactiveSoon && health.value.epochsLeft !== null) {
    return { tone: 'warning', label: String(t('governance.inactiveInEpochs', { n: health.value.epochsLeft })) };
  }
  if (record.value.active === true) return { tone: 'success', label: String(t('governance.status.active')) };
  return null;
});

const anchorState = computed(() => drepAnchorState(record.value));
const anchorTone = computed(() => {
  switch (anchorState.value) {
    case 'verified':
      return 'success';
    case 'mismatch':
      return 'warning';
    default:
      return 'neutral';
  }
});
const anchorIcon = computed(() => {
  switch (anchorState.value) {
    case 'verified':
      return 'mdi-shield-check-outline';
    case 'mismatch':
      return 'mdi-shield-alert-outline';
    case 'none':
      return 'mdi-shield-off-outline';
    default:
      return 'mdi-shield-outline';
  }
});
const anchorLabel = computed(() => {
  switch (anchorState.value) {
    case 'verified':
      return String(t('governance.anchorVerified'));
    case 'mismatch':
      return String(t('governance.anchorMismatch'));
    case 'none':
      return String(t('governance.anchorNone'));
    default:
      return String(t('governance.anchorUnverified'));
  }
});

// ---------------------------------------------------------------------------
// Voting record
// ---------------------------------------------------------------------------

/** Canonical action id to its title, type and epoch, when the actions loaded. */
const actionIndex = computed(() => {
  const map = new Map<string, { title: string | null; type: string | null; epoch: number | null }>();
  for (const action of actionsState.actions) {
    const entry = {
      title: action.title ?? null,
      type: typeof action.type === 'string' ? action.type : null,
      epoch: action.submittedEpoch ?? null,
    };
    for (const raw of [action.govActionId, action.govActionIdCip129]) {
      const key = canonicalActionKey(raw);
      if (key) map.set(key, entry);
    }
  }
  return map;
});

function typeLabel(type: string): string {
  const key = `governance.actionType.${type.toLowerCase()}`;
  const label = String(t(key));
  return label === key ? type : label;
}

const CHOICE_TONE: Record<string, string> = { yes: 'yes', no: 'no', abstain: 'abstain' };

interface VoteRow {
  key: string;
  choiceLabel: string;
  tone: string;
  title: string;
  meta: string;
  /** The CIP-136 anchor pair, for the rationale dialog; null when none was attached. */
  rationaleUrl: string | null;
  rationaleHash: string | null;
  /** Set only when the proposal id parses as a governance action id. */
  actionRoute: GovActionId | null;
}

/** Newest first, latest revision per proposal — the same de-duplication `drepStats` applies. */
const allVotes = computed<VoteRow[]>(() => {
  const latest = new Map<string, DRepVoteRecord>();
  for (const vote of record.value?.votes ?? []) {
    const id = typeof vote?.proposal_id === 'string' ? vote.proposal_id.trim() : '';
    if (!id) continue;
    const existing = latest.get(id);
    if (!existing || (vote.block_time ?? 0) >= (existing.block_time ?? 0)) latest.set(id, vote);
  }

  return [...latest.entries()]
    .sort((a, b) => (b[1].block_time ?? 0) - (a[1].block_time ?? 0))
    .map(([id, vote]) => {
      const choice = String(vote.vote ?? '').toLowerCase();
      const action = actionIndex.value.get(canonicalActionKey(id) ?? '');
      const parts: string[] = [];
      if (action?.type) parts.push(typeLabel(action.type));
      if (action?.epoch !== null && action?.epoch !== undefined) {
        parts.push(String(t('governance.submittedEpochLabel', { n: action.epoch })));
      }
      return {
        key: id,
        choiceLabel: String(t(`governance.voteChoice.${choice || 'unknown'}`)),
        tone: CHOICE_TONE[choice] ?? 'abstain',
        title: action?.title || truncate(id),
        meta: parts.join(' · '),
        rationaleUrl: typeof vote.meta_url === 'string' && vote.meta_url.trim() ? vote.meta_url.trim() : null,
        rationaleHash: typeof vote.meta_hash === 'string' && vote.meta_hash.trim() ? vote.meta_hash.trim() : null,
        actionRoute: parseGovActionId(id),
      };
    });
});

const filteredVotes = computed(() =>
  voteFilter.value === 'rationale' ? allVotes.value.filter(vote => !!vote.rationaleUrl) : allVotes.value,
);

const visibleVotes = computed(() =>
  showAll.value ? filteredVotes.value : filteredVotes.value.slice(0, HEAD_VOTES),
);

const canShowMore = computed(() => !showAll.value && filteredVotes.value.length > HEAD_VOTES);

function onVoteFilter(next: 'all' | 'rationale' | undefined): void {
  voteFilter.value = next ?? 'all';
  showAll.value = false;
}

// ---------------------------------------------------------------------------
// Where they vote
// ---------------------------------------------------------------------------

const hasDenominators = computed(() => (stats.value?.focusAreas ?? []).some(area => area.eligible !== null));

const focusAreas = computed(() =>
  (stats.value?.focusAreas ?? [])
    .filter(area => area.voted > 0 || (area.eligible ?? 0) > 0)
    .map(area => ({
      type: area.type,
      label: typeLabel(area.type),
      pct: area.eligible && area.eligible > 0 ? Math.min(100, Math.round((area.voted * 100) / area.eligible)) : null,
      value: area.eligible !== null ? `${area.voted}/${area.eligible}` : String(area.voted),
    })),
);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function openAction(id: GovActionId): void {
  router.push({ name: 'governanceAction', params: { txHash: id.txHash, index: String(id.index) } });
}

function goToDirectory(): void {
  router.push({ name: 'governanceDReps' });
}

async function onDelegate(): Promise<void> {
  const row = record.value;
  if (!row || isCurrent.value) return;
  await delegateToDRep({
    id: drepId.value,
    name: name.value,
    image: image.value,
    delegators: Array.isArray(row.delegators) ? row.delegators.length : 0,
    votes: Array.isArray(row.votes) ? row.votes.length : 0,
    voting_power: stats.value?.votingPower ?? 0n,
    hex: row.hex ?? undefined,
    has_script: row.has_script ?? false,
    links: row.metadata?.meta_json?.body?.['references'],
  });
}
</script>

<style scoped lang="scss">
.drep-profile {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-4);
}
.drep-profile__crumbs {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}
.drep-profile__rows {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
}
.drep-profile__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--g-s-5);
  flex-wrap: wrap;
}
.drep-profile__identity {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-4);
  min-width: 0;
}
.drep-profile__avatar {
  flex: none;
}
.drep-profile__identity-text {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  min-width: 0;
}
.drep-profile__title-line {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  flex-wrap: wrap;
}
.drep-profile__id {
  display: flex;
  align-items: center;
  overflow-wrap: anywhere;
}
.drep-profile__bio {
  margin: 0;
  max-width: 62ch;
}
.drep-profile__cta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--g-s-1);
}
.drep-profile__pill {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);
  padding: 0 var(--g-s-2);
  border-radius: var(--g-r-chip);
  border: 1px solid var(--g-hairline-2);
  color: var(--g-text-3);
}
.drep-profile__pill-icon {
  color: currentColor;
}
.drep-profile__pill--success {
  color: var(--g-success);
  background: var(--g-success-fill);
  border-color: var(--g-success-line);
}
.drep-profile__pill--warning {
  color: var(--g-warning);
  background: var(--g-warning-fill);
  border-color: var(--g-warning-line);
}
.drep-profile__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--g-s-2);
}
.drep-profile__stat {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  padding: var(--g-s-3) var(--g-s-4);
  border-radius: var(--g-r-card);
}
.drep-profile__body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: var(--g-s-4);
  align-items: start;
}
@media (max-width: 1100px) {
  .drep-profile__body {
    grid-template-columns: minmax(0, 1fr);
  }
}
.drep-profile__record {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-4);
  border-radius: var(--g-r-card);
  min-width: 0;
}
.drep-profile__record-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
  flex-wrap: wrap;
}
.drep-profile__votes {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}
.drep-profile__vote {
  @include g-glass-tier(false);
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  padding: var(--g-s-3);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
}
.drep-profile__vote-head {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  flex-wrap: wrap;
}
.drep-profile__vote-pill {
  display: inline-flex;
  align-items: center;
  padding: 0 var(--g-s-2);
  border-radius: var(--g-r-chip);
  border: 1px solid var(--g-hairline-2);
  color: var(--g-text-3);
}
.drep-profile__vote-pill--yes {
  color: var(--g-success);
  background: var(--g-success-fill);
  border-color: var(--g-success-line);
}
.drep-profile__vote-pill--no {
  color: var(--g-error);
  background: var(--g-error-fill);
  border-color: var(--g-error-line);
}
.drep-profile__vote-title {
  flex: 1;
  min-width: 0;
  color: var(--g-text-1);
}
.drep-profile__vote-link {
  background: none;
  border: none;
  padding: 0;
  text-align: left;
  cursor: pointer;
}
.drep-profile__vote-link:hover {
  color: var(--g-accent);
}
.drep-profile__vote-meta {
  flex: none;
}
.drep-profile__rationale {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: var(--g-accent);
  align-self: flex-start;
  cursor: pointer;
}
.drep-profile__rationale:hover {
  text-decoration: underline;
}
.drep-profile__more {
  display: flex;
  justify-content: center;
}
.drep-profile__note {
  margin: 0;
  color: var(--g-text-3);
}
.drep-profile__rail {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  min-width: 0;
}
.drep-profile__card {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  padding: var(--g-s-4);
  border-radius: var(--g-r-card);
}
.drep-profile__where {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}
.drep-profile__where-row {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}
.drep-profile__where-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-2);
}
/* No width cap and no ellipsis: the action type IS the label, and a shortened
   one names nothing. Long types wrap onto a second line instead. */
.drep-profile__where-label {
  min-width: 0;
  color: var(--g-text-2);
}
.drep-profile__where-track {
  display: block;
  width: 100%;
  height: 6px;
  border-radius: var(--g-r-pill);
  background: var(--g-raised);
  overflow: hidden;
}
.drep-profile__where-fill {
  display: block;
  height: 100%;
  background: var(--g-accent);
  transition: width var(--g-dur-base) var(--g-ease);
}
.drep-profile__where-value {
  flex: none;
  white-space: nowrap;
}
.drep-profile__link {
  color: var(--g-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.drep-profile__link:hover {
  color: var(--g-accent);
}
</style>
