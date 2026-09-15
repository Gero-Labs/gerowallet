<template>
  <BaseDialog
    :isOpen="isOpen"
    size="xl"
    :min-height="MATCH_DIALOG_HEIGHT"
    :height="MATCH_DIALOG_HEIGHT"
    icon="mdi-account-search-outline"
    :title="t('governance.matchTitle')"
    :subtitle="t('governance.matchSubtitle')"
    @close="$emit('close')"
  >
    <div class="match" :style="{ height: `${matchBodyHeight}px` }">
      <!-- Your priorities -->
      <section class="match__criteria">
        <div class="match__criteria-head">
          <span class="t-label">{{ $t('governance.matchPriorities') }}</span>
          <AsOf :timestamp="fetchedAt" />
        </div>

        <div class="match__toggle">
          <v-switch
            v-model="criteria.participationOn"
            dense
            hide-details
            class="match__switch"
            :label="$t('governance.matchShowsUp')"
          />
          <v-select
            v-if="criteria.participationOn"
            v-model="criteria.participationMin"
            :items="THRESHOLDS"
            dense
            hide-details
            outlined
            attach
            class="match__threshold"
            :menu-props="{ offsetY: true }"
            :aria-label="$t('governance.matchParticipationOver', { pct: criteria.participationMin })"
          />
        </div>

        <div class="match__toggle">
          <v-switch
            v-model="criteria.rationaleOn"
            dense
            hide-details
            class="match__switch"
            :label="$t('governance.matchExplains')"
          />
          <v-select
            v-if="criteria.rationaleOn"
            v-model="criteria.rationaleMin"
            :items="THRESHOLDS"
            dense
            hide-details
            outlined
            attach
            class="match__threshold"
            :menu-props="{ offsetY: true }"
            :aria-label="$t('governance.matchRationaleOver', { pct: criteria.rationaleMin })"
          />
        </div>

        <div class="match__toggle">
          <v-switch
            v-model="criteria.focusOn"
            dense
            hide-details
            class="match__switch"
            :disabled="!focusAvailable"
            :label="$t('governance.matchFocus')"
          />
          <v-select
            v-if="criteria.focusOn && focusAvailable"
            v-model="criteria.focusArea"
            :items="focusItems"
            item-text="label"
            item-value="value"
            dense
            hide-details
            outlined
            attach
            class="match__threshold match__threshold--wide"
            :menu-props="{ offsetY: true }"
            :aria-label="$t('governance.matchFocus')"
          />
        </div>
        <p v-if="!focusAvailable" class="match__note t-caption">{{ $t('governance.matchFocusUnavailable') }}</p>

        <div class="match__toggle">
          <v-switch
            v-model="criteria.outsideTopNOn"
            dense
            hide-details
            class="match__switch"
            :disabled="!cutoffAvailable"
            :label="$t('governance.matchSpreadPower')"
          />
          <span v-if="cutoffAvailable" class="t-caption match__hint">
            {{ $t('governance.matchOutsideTop', { n: TOP_N }) }}
          </span>
        </div>
        <p v-if="!cutoffAvailable" class="match__note t-caption">
          {{ $t('governance.matchTopNUnavailable', { n: TOP_N }) }}
        </p>

        <div class="match__toggle">
          <v-switch
            v-model="criteria.excludeInactiveOn"
            dense
            hide-details
            class="match__switch"
            :label="$t('governance.matchExcludeInactive')"
          />
        </div>

        <!-- Concentration fact -->
        <div class="match__fact">
          <span class="t-label">{{ $t('governance.matchConcentrationTitle') }}</span>
          <template v-if="topShare !== null">
            <span class="match__fact-track" role="img" :aria-label="concentrationLabel">
              <span class="match__fact-fill" :style="{ width: `${topShare}%` }"></span>
            </span>
            <span class="t-body-sm">{{ concentrationLabel }}</span>
            <span class="t-caption">{{ $t('governance.matchConcentrationHint') }}</span>
          </template>
          <span v-else class="t-caption">{{ $t('governance.matchConcentrationPending') }}</span>
        </div>

        <p class="match__footnote t-caption">{{ $t('governance.matchFooterNote') }}</p>
      </section>

      <!-- Results -->
      <section class="match__results">
        <ErrorState v-if="error" :message="error" retryable @retry="load()" />

        <div v-else-if="loading" class="match__cards">
          <v-skeleton-loader v-for="n in 3" :key="n" type="list-item-two-line" />
        </div>

        <template v-else>
          <div class="match__results-head">
            <span class="t-body-sm">
              <b class="match__count g-num">{{ $t('governance.matchPoolCount', { n: result.poolSize }) }}</b>
              <template v-if="shownMatches.length">
                · {{ $t('governance.matchShowing', { n: shownMatches.length }) }}
              </template>
            </span>
            <GButton tier="tertiary" compact @click="reshuffle()">
              <v-icon small left>mdi-shuffle-variant</v-icon>{{ $t('governance.matchReshuffle') }}
            </GButton>
          </div>

          <EmptyState v-if="!shownMatches.length && !nearMiss" :message="t('governance.matchNoResults')" />

          <div class="match__cards">
            <div v-for="entry in shownMatches" :key="cardKey(entry)" class="match__card glass-panel">
              <div class="match__card-id">
                <span class="t-body-lg match__card-name">{{ nameOf(entry) }}</span>
                <span class="t-caption g-mono match__card-code">{{ truncate(entry.stats.drepId || '') }}</span>
                <span class="t-caption g-num">{{ adaOf(entry) }}</span>
                <span v-if="bioOf(entry)" class="t-body-sm match__card-bio">{{ bioOf(entry) }}</span>
              </div>
              <div class="match__card-chips">
                <span class="t-caption match__matches">
                  {{ $t('governance.matchesNofM', { n: passCount(entry), total: activeCount }) }}
                </span>
                <div class="match__chip-row">
                  <span
                    v-for="chip in chipsFor(entry)"
                    :key="chip.name"
                    class="t-caption match__chip"
                    :class="chip.passing ? 'match__chip--pass' : 'match__chip--fail'"
                  >
                    {{ chip.label }}
                  </span>
                </div>
              </div>
              <div class="match__card-actions">
                <GButton
                  tier="secondary"
                  compact
                  :disabled="isCurrentDRep(entry)"
                  @click="$emit('delegate', entry.record)"
                >
                  {{ isCurrentDRep(entry) ? $t('governance.delegated') : $t('governance.delegate') }}
                </GButton>
                <GButton tier="tertiary" compact @click="$emit('open-profile', entry.stats.drepId)">
                  {{ $t('governance.fullRecord') }}
                </GButton>
              </div>
            </div>

            <!-- Near miss: shown alongside, never mixed into the matched pool. -->
            <div v-if="nearMiss" class="match__card match__card--near glass-panel">
              <div class="match__card-id">
                <span class="t-body-lg match__card-name">{{ nameOf(nearMiss) }}</span>
                <span class="t-caption g-mono match__card-code">{{ truncate(nearMiss.stats.drepId || '') }}</span>
                <span class="t-caption g-num">{{ adaOf(nearMiss) }}</span>
              </div>
              <div class="match__card-chips">
                <span class="t-caption match__matches match__matches--near">
                  {{ $t('governance.matchNearMiss') }} ·
                  {{ $t('governance.matchesNofM', { n: passCount(nearMiss), total: activeCount }) }}
                </span>
                <div class="match__chip-row">
                  <span
                    v-for="chip in chipsFor(nearMiss)"
                    :key="chip.name"
                    class="t-caption match__chip"
                    :class="chip.passing ? 'match__chip--pass' : 'match__chip--fail'"
                  >
                    {{ chip.label }}
                  </span>
                </div>
              </div>
              <div class="match__card-actions">
                <GButton
                  tier="secondary"
                  compact
                  :disabled="isCurrentDRep(nearMiss)"
                  @click="$emit('delegate', nearMiss.record)"
                >
                  {{ isCurrentDRep(nearMiss) ? $t('governance.delegated') : $t('governance.delegate') }}
                </GButton>
                <GButton tier="tertiary" compact @click="$emit('open-profile', nearMiss.stats.drepId)">
                  {{ $t('governance.fullRecord') }}
                </GButton>
              </div>
            </div>
          </div>

          <div class="match__why">
            <v-icon small color="var(--g-accent)">mdi-information-outline</v-icon>
            <div>
              <span class="t-body-sm match__why-title">{{ $t('governance.matchWhyThisList') }}</span>
              <p class="t-caption match__why-body">{{ $t('governance.matchWhyThisListBody') }}</p>
              <p class="t-caption match__why-body">{{ $t('governance.matchPoolScope', { n: records.length }) }}</p>
            </div>
          </div>
        </template>
      </section>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import Vue, { computed, onUnmounted, reactive, ref, watch } from 'vue';
import type { PropType } from 'vue';
import { setWalletConfiguration } from '@/db/wallet-db';
import { MATCH_CRITERIA_KEY } from '@/stores/governanceAlertsStore';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import EmptyState from '@/shared/components/feedback/EmptyState.vue';
import ErrorState from '@/shared/components/feedback/ErrorState.vue';
import AsOf from '@/modules/governance/components/actions/AsOf.vue';
import blockchainApi from '@/api/blockchain-api';
import { walletStore } from '@/stores/walletStore';
import { useTranslation } from '@/shared/composables/useTranslation';
import filters from '@/shared/utils/filters';
import networks from '@/utils/networks';
import { debugLog } from '@/utils/debug';
import { drepBio, drepDisplayName, powerConcentration } from '@/shared/utils/drepView';
import { sameDRep } from '@/shared/utils/drepId';
import {
  drepMatch,
  type DRepCriterionName,
  type DRepMatchCriteria,
  type DRepMatchEntry,
} from '@/shared/utils/drepMatch';
import type { DRepRecord, DRepStatsContext } from '@/shared/utils/drepStats';

/**
 * The DRep match panel.
 *
 * Neutrality is the whole design here, so three rules are load bearing:
 *
 *  - Criteria are booleans. There is no weighting and no composite score, so the
 *    panel cannot express "this DRep is better", only "this DRep passes what you
 *    asked for".
 *  - Everything clearing the filters lands in one pool that `drepMatch` shuffles
 *    on a per-user, per-epoch seed. Equal matches get equal exposure, and the
 *    order never reads voting power.
 *  - A criterion the loaded data cannot answer is DISABLED rather than silently
 *    passing or silently failing every DRep. That is why the focus-area and
 *    top-N filters carry availability notes instead of quietly doing nothing.
 *
 * The candidate pool is fetched in the server's natural order. The power-sorted
 * fetch beside it is used ONLY for two denominators (the top-N cutoff and the
 * concentration fact) and never decides who appears in the results.
 */

const props = defineProps({
  isOpen: { type: Boolean, default: false },
  /**
   * The stats context the directory already assembled (eligible actions, type
   * resolver). `topNCutoffPower` is added here from the power reference.
   */
  statsContext: { type: Object as PropType<DRepStatsContext>, default: (): DRepStatsContext => ({}) },
  /** Per-user, per-epoch shuffle seed. Stable within an epoch, different per wallet. */
  seed: { type: String, default: '' },
});

defineEmits<{
  (e: 'close'): void;
  (e: 'delegate', record: DRepRecord): void;
  (e: 'open-profile', drepId: string | null): void;
}>();

const { t } = useTranslation();
const { truncate, toCurrency } = filters;

/** The power boundary the "spread the power" filter uses, and the reference page size. */
const TOP_N = 100;
/** How many of the largest DReps the concentration fact talks about. */
const CONCENTRATION_TOP = 10;
/** How many DReps the pool is drawn from. One page, so one request. */
/**
 * The dialog is a FIXED height, passed as both the card's min and max, so it
 * never resizes with its contents. Reshuffling swaps three cards for three
 * others and the frame must not move underneath the button that did it; the
 * criteria column must not stretch to match a long result list either. Both
 * columns scroll inside this frame instead.
 */
const MATCH_DIALOG_HEIGHT = 680;
/**
 * What the card's own chrome costs above this panel: BaseDialog's `pa-5` top
 * and bottom plus its title/subtitle block. Subtracted rather than measured so
 * the body height is known before first paint and never reflows.
 */
const MATCH_DIALOG_CHROME = 148;
const matchBodyHeight = MATCH_DIALOG_HEIGHT - MATCH_DIALOG_CHROME;

const POOL_SIZE = 100;
/** How many full matches are drawn from the pool at a time. */
const SHOWN = 3;

const THRESHOLDS = [50, 60, 70, 80, 90];

const ACTION_TYPES = [
  'ParameterChange',
  'HardForkInitiation',
  'TreasuryWithdrawals',
  'NoConfidence',
  'NewCommittee',
  'NewConstitution',
  'InfoAction',
] as const;

interface CriteriaState {
  participationOn: boolean;
  participationMin: number;
  rationaleOn: boolean;
  rationaleMin: number;
  focusOn: boolean;
  focusArea: string | null;
  outsideTopNOn: boolean;
  excludeInactiveOn: boolean;
}

function defaults(): CriteriaState {
  return {
    participationOn: true,
    participationMin: 80,
    rationaleOn: true,
    rationaleMin: 60,
    focusOn: false,
    focusArea: null,
    outsideTopNOn: false,
    excludeInactiveOn: true,
  };
}

const criteria = reactive<CriteriaState>(defaults());

// ---------------------------------------------------------------------------
// Persistence.
//
// The saved value is a plain `DRepMatchCriteria` under the wallet-config key
// `governanceMatchCriteria`, because it is a SHARED contract: the delegation
// alerts store reads the same key to decide whether a DRep's rationale rate
// dropping below what this user asked for is worth an alert. Storing this
// panel's UI state (the on/off switches) instead would force that consumer to
// know about switches it has no business knowing about, so the switches are
// derived from the criteria on the way in and collapsed back on the way out:
// a criterion that is off is simply null, exactly as `drepMatch` reads it.
//
// The key itself is owned by the alerts store, which is the other half of that
// contract; importing it is what keeps the two from drifting apart.
// ---------------------------------------------------------------------------

/** The user's intent, ungated by data availability — see `activeCriteria` for the applied set. */
function toStoredCriteria(): DRepMatchCriteria {
  return {
    participationMin: criteria.participationOn ? criteria.participationMin : null,
    rationaleMin: criteria.rationaleOn ? criteria.rationaleMin : null,
    focusArea: criteria.focusOn ? criteria.focusArea : null,
    outsideTopN: criteria.outsideTopNOn ? true : null,
    excludeInactive: criteria.excludeInactiveOn ? true : null,
  };
}

function restore(): void {
  const saved = walletStore.config?.[MATCH_CRITERIA_KEY];
  if (!saved || typeof saved !== 'object') return;
  const base = defaults();
  const stored = saved as DRepMatchCriteria;

  // Validated field by field: a blob written by an older build must never
  // inject an out-of-range threshold or an unknown action type into a filter.
  const participation = Number(stored.participationMin);
  criteria.participationOn = THRESHOLDS.includes(participation);
  criteria.participationMin = criteria.participationOn ? participation : base.participationMin;

  const rationale = Number(stored.rationaleMin);
  criteria.rationaleOn = THRESHOLDS.includes(rationale);
  criteria.rationaleMin = criteria.rationaleOn ? rationale : base.rationaleMin;

  const focus = String(stored.focusArea ?? '');
  criteria.focusOn = (ACTION_TYPES as readonly string[]).includes(focus);
  criteria.focusArea = criteria.focusOn ? focus : base.focusArea;

  criteria.outsideTopNOn = stored.outsideTopN === true;
  criteria.excludeInactiveOn = stored.excludeInactive === true;
}

let writeTimer: ReturnType<typeof setTimeout> | null = null;

function persist(): void {
  const walletId = walletStore.loggedWallet?.id;
  if (typeof walletId !== 'number' || !walletStore.config) return;
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    const value = toStoredCriteria();
    // Vue.set, not assignment: the config bag is a plain object and this key is
    // new on first write, so a bare assignment would not be reactive for the
    // alerts store watching it.
    Vue.set(walletStore.config, MATCH_CRITERIA_KEY, value);
    void setWalletConfiguration(walletId, MATCH_CRITERIA_KEY, value);
  }, 300);
}

watch(criteria, () => persist(), { deep: true });

onUnmounted(() => {
  if (writeTimer) clearTimeout(writeTimer);
});

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const records = ref<DRepRecord[]>([]);
const powerReference = ref<DRepRecord[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const fetchedAt = ref<number | null>(null);
const shuffleNonce = ref(0);

async function load(): Promise<void> {
  const wallet = walletStore.loggedWallet;
  if (!wallet) return;
  loading.value = true;
  error.value = null;
  try {
    const [pool, power] = await Promise.all([
      blockchainApi.getDRepsPaginated({ page: 1, per_page: POOL_SIZE }, wallet.chain, wallet.network),
      blockchainApi.getDRepsPaginated(
        { page: 1, per_page: TOP_N, sort_by: 'voting_power', sort_direction: 'desc' },
        wallet.chain,
        wallet.network,
      ),
    ]);
    records.value = (pool?.items ?? []) as DRepRecord[];
    powerReference.value = (power?.items ?? []) as DRepRecord[];
    fetchedAt.value = Date.now();
  } catch (err) {
    debugLog('MatchPanel: pool load failed', err);
    error.value = err instanceof Error ? err.message : String(t('errors.unknownError'));
    records.value = [];
    powerReference.value = [];
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.isOpen,
  open => {
    if (!open) return;
    restore();
    if (!records.value.length) void load();
  },
  { immediate: true },
);

// ---------------------------------------------------------------------------
// Denominators
// ---------------------------------------------------------------------------

const concentration = computed(() => powerConcentration(powerReference.value, CONCENTRATION_TOP));
const cutoff = computed(() => powerConcentration(powerReference.value, TOP_N));

/**
 * The cutoff is only a real "top 100" boundary if the server honoured the sort.
 * `sortedDesc` is that proof; without it the number would describe an arbitrary
 * page and the filter would be a lie, so it stays unavailable.
 */
const cutoffAvailable = computed(() => cutoff.value.sortedDesc && cutoff.value.cutoffPower !== null);
const topShare = computed(() => concentration.value.topShare);

const concentrationLabel = computed(() =>
  String(
    t('governance.matchConcentrationFact', {
      sample: concentration.value.sampleSize,
      top: CONCENTRATION_TOP,
      pct: topShare.value ?? 0,
    }),
  ),
);

const focusAvailable = computed(() => typeof props.statsContext?.typeResolver === 'function');

const focusItems = computed(() =>
  ACTION_TYPES.map(type => {
    const key = `governance.actionType.${type.toLowerCase()}`;
    const label = String(t(key));
    return { value: type, label: label === key ? type : label };
  }),
);

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

const activeCriteria = computed(() => ({
  participationMin: criteria.participationOn ? criteria.participationMin : null,
  rationaleMin: criteria.rationaleOn ? criteria.rationaleMin : null,
  focusArea: criteria.focusOn && focusAvailable.value ? criteria.focusArea : null,
  outsideTopN: criteria.outsideTopNOn && cutoffAvailable.value ? true : null,
  excludeInactive: criteria.excludeInactiveOn ? true : null,
}));

const result = computed(() =>
  drepMatch(activeCriteria.value, records.value, {
    ...props.statsContext,
    topNCutoffPower: cutoffAvailable.value ? cutoff.value.cutoffPower : undefined,
    // The nonce only changes when the user asks for a reshuffle, so the order is
    // otherwise stable for this wallet within the epoch.
    seed: `${props.seed}:${shuffleNonce.value}`,
  }),
);

const activeCount = computed(() => result.value.activeCriteria.length);
const shownMatches = computed(() => result.value.matches.slice(0, SHOWN));
const nearMiss = computed(() => result.value.nearMisses[0] ?? null);

function reshuffle(): void {
  shuffleNonce.value += 1;
}

function cardKey(entry: DRepMatchEntry): string {
  return entry.stats.credentialHex ?? entry.stats.drepId ?? String(entry.record?.hex ?? '');
}

function nameOf(entry: DRepMatchEntry): string {
  return drepDisplayName(entry.record) ?? truncate(entry.stats.drepId ?? '');
}

function bioOf(entry: DRepMatchEntry): string | null {
  return drepBio(entry.record);
}

function adaOf(entry: DRepMatchEntry): string {
  const wallet = walletStore.loggedWallet;
  return toCurrency(
    entry.stats.votingPower.toString(),
    false,
    2,
    networks.resolveCurrencySymbol(wallet?.chain, wallet?.network),
    '',
    true,
  );
}

/**
 * The DRep this wallet is already delegated to. Re-delegating to them builds a
 * transaction that changes nothing, so the card says so rather than offering a
 * button whose handler silently returns.
 */
function isCurrentDRep(entry: DRepMatchEntry): boolean {
  return sameDRep(entry.stats.drepId, walletStore.account?.drep_id);
}

function passCount(entry: DRepMatchEntry): number {
  return activeCount.value - entry.failing.length;
}

interface CriterionChip {
  name: DRepCriterionName;
  label: string;
  passing: boolean;
}

/**
 * One chip per ACTIVE criterion, stating the DRep's actual figure. A failing
 * criterion is greyed and still shows its number — hiding it would leave the
 * user unable to see how close the near miss was.
 */
function chipsFor(entry: DRepMatchEntry): CriterionChip[] {
  const { stats } = entry;
  const pending = String(t('governance.pendingStat'));
  return result.value.activeCriteria.map(name => {
    const passing = !entry.failing.includes(name);
    let label = '';
    switch (name) {
      case 'participationMin':
        label =
          stats.participation.pct === null
            ? pending
            : String(t('governance.matchChipParticipation', { pct: stats.participation.pct }));
        break;
      case 'rationaleMin':
        label =
          stats.rationaleRate.pct === null
            ? pending
            : String(t('governance.matchChipRationale', { pct: stats.rationaleRate.pct }));
        break;
      case 'focusArea': {
        const wanted = String(criteria.focusArea ?? '');
        const area = (stats.focusAreas ?? []).find(a => a.type.toLowerCase() === wanted.toLowerCase());
        const typeLabel = focusItems.value.find(i => i.value === wanted)?.label ?? wanted;
        label = area
          ? String(t('governance.matchChipFocus', { n: area.voted, type: typeLabel }))
          : String(t('governance.matchChipFocus', { n: 0, type: typeLabel }));
        break;
      }
      case 'outsideTopN':
        label = String(t('governance.matchChipOutsideTop', { n: TOP_N }));
        break;
      case 'excludeInactive':
        label = String(t('governance.matchChipActive'));
        break;
      default:
        label = String(name);
    }
    return { name, label, passing };
  });
}
</script>

<style scoped>
.match {
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr);
  gap: var(--g-s-4);
  padding: 0 var(--g-s-4) var(--g-s-4);
  /* Height is bound inline from MATCH_DIALOG_HEIGHT, not inherited: Vuetify
     detaches the dialog card to [data-app], so a scoped deep selector cannot
     reliably reach it to make it a flex parent. An explicit height is the one
     thing that holds regardless of where the card lives in the DOM. */
  min-height: 0;
}
@media (max-width: 900px) {
  .match {
    grid-template-columns: minmax(0, 1fr);
    /* Single column: one scroll context for the whole panel. */
    overflow-y: auto;
    overscroll-behavior: contain;
  }
}
.match__criteria {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  padding: var(--g-s-4);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
}
@media (min-width: 901px) {
  /* `min-height: 0` lets a grid child shrink below its content; without it both
     columns would grow and stretch the frame. */
  .match__criteria,
  .match__results {
    min-height: 0;
  }
  /* The criteria column scrolls: it is a settings list, and its length is fixed
     and knowable. */
  .match__criteria {
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  /* The results column does NOT. At most four cards can appear here — three
     matches plus one near miss — and the frame is sized so all four fit. A
     scrollbar on results reads as "there is more below", which was never true:
     the count line already says how many there are, so scrolling only ever hid
     the last card the reader had asked to see. */
  .match__results {
    overflow: hidden;
  }
}
.match__criteria-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-2);
}
.match__toggle {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}
.match__switch {
  margin: 0;
  padding: 0;
  flex: 1;
  min-width: 0;
}
.match__threshold {
  width: 88px;
  flex: none;
}
.match__threshold--wide {
  width: 148px;
}
.match__hint {
  flex: none;
}
.match__note {
  margin: 0;
  color: var(--g-text-3);
}
.match__fact {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  margin-top: var(--g-s-2);
  padding: var(--g-s-3);
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
}
.match__fact-track {
  display: block;
  height: var(--g-s-2);
  border-radius: var(--g-r-pill);
  background: var(--g-overlay);
  overflow: hidden;
}
.match__fact-fill {
  display: block;
  height: 100%;
  background: var(--g-warning);
  transition: width var(--g-dur-base) var(--g-ease);
}
.match__footnote {
  margin: var(--g-s-3) 0 0;
  padding-top: var(--g-s-3);
  border-top: 1px solid var(--g-hairline-1);
}
.match__results {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  min-width: 0;
}
.match__results-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-2);
}
.match__count {
  color: var(--g-text-1);
}
.match__cards {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  /* Stacked from the top and never stretched: with one match, the single card
     keeps its own height instead of growing to fill the column. */
  flex: none;
  min-height: 0;
}
.match__card {
  display: grid;
  grid-template-columns: minmax(0, 240px) minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--g-s-4);
  padding: var(--g-s-3) var(--g-s-4);
  border-radius: var(--g-r-card);
}
@media (max-width: 900px) {
  .match__card {
    grid-template-columns: minmax(0, 1fr);
  }
}
.match__card--near {
  border-style: dashed;
}
.match__card-id {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  min-width: 0;
}
.match__card-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.match__card-code {
  overflow: hidden;
  text-overflow: ellipsis;
}
.match__card-bio {
  color: var(--g-text-3);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.match__card-chips {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  min-width: 0;
}
.match__matches {
  color: var(--g-success);
}
.match__matches--near {
  color: var(--g-text-2);
}
.match__chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-1);
}
.match__chip {
  display: inline-flex;
  align-items: center;
  padding: 0 var(--g-s-2);
  border-radius: var(--g-r-chip);
  border: 1px solid var(--g-hairline-2);
  color: var(--g-text-3);
}
/* The criterion this DRep did not meet. It still shows its real figure -- hiding
   it would leave the user unable to see how close a near miss came. */
.match__chip--fail {
  color: var(--g-text-3);
  background: var(--g-raised);
  border-color: var(--g-hairline-2);
}
.match__chip--pass {
  color: var(--g-success);
  background: var(--g-success-fill);
  border-color: var(--g-success-line);
}
.match__card-actions {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--g-s-1);
}
.match__why {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-2);
  padding: var(--g-s-3);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
}
.match__why-title {
  color: var(--g-text-1);
}
.match__why-body {
  margin: var(--g-s-1) 0 0;
}
</style>
