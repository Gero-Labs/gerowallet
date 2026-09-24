<template>
  <!-- One delegated click listener for every `[n]` marker in the prose below is
       wired to this element in `onMounted` (NOT with `@click`, which would make
       a plain div a control the ratchet counts). The markers are real buttons
       the renderer emits, so Enter/Space reach this handler natively and the
       address bar is never touched. -->
  <div ref="proseRoot" class="action-detail">
    <div class="action-detail__nav">
      <GButton tier="tertiary" compact @click="goBack()">
        <v-icon small class="mr-1">mdi-arrow-left</v-icon>
        {{ $t('governance.back') }}
      </GButton>
      <AsOf :timestamp="state.fetchedAt" />
    </div>

    <ErrorState v-if="state.actionError" :message="state.actionError" retryable @retry="reload()" />

    <div v-else-if="state.actionLoading" class="action-detail__body">
      <v-skeleton-loader type="heading" />
      <v-skeleton-loader type="paragraph" />
      <v-skeleton-loader type="paragraph" />
    </div>

    <template v-else-if="action">
      <div class="action-detail__header">
        <div class="action-detail__badges">
          <span class="t-label action-detail__type">{{ typeLabel }}</span>
          <StatusPill :status="action.status" />
          <AnchorBadge
            :hash-valid="hashVerdict"
            :has-anchor="!!action.anchorUrl"
            :failure-reason="anchorFailureReason"
          />
        </div>
        <h1 class="t-title action-detail__title">{{ title }}</h1>
        <div class="action-detail__meta t-caption">
          <span v-if="action.deposit" class="g-num">{{ $t('governance.depositFee') }}: {{ depositAda }} ₳</span>
          <span v-if="action.submittedEpoch !== null" class="g-num">
            {{ $t('governance.submittedEpochLabel', { n: action.submittedEpoch }) }}
          </span>
          <span v-if="action.expiresEpoch !== null" class="g-num">
            {{ $t('governance.expiresEpochLabel', { n: action.expiresEpoch }) }}
          </span>
          <span v-if="epochsLeft !== null" class="g-num">
            {{ $t('governance.epochsRemaining', { n: epochsLeft }) }}<template v-if="daysLeft !== null"> ({{ $t('governance.approxDaysLeft', { n: daysLeft }) }})</template>
          </span>
          <!-- Same epoch count, said as a day. Approximate by construction: the
               position inside the current epoch is unknown, so the "≈" stays. -->
          <span v-if="expiresOn" :title="$t('governance.approxExpiryHint')">
            {{ $t('governance.approxExpiryDate', { date: expiresOn }) }}
          </span>
        </div>
        <!-- The single-action vote CTA is withheld in 2.7.1: it gated on the
             wallet HAVING a DRep key rather than on that DRep being registered
             on chain, so unregistered wallets could build a vote the node
             rejects ("unknown voters"). Batch voting on the list keeps its
             registration lookup. Restore once VoteCta checks registration. -->
      </div>

      <div class="action-detail__tabs" role="tablist">
        <button
          v-for="tabItem in TABS"
          :key="tabItem.id"
          type="button"
          role="tab"
          class="action-detail__tab t-body-2"
          :class="{ 'action-detail__tab--active': tab === tabItem.id }"
          :aria-selected="tab === tabItem.id ? 'true' : 'false'"
          @click="setTab(tabItem.id)"
        >
          {{ $t(tabItem.labelKey) }}
        </button>
      </div>

      <!-- Overview -->
      <div v-if="tab === 'overview'" class="action-detail__body">
        <!-- InfoAction is advisory: no threshold, can never ratify. An explicit
             panel — never a pass/fail tally. -->
        <div v-if="isInfoAction" class="action-detail__advisory glass-panel">
          <v-icon small color="var(--g-text-2)" class="mr-2">mdi-information-outline</v-icon>
          <span class="t-body-2">{{ $t('governance.infoActionAdvisory') }}</span>
        </div>
        <!-- Prose left, everything the reader can ACT on stacked in a rail on
             the right: the per-body tallies first, then the recorded positions
             with their jump into the Votes tab. The tallies used to run
             full-width above the prose, which put the summary and the "see the
             votes" buttons at opposite ends of a long document. Below the
             breakpoint the rail collapses into the same column and moves ABOVE
             the prose, so the popup and the side panel still lead with the
             tally rather than burying it under the whole proposal. -->
        <div
          class="action-detail__overview-grid"
          :class="{ 'action-detail__overview-grid--single': !hasRail }"
        >
          <div class="action-detail__prose-col">
            <!-- What a treasury withdrawal pays and to whom, read from the
                 on-chain payload rather than the metadata document, so it is
                 there even when that document could not be read. -->
            <section v-if="treasuryWithdrawals.length" class="action-detail__section">
              <h2 class="t-heading">{{ $t('governance.actionType.treasurywithdrawals') }}</h2>
              <ul class="action-detail__withdrawals">
                <li
                  v-for="(withdrawal, i) in treasuryWithdrawals"
                  :key="`${withdrawal.rewardAddress}-${i}`"
                  class="action-detail__withdrawal"
                >
                  <span class="t-heading g-num" :title="`${withdrawal.exactAda} ₳`">{{ withdrawal.ada }} ₳</span>
                  <span class="action-detail__withdrawal-to t-caption">
                    <span>{{ $t('governance.recipientAddress') }}</span>
                    <span class="g-mono" :title="withdrawal.rewardAddress">{{ withdrawal.shortAddress }}</span>
                    <CopyButton x-small :value="withdrawal.rewardAddress" />
                  </span>
                </li>
              </ul>
            </section>

            <!-- CIP-108 bodies are markdown documents, not captions: headings,
                 tables and lists all appear in real proposals. Everything is
                 HTML-escaped before a single markdown rule runs, so a proposal
                 author cannot get markup into this page. -->
            <section v-if="action.abstractText" class="action-detail__section">
              <h2 class="t-heading">{{ $t('governance.abstract') }}</h2>
              <div class="g-prose" v-html="renderedAbstract"></div>
            </section>
            <section v-if="action.motivation" class="action-detail__section">
              <h2 class="t-heading">{{ $t('governance.motivation') }}</h2>
              <div class="g-prose" v-html="renderedMotivation"></div>
            </section>
            <section v-if="action.rationale" class="action-detail__section">
              <h2 class="t-heading">{{ $t('governance.rationale') }}</h2>
              <div class="g-prose" v-html="renderedRationale"></div>
            </section>

            <!-- Every prose section above comes from the metadata document.
                 Without one the column would sit blank under a bare id, so say
                 why, and offer the document itself when there is one to open. -->
            <div v-if="overviewNotice" class="action-detail__notice glass-panel">
              <v-icon small color="var(--g-text-3)">mdi-file-document-outline</v-icon>
              <span class="t-body-2">{{ $t(overviewNotice) }}</span>
              <a
                v-if="noticeLinksAnchor"
                :href="anchorHref"
                target="_blank"
                rel="noopener noreferrer"
                class="action-detail__link t-body-2"
              >
                {{ $t('governance.metadataDocument') }}
                <v-icon x-small class="ml-1">mdi-open-in-new</v-icon>
              </a>
            </div>

            <section v-if="showAnchorReference || referenceLinks.length" class="action-detail__section">
              <h2 class="t-heading">{{ $t('governance.references') }}</h2>
              <!-- The anchor document is not a numbered reference, so it sits
                   outside the list the [n] markers point into. -->
              <a
                v-if="showAnchorReference"
                :href="anchorHref"
                target="_blank"
                rel="noopener noreferrer"
                class="action-detail__link t-body-2"
              >
                <v-icon x-small class="mr-1">mdi-file-document-outline</v-icon>
                {{ $t('governance.metadataDocument') }}
              </a>
              <!-- `value` on each item, not the browser's own 1..n counting: an
                   entry dropped as unsafe leaves a GAP, and the labels have to
                   keep agreeing with the [n] markers in the prose. Renumbering
                   the survivors would point a [2] marker at an entry labelled
                   "1.". `tabindex=-1` makes each entry a focus target, so
                   activating a marker from the keyboard moves the caret here. -->
              <ol v-if="referenceLinks.length" class="action-detail__references">
                <li
                  v-for="link in referenceLinks"
                  :id="referenceElementId(link.number)"
                  :key="`${link.href}-${link.number}`"
                  :value="link.number"
                  tabindex="-1"
                  class="action-detail__reference"
                  :class="{ 'action-detail__reference--jumped': jumpedReference === link.number }"
                >
                  <a
                    :href="link.href"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="action-detail__link t-body-2"
                  >
                    <v-icon x-small class="mr-1">{{ link.icon }}</v-icon>
                    {{ link.label }}
                  </a>
                </li>
              </ol>
              <p class="t-caption action-detail__note">{{ $t('governance.externalLinksNote') }}</p>
            </section>
          </div>

          <!-- One card per body that votes on this action type, stacked in the
               order they are read, then who has voted so far with a jump into
               the Votes tab pre-filtered to that body. A pre-filtered tab beats
               a second drawer: it reuses the full explorer (search, avatars,
               rationale links) instead of duplicating a lesser copy. -->
          <aside v-if="hasRail" class="action-detail__rail">
            <BodyTallyCard
              v-for="body in bodyResults"
              :key="body.result.body"
              :result="body.result"
              :composition="body.composition"
              :counts="body.counts"
              :threshold-note="body.thresholdNote"
            />

            <div v-if="summary" class="action-detail__rail-card glass-panel">
              <span class="t-label">{{ $t('governance.positionsTitle') }}</span>
              <div v-if="drepCastCounts" class="action-detail__rail-row">
                <span class="action-detail__rail-label t-body-2">{{ $t('governance.dReps') }}</span>
                <span class="action-detail__rail-value t-caption g-num">
                  {{ $t('governance.votesCount', drepCastCounts) }}
                </span>
              </div>
              <GButton tier="tertiary" compact block @click="openVotesFor('DRep')">
                {{ $t('governance.viewDRepVotes') }}
              </GButton>
              <div v-if="ccCounts" class="action-detail__rail-row">
                <span class="action-detail__rail-label t-body-2">{{ $t('governance.constitutionalCommittee') }}</span>
                <span class="action-detail__rail-value t-caption g-num">
                  {{ $t(ccCounts.notVoted === null ? 'governance.votesCount' : 'governance.votesCountWithNotVoted', ccCounts) }}
                </span>
              </div>
              <GButton tier="tertiary" compact block @click="openVotesFor('ConstitutionalCommittee')">
                {{ $t('governance.viewCommitteeVotes') }}
              </GButton>
            </div>
          </aside>
        </div>
      </div>

      <!-- Positions (cast votes).
           Each row is that voter's STANDING position: the endpoint collapses
           re-votes, so there is exactly one row per voter and no history to
           order (verified against mainnet, 52 rows / 52 distinct voters). It
           does carry a block time, which is where the per-row date comes from
           wherever the projection passes it through. -->
      <div v-else-if="tab === 'positions'" class="action-detail__body">
        <PositionsPanel
          :preset-role="presetRole"
          :committee-names="committeeNames"
          :votes="state.currentVotes"
          :total="state.votesTotal"
          :loading="state.votesLoading"
          :loaded="state.votesLoaded"
          :error="state.votesError"
          :truncated="state.votesTruncated"
          :identity="voterIdentity"
          :identity-unknown="identityUnknown"
          :action-open="actionIsOpen"
          :chain="chain"
          :network="network"
          @retry="loadVotes()"
          @open-drep="openDRep"
        />
      </div>

      <!-- On-chain payload -->
      <div v-else-if="tab === 'onchain'" class="action-detail__body">
        <EmptyState v-if="action.govAction === null" :message="$t('common.notAvailable')" />
        <pre v-else class="action-detail__json g-mono t-caption">{{ formattedGovAction }}</pre>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router/composables';
import { walletStore } from '@/stores/walletStore';
import NetworkStore, { networkStore } from '@/stores/networkStore';
import governanceActionsStore from '@/stores/governanceActionsStore';
import { toDisplayGovActionId } from '@/shared/utils/govActionId';
import { toLovelace } from '@/shared/utils/lovelace';
import { formatBalance } from '@/shared/utils/format';
import filters from '@/shared/utils/filters';
import { drepTallies, spoTallies, ccTallies, ccProgress, activeCommitteeSize } from '@/shared/utils/govTally';
import type { Composition } from '@/shared/utils/govTally';
import { evaluateThresholds } from '@/shared/utils/govThresholds';
import type { BodyResult, GovThresholdParams } from '@/shared/utils/govThresholds';
import {
  epochsRemaining,
  daysRemaining,
  approxExpiryDate,
  formatApproxExpiry,
  isOpen,
} from '@/shared/utils/govLifecycle';
import { renderMarkdown, referenceMarkerIndex } from '@/shared/utils/renderMarkdown';
import { governanceStatus } from '@/shared/composables/useGovernanceStatus';
import { useTranslation } from '@/shared/composables/useTranslation';
import StatusPill from '@/modules/governance/components/actions/StatusPill.vue';
import AnchorBadge from '@/modules/governance/components/actions/AnchorBadge.vue';
import AsOf from '@/modules/governance/components/actions/AsOf.vue';
import BodyTallyCard from '@/modules/governance/components/actions/BodyTallyCard.vue';
import PositionsPanel from '@/modules/governance/components/actions/PositionsPanel.vue';
import { committeeNameIndex } from '@/modules/governance/components/actions/positions';
import type { PositionIdentity } from '@/modules/governance/components/actions/positions';
import {
  hasReferenceIndex,
  referenceElementId,
  toReferenceLinks,
} from '@/modules/governance/components/actions/references';
import { toLinkHref } from '@/modules/governance/utils/govAnchor';
import { treasuryWithdrawalsOf } from '@/modules/governance/utils/treasuryWithdrawals';
import EmptyState from '@/shared/components/feedback/EmptyState.vue';
import ErrorState from '@/shared/components/feedback/ErrorState.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import CopyButton from '@/shared/components/CopyButton.vue';

const TABS = [
  { id: 'overview', labelKey: 'governance.overview' },
  { id: 'positions', labelKey: 'governance.votes' },
  { id: 'onchain', labelKey: 'governance.onchainData' },
] as const;

const route = useRoute();
const router = useRouter();
const { t } = useTranslation();

const state = governanceActionsStore.state;

const network = computed(() => String(walletStore.loggedWallet?.network ?? ''));
const chain = computed(() => String(walletStore.loggedWallet?.chain ?? ''));
const currentEpoch = computed(() => NetworkStore.getCurrentEpoch());

const govActionId = computed(() =>
  toDisplayGovActionId({
    txHash: String(route.params['txHash'] ?? ''),
    index: Number(route.params['index'] ?? 0),
  }),
);

const action = computed(() => state.currentAction);
const summary = computed(() => state.currentSummary);
const isInfoAction = computed(() => action.value?.type === 'InfoAction');

const tab = computed(() => {
  const value = String(route.query['tab'] ?? 'overview');
  return TABS.some(item => item.id === value) ? value : 'overview';
});

interface FractionLike {
  numerator?: number;
  denominator?: number;
}

/** Fraction {numerator, denominator} → 0..1, preserving "unknown". */
function fractionToNumber(fraction: FractionLike | null | undefined): number | undefined {
  if (!fraction) return undefined;
  const { numerator, denominator } = fraction;
  if (typeof numerator !== 'number' || typeof denominator !== 'number' || !denominator) return undefined;
  return numerator / denominator;
}

/**
 * Map the synced protocol parameters into GovThresholdParams — the ONLY place
 * the two shapes meet. Every missing field maps to undefined, never a default:
 * an unknown threshold must render as unknown, not as a guessed mainnet value.
 *
 * Known limitation: db/loaders/network.ts falls back to hardcoded mainnet-2024
 * defaults when the epoch_params row is absent, and that fallback is
 * indistinguishable from real data here. What we CAN detect — epochParams not
 * yet loaded at all — maps to all-undefined.
 */
function toGovThresholdParams(): GovThresholdParams {
  const params = networkStore.epochParams as unknown as {
    dRepVotingThresholds?: Record<string, FractionLike>;
    poolVotingThresholds?: Record<string, FractionLike>;
    minCommitteeSize?: number;
  } | null;
  const drep = params?.dRepVotingThresholds;
  const pool = params?.poolVotingThresholds;
  return {
    dvtMotionNoConfidence: fractionToNumber(drep?.['motionNoConfidence']),
    dvtCommitteeNormal: fractionToNumber(drep?.['committeeNormal']),
    dvtCommitteeNoConfidence: fractionToNumber(drep?.['committeeNoConfidence']),
    dvtUpdateConstitution: fractionToNumber(drep?.['updateConstitution']),
    dvtHardFork: fractionToNumber(drep?.['hardForkInitiation']),
    dvtPpNetwork: fractionToNumber(drep?.['ppNetworkGroup']),
    dvtPpEconomic: fractionToNumber(drep?.['ppEconomicGroup']),
    dvtPpTechnical: fractionToNumber(drep?.['ppTechnicalGroup']),
    dvtPpGov: fractionToNumber(drep?.['ppGovernanceGroup']),
    dvtTreasuryWithdrawal: fractionToNumber(drep?.['treasuryWithdrawal']),
    pvtMotionNoConfidence: fractionToNumber(pool?.['motionNoConfidence']),
    pvtCommitteeNormal: fractionToNumber(pool?.['committeeNormal']),
    pvtCommitteeNoConfidence: fractionToNumber(pool?.['committeeNoConfidence']),
    pvtHardFork: fractionToNumber(pool?.['hardForkInitiation']),
    pvtSecurityGroup: fractionToNumber(pool?.['securityRelevantParamVotingThreshold']),
    committeeMinSize: typeof params?.minCommitteeSize === 'number' ? params.minCommitteeSize : undefined,
    // The committee's own quorum (mainnet 2/3), from the committee this view
    // loaded — undefined, and so "unknown", until that lands.
    committeeQuorum: fractionToNumber({
      numerator: state.committee?.thresholdNumerator ?? undefined,
      denominator: state.committee?.thresholdDenominator ?? undefined,
    }),
  };
}

const drepComposition = computed(() => drepTallies(summary.value));
const spoComposition = computed(() => spoTallies(summary.value));

const actionIsOpen = computed(() => isOpen(action.value?.status));

/**
 * Committee seats that can vote on this action now. Only for an open action:
 * the committee in hand is the CURRENT one, and a closed action may have been
 * voted on by a different one, so there it stays unknown and the tally falls
 * back to the server's figures.
 */
const activeSeats = computed(() =>
  actionIsOpen.value ? activeCommitteeSize(state.committee, currentEpoch.value) : null,
);

/** CC votes by member count, not stake — see `ccTallies` for why not the server pct. */
const ccComposition = computed<Composition>(() => ccTallies(summary.value, activeSeats.value));

const ccCounts = computed(() =>
  ccProgress(
    summary.value,
    state.committee?.thresholdNumerator,
    state.committee?.thresholdDenominator,
    activeSeats.value,
  ),
);

/** Head-counts of DRep ballots cast, for the rail. Null when the summary has none. */
const drepCastCounts = computed(() => {
  const s = summary.value;
  if (!s || s.yesVotesCast === null) return null;
  return { yes: s.yesVotesCast, no: s.noVotesCast ?? 0, abstain: s.abstainVotesCast ?? 0 };
});

/** Body filter the Votes tab opens with; consumed by PositionsPanel. */
const presetRole = ref<string | null>(null);

function openVotesFor(role: string): void {
  presetRole.value = role;
  setTab('positions');
}

interface BodyCard {
  result: BodyResult;
  composition: Composition;
  counts: { yes: number; no: number; abstain: number; notVoted: number | null } | null;
  thresholdNote?: string;
}

/**
 * One card per body that actually votes on this action type. The ParameterChange
 * group scope is passed as null until the payload decoding lands server-side —
 * per CIP-1694 the conservative fallback is the strictest of all four DRep
 * groups with the SPO row OMITTED rather than invented.
 */
const bodyResults = computed<BodyCard[]>(() => {
  if (!action.value || isInfoAction.value) return [];
  // The UNROUNDED shares: the display figures are rounded to two decimals, and
  // a share that only rounds up to the threshold has not cleared it.
  const observed = {
    drepYesPct: drepComposition.value.yesShare ?? drepComposition.value.yesPct,
    spoYesPct: spoComposition.value.yesShare ?? spoComposition.value.yesPct,
    ccYesPct: ccComposition.value.yesShare ?? ccComposition.value.yesPct,
  };
  const results = evaluateThresholds(String(action.value.type), toGovThresholdParams(), observed, null);
  return results.map(result => {
    if (result.body === 'SPO') {
      return { result, composition: spoComposition.value, counts: null };
    }
    if (result.body === 'CC') {
      // The CC threshold is a member-count quorum read from the committee (the
      // summary's ccThreshold is null upstream), so when it is unknown the note
      // names the quorum, not the epoch parameters.
      const counts = ccCounts.value;
      return {
        result,
        composition: ccComposition.value,
        counts: counts ? { yes: counts.yes, no: counts.no, abstain: counts.abstain, notVoted: counts.notVoted } : null,
        thresholdNote: String(t('governance.quorumUnavailable')),
      };
    }
    return { result, composition: drepComposition.value, counts: null };
  });
});

/**
 * Whether the right rail has anything to hold. An InfoAction has no threshold
 * and no tally, so on one it is the ADVISORY panel that stands above the prose
 * and the grid runs as a single column — a 300px empty gutter would read as
 * something that failed to load.
 */
const hasRail = computed(() => !isInfoAction.value && (bodyResults.value.length > 0 || !!summary.value));

/**
 * Committee credential -> published name, for the committee rows on the Votes
 * tab. Built from the committee the store loaded for this network; an empty map
 * (not loaded, endpoint down, or a projection that sends no names) leaves every
 * committee row showing its hash.
 */
const committeeNames = computed(() => committeeNameIndex(state.committee?.members));

const typeLabel = computed(() => {
  const type = String(action.value?.type ?? '');
  const key = `governance.actionType.${type.toLowerCase()}`;
  const translated = String(t(key));
  return translated === key ? type : translated;
});

/** The id in the same short form the action list shows: `418df5…a9f#0`. */
const shortId = computed(() => {
  const hash = String(action.value?.txHash ?? route.params['txHash'] ?? '');
  const index = action.value?.index ?? Number(route.params['index'] ?? 0);
  return hash.length > 9 ? `${hash.slice(0, 6)}…${hash.slice(-3)}#${index}` : `${hash}#${index}`;
});

/**
 * The CIP-108 title, or — when the metadata document could not be read — what
 * the chain itself says: the action's type and a short id. Never the raw id
 * alone, which reads as an error.
 */
const title = computed(() => {
  if (action.value?.title) return action.value.title;
  if (!action.value) return '';
  return String(t('governance.untitledActionTitle', { type: typeLabel.value, id: shortId.value }));
});

/**
 * Lovelace in ADA, full precision. Treasury and deposit amounts sit far below
 * 2^53 lovelace (the whole treasury is ~1.7e15), so the division is exact.
 */
function exactAda(lovelace: bigint): string {
  return (Number(lovelace) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

const depositAda = computed(() => exactAda(toLovelace(action.value?.deposit)));

/**
 * What a TreasuryWithdrawals action pays out, from its on-chain payload. The
 * amount is shown compact (11.79M) with the exact figure on hover, and the
 * recipient as a truncated stake address with the full one one click away.
 */
const treasuryWithdrawals = computed(() => {
  if (action.value?.type !== 'TreasuryWithdrawals') return [];
  return treasuryWithdrawalsOf(action.value.govAction).map(withdrawal => ({
    rewardAddress: withdrawal.rewardAddress,
    shortAddress: filters.truncate(withdrawal.rewardAddress),
    ada: formatBalance(Number(withdrawal.lovelace) / 1_000_000),
    exactAda: exactAda(withdrawal.lovelace),
  }));
});

const epochsLeft = computed(() => {
  if (!isOpen(action.value?.status)) return null;
  return epochsRemaining(currentEpoch.value, action.value?.expiresEpoch);
});

/** Whole-epoch approximation ("about N days") — tip.epoch carries no intra-epoch position. */
const daysLeft = computed(() => {
  if (!isOpen(action.value?.status)) return null;
  return daysRemaining(currentEpoch.value, action.value?.expiresEpoch);
});

/** That same approximation as a calendar day; '' when either epoch is unknown. */
const expiresOn = computed(() => {
  if (!isOpen(action.value?.status)) return '';
  return formatApproxExpiry(approxExpiryDate(currentEpoch.value, action.value?.expiresEpoch));
});

/** Whether the metadata document itself is in hand. */
const hasDocument = computed(() => action.value?.rawMetadata !== null && action.value?.rawMetadata !== undefined);

/**
 * The hash verdict, read the same way whichever Nexus answered.
 *
 * `false` means "fetched, and the blake2b-256 digest differs" — a fact about
 * the document. Nexus before the hashValid=null fix also sent `false` when it
 * could not fetch the document at all (an IPFS gateway answering 429), which
 * put "hash mismatch" on proposals whose metadata is fine. A mismatch can only
 * be known once the document has been read, so a `false` with no document in
 * hand is that old "could not fetch", and is no verdict.
 */
const hashVerdict = computed<boolean | null>(() => {
  const value = action.value?.hashValid;
  if (value === false && !hasDocument.value) return null;
  return typeof value === 'boolean' ? value : null;
});

/**
 * Why the hash check produced no verdict, when that is knowable.
 *
 * An anchor URL with no verdict AND no document in hand means the document
 * could not be read — a different fact from "the check did not run", and the
 * one the reader can act on (the metadata may be gone, or the host down).
 * When `rawMetadata` IS present a null verdict really is just an unrun check,
 * so the badge keeps its plain "unverified" state.
 */
const anchorFailureReason = computed<'fetchFailed' | null>(() => {
  if (!action.value?.anchorUrl || hashVerdict.value !== null) return null;
  return hasDocument.value ? null : 'fetchFailed';
});

/**
 * Anchor and reference URLs are author-controlled — everything goes through the
 * safe-link mapping: http(s) as written, `ipfs://<cid>` through a public
 * gateway, anything else dropped.
 */
const anchorHref = computed(() => toLinkHref(action.value?.anchorUrl) ?? undefined);

/**
 * What the Overview says when the metadata gave it nothing to show. Null when
 * there is prose. Every action carries an anchor on chain, so "none" is only
 * reached when the projection omits it.
 */
const overviewNotice = computed<string | null>(() => {
  const value = action.value;
  if (!value || value.abstractText || value.motivation || value.rationale) return null;
  if (!value.anchorUrl) return 'governance.anchorNone';
  return hasDocument.value ? 'governance.metadataNoSummary' : 'governance.metadataUnavailable';
});

/** The notice links the document it could not load; the References list then skips it. */
const noticeLinksAnchor = computed(() => !!anchorHref.value && overviewNotice.value === 'governance.metadataUnavailable');
const showAnchorReference = computed(() => !!anchorHref.value && !noticeLinksAnchor.value);

const referenceLinks = computed(() => toReferenceLinks(action.value?.references));

const hasReference = computed(() => hasReferenceIndex(referenceLinks.value));

/** The reference a marker last jumped to, so the entry can be called out without a fragment. */
const jumpedReference = ref<number | null>(null);
const proseRoot = ref<HTMLElement | null>(null);

/**
 * Jump from a `[n]` marker in the prose to its entry in the reference list.
 *
 * Delegated rather than per-marker, because the markers live inside `v-html`
 * and the renderer is forbidden from emitting inline handlers. The markers are
 * `<button>`s, so this fires for a mouse click and for Enter/Space alike, and
 * nothing here touches `location.hash` — a fragment would be read as a route by
 * the hash-mode router and would strand a reloaded tab on the wallet home.
 */
function onProseClick(event: Event): void {
  const index = referenceMarkerIndex(event.target);
  if (index === null) return;
  const target = document.getElementById(referenceElementId(index));
  if (!target) return;
  jumpedReference.value = index;
  // `scrollIntoView` is absent in some test DOMs; the focus move below is the
  // part that actually matters for a keyboard user, so it must not be skipped.
  if (typeof target.scrollIntoView === 'function') {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  target.focus({ preventScroll: true });
}

/**
 * Proposal prose, rendered through the shared escape-first markdown renderer.
 *
 * Anyone can submit a governance action, so these three fields are
 * attacker-controlled. `renderMarkdown` escapes every byte to HTML entities
 * BEFORE applying any markdown rule, which is the only reason `v-html` is safe
 * here — it must never receive anything but this function's output.
 */
function renderProse(source: string | null | undefined): string {
  return source ? renderMarkdown(source, { hasReference: hasReference.value }) : '';
}

const renderedAbstract = computed(() => renderProse(action.value?.abstractText));
const renderedMotivation = computed(() => renderProse(action.value?.motivation));
const renderedRationale = computed(() => renderProse(action.value?.rationale));

/**
 * Whose position the panel should call out.
 *
 * A wallet delegated to its OWN registered DRep votes as itself, and the two
 * read differently ("You have not voted" vs "Your DRep has not voted"), so the
 * kind travels with the id. Derived from state already in hand — this costs no
 * request, and the keyword DReps are handled downstream rather than filtered
 * out here, because "your delegation is a standing position" is itself the
 * honest answer for them.
 */
const voterIdentity = computed<PositionIdentity | null>(() => {
  const status = governanceStatus({
    account: walletStore.account,
    ownDRepIds: walletStore.keys?.drep129,
  });
  if (!status.drepId) return null;
  return { drepId: status.drepId, kind: status.isSelf ? 'self' : 'delegated' };
});

/**
 * Whether that null is a fact or a gap. Without the account there is no
 * `drep_id` to read, so "no delegation" and "not fetched yet" are the same
 * null — and only one of them may be stated to the user.
 */
const identityUnknown = computed(() => !walletStore.account);

const formattedGovAction = computed(() => {
  try {
    return JSON.stringify(action.value?.govAction, null, 2);
  } catch {
    return String(action.value?.govAction);
  }
});

function setTab(next: string): void {
  if (next === tab.value) return;
  router.replace({ query: { ...route.query, tab: next } });
}

function reload(): void {
  governanceActionsStore.loadAction(govActionId.value, network.value);
  // Cached per network for the session, so reading ten actions in a row costs
  // one committee request and a failure costs only the names.
  governanceActionsStore.loadCommittee(network.value);
}

function goBack(): void {
  router.push({ name: 'governanceActions' });
}

function loadVotes(): void {
  governanceActionsStore.loadActionVotes(govActionId.value, network.value);
}

/** Only DReps have a profile page; the row withholds the affordance otherwise. */
function openDRep(drepId: string): void {
  if (!drepId) return;
  router.push({ name: 'governanceDRep', params: { drepId } }).catch(() => undefined);
}

// Votes are loaded lazily, the first time the positions tab is opened. The
// guard is `votesLoaded`, not `currentVotes.length`: an action nobody has voted
// on, and one whose lookup failed, would otherwise both re-fetch on every tab
// switch. Retrying after a failure is the retry button's job.
watch(
  () => tab.value,
  next => {
    if (next === 'positions' && !state.votesLoaded && !state.votesLoading) loadVotes();
  },
);

// Navigating between two actions reuses this view — re-load on param change.
watch(
  () => govActionId.value,
  () => reload(),
);

onMounted(() => {
  reload();
  proseRoot.value?.addEventListener('click', onProseClick);
});

onBeforeUnmount(() => proseRoot.value?.removeEventListener('click', onProseClick));
</script>

<style scoped>
.action-detail {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-4);
}
.action-detail__nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
}
.action-detail__header {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}
.action-detail__badges {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--g-s-2);
}
.action-detail__type {
  color: var(--g-text-3);
}
.action-detail__title {
  margin: 0;
  overflow-wrap: anywhere;
}
.action-detail__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-3);
  color: var(--g-text-3);
}
.action-detail__tabs {
  display: flex;
  gap: var(--g-s-2);
  border-bottom: 1px solid var(--g-hairline-1);
}
.action-detail__tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--g-text-3);
  padding: var(--g-s-2) var(--g-s-3);
  cursor: pointer;
  transition: color var(--g-dur-fast) var(--g-ease), border-color var(--g-dur-fast) var(--g-ease);
}
.action-detail__tab--active {
  color: var(--g-text-1);
  border-bottom-color: var(--g-accent);
}
.action-detail__body {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
}
/* Surface, border and radius all come from `glass-panel` (liquid-glass.css). */
.action-detail__advisory {
  display: flex;
  align-items: flex-start;
  padding: var(--g-s-4);
  color: var(--g-text-2);
}
.action-detail__note {
  margin: 0 0 var(--g-s-1);
  color: var(--g-text-3);
}
/* Prose in the wide track, the rail in a fixed narrow one. The rail track is
   fixed rather than fractional so the measure of the prose does the growing:
   the tally cards read the same at 1200px as at 1600px. */
.action-detail__overview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: var(--g-s-5);
  align-items: start;
}
/* An InfoAction has no tallies and no positions card, so there is no rail and
   nothing to reserve a gutter for. */
.action-detail__overview-grid--single {
  grid-template-columns: minmax(0, 1fr);
}
/* The rail is one vertical stack: DReps, the committee, the SPOs where they
   have a say, then the recorded positions. Sticky, so the tally stays in view
   while a long proposal scrolls past, and scrollable in its own right for the
   three-body actions whose stack is taller than the window. */
.action-detail__rail {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  min-width: 0;
  position: sticky;
  top: var(--g-s-4);
  max-height: calc(100vh - var(--g-s-6));
  overflow-y: auto;
}
/* Side panel, popup, and any narrow window: one column, and the rail moves
   ABOVE the prose. Stacked after it, the tally and the "see the votes" buttons
   would sit below the entire proposal document. Sticky is dropped with it —
   there is no second column left for it to sit beside. */
@media (max-width: 1100px) {
  .action-detail__overview-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .action-detail__rail {
    order: -1;
    position: static;
    max-height: none;
    overflow-y: visible;
  }
}
.action-detail__prose-col {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-5);
  min-width: 0;
}
.action-detail__rail-card {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-4);
}
/* Label left, counts right, in a 300px rail. When the two do not fit on one
   line the counts drop to their own line WHOLE rather than breaking inside a
   figure: the label ellipsizes, and the counts only break between their
   "·"-separated pairs (each "Yes 9" is joined by a no-break space in the
   string itself). */
.action-detail__rail-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-1) var(--g-s-2);
  min-width: 0;
}
.action-detail__rail-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.action-detail__rail-value {
  margin-left: auto;
  color: var(--g-text-2);
  text-align: right;
}
/* Said in place of the prose when the metadata gave the Overview nothing.
   Surface, border and radius come from `glass-panel`. */
.action-detail__notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-4);
  color: var(--g-text-2);
}
.action-detail__withdrawals {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
}
/* One row per recipient: the amount, then who receives it. Hairline rules
   between rows rather than a surface per row — the page itself is the card. */
.action-detail__withdrawal {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-1) var(--g-s-3);
  padding: var(--g-s-2) 0;
  border-bottom: 1px solid var(--g-hairline-1);
}
.action-detail__withdrawal:last-child {
  border-bottom: none;
}
.action-detail__withdrawal-to {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);
  min-width: 0;
  color: var(--g-text-3);
}
.action-detail__section {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}
.action-detail__references {
  margin: 0;
  padding-left: var(--g-s-5);
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}
.action-detail__reference::marker {
  color: var(--g-text-3);
}
/* Jumping from a [n] marker in the prose calls out its entry. Class-driven, not
   `:target`: nothing here writes a fragment into the address bar. */
.action-detail__reference--jumped {
  background: var(--g-raised);
  border-radius: var(--g-r-control);
}
.action-detail__link {
  display: inline-flex;
  align-items: center;
  color: var(--g-text-2);
  text-decoration: none;
  overflow-wrap: anywhere;
}
.action-detail__link:hover {
  color: var(--g-text-1);
}
.action-detail__json {
  margin: 0;
  padding: var(--g-s-3);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
  color: var(--g-text-2);
  overflow-x: auto;
}
</style>
