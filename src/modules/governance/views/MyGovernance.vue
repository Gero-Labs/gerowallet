<template>
  <div class="my-governance">
    <!-- Header -->
    <div class="my-governance__header">
      <div class="my-governance__headline">
        <span class="t-label">{{ $t('navigation.governance') }}</span>
        <h1 class="t-display">{{ $t('navigation.governanceMe') }}</h1>
        <p class="t-body my-governance__subtitle">{{ $t(subtitleKey) }}</p>
      </div>
      <!-- The two ways off this page. `AsOf` used to sit here too, stamping the
           header with a freshness the header does not carry — the stamp belongs
           on the voting record, which is the thing that was fetched, and it is
           still there. -->
      <div class="my-governance__header-side">
        <GButton tier="secondary" compact @click="goToDReps()">
          <v-icon left size="16" color="var(--g-accent)">mdi-account-group-outline</v-icon>
          {{ $t('governance.browseDReps') }}
        </GButton>
        <GButton tier="secondary" compact @click="goToActions()">
          <v-icon left size="16" color="var(--g-accent)">mdi-gavel</v-icon>
          {{ $t('governance.actionsTitle') }}
        </GButton>
      </div>
    </div>

    <ErrorState v-if="error" :message="error" retryable @retry="loadDRep()" />

    <template v-else-if="loading">
      <v-skeleton-loader type="image" class="my-governance__skeleton" />
      <v-skeleton-loader type="list-item-three-line" />
    </template>

    <!-- Two columns: what this wallet's stake is doing on the left, everything
         that reads ALONGSIDE that on the right. The watchdog, the legend and the
         DRep pitch are all commentary on the hero, so none of them earns a
         full-width row of its own. -->
    <div v-else class="my-governance__grid">
      <div class="my-governance__main">
        <!-- ── The state hero ───────────────────────────────────────────── -->
        <div class="my-governance__hero glass-panel" :class="`my-governance__hero--${status.tone}`">
          <!-- A submitted delegation the chain has not confirmed yet.
               Deliberately a QUALIFIER rather than a status of its own: the state
               below is still the one in force, and replacing it would trade one
               false impression for another. This only says why it has not moved. -->
          <div v-if="delegationPending" class="my-governance__pending" role="status">
            <v-progress-circular indeterminate size="16" width="2" color="var(--g-accent)" />
            <span class="my-governance__pending-text">
              <span class="t-body-sm my-governance__pending-title">
                {{ $t('governance.delegationPendingTitle') }}
              </span>
              <span class="t-caption">{{ $t('governance.delegationPendingHint') }}</span>
            </span>
          </div>

          <div class="my-governance__hero-top">
            <div class="my-governance__hero-headline">
              <span class="t-label">{{ $t('governance.yourVotingStatus') }}</span>
              <div class="my-governance__hero-title">
                <span class="my-governance__dot" :class="`my-governance__dot--${status.tone}`"></span>
                <span class="t-title">{{ $t(status.titleKey) }}</span>
              </div>
              <p class="t-body my-governance__hero-copy">{{ $t(status.descriptionKey) }}</p>
            </div>

            <!-- Who holds the vote, or what is being held back -->
            <div v-if="status.drepId" class="my-governance__drep-chip">
              <!-- The DRep's own published avatar. Fixed size in every state, so
                   a slow or dead image never moves the chip. -->
              <DRepAvatar :image-url="drepImageSource" :name="drepName" :size="28" />
              <span class="my-governance__drep-ident">
                <span class="t-body-sm my-governance__drep-name">{{ drepName }}</span>
                <span v-if="!keywordNameKey" class="t-caption g-mono my-governance__drep-id">{{ truncate(status.drepId) }}</span>
              </span>
            </div>
            <div v-else-if="status.withdrawalsBlocked" class="my-governance__locked">
              <span class="my-governance__locked-icon">
                <v-icon size="18" color="var(--g-error)">mdi-lock-outline</v-icon>
              </span>
              <span class="my-governance__locked-body">
                <span class="t-label">{{ $t('staking.rewardsAmount') }}</span>
                <span class="t-title g-num">{{ lockedRewardsDisplay }}</span>
                <span class="t-caption my-governance__locked-note">{{ $t('governance.withdrawalLocked') }}</span>
              </span>
              <!-- Attempting the withdrawal is what raises the gate: useWithdrawal
                   stops at the CIP-1694 check and the dialog explains the two
                   ways out, instead of the user meeting the rule at signing. -->
              <GButton tier="tertiary" compact @click="withdraw()">{{ $t('staking.withdraw') }}</GButton>
            </div>
          </div>

          <p v-if="status.recordAvailable" class="t-body my-governance__hero-summary">
            {{ $t('governance.representedSummary', { amount: votingPowerDisplay, votes: formatInt(health.voteCount) }) }}
          </p>

          <!-- Health strip: every number below comes from the DRep's own record -->
          <div v-if="status.recordAvailable" class="my-governance__health">
            <div class="my-governance__tile">
              <span class="t-label">{{ $t('governance.rationaleRecent', { n: health.recentWindow }) }}</span>
              <span class="t-heading g-num">{{ rationaleRecentDisplay }}</span>
              <span class="t-caption">{{ rationaleLongRunDisplay }}</span>
            </div>
            <div class="my-governance__tile">
              <span class="t-label">{{ $t('governance.lastVote') }}</span>
              <span class="t-heading g-num">{{ lastVoteDisplay }}</span>
              <!-- No caption at all when the countdown is unknown: see
                   activityDisplay. A tile may show less; it may not imply more. -->
              <span v-if="activityDisplay" class="t-caption">{{ activityDisplay }}</span>
            </div>
            <div class="my-governance__tile">
              <span class="t-label">{{ $t('governance.votes') }}</span>
              <span class="t-heading g-num">{{ formatInt(health.voteCount) }}</span>
              <span v-if="expiresDisplay" class="t-caption">{{ expiresDisplay }}</span>
            </div>
          </div>

          <div v-if="heroCta" class="my-governance__hero-actions">
            <GButton :tier="heroCtaTier" @click="heroCta.run()">{{ $t(heroCta.labelKey) }}</GButton>
          </div>
        </div>

        <!-- ── Managing the position the hero just described ───────────────
             Directly under the hero, and paired. The page used to read
             state + CTA -> history -> more actions, which put the controls for
             changing a delegation below six rows of what the DRep did. State,
             then what you can do about it, then the evidence. Two cards side by
             side rather than two full-width slabs: they are one control group.
             Placed BEFORE the registeredNoDRep block on purpose — the record
             below is that block's `v-else`, and anything inserted between them
             would steal it. Both are hidden in that state anyway. -->
        <div class="my-governance__manage">
        <!-- ── Already delegated: the ways to change it ──────────────────── -->
        <!-- There is no "undelegate" in CIP-1694. Once a stake key carries a
             vote delegation the only certificate that removes it is one that
             REPLACES it, so stepping back from a DRep means choosing Abstain.
             Offering a button labelled "undelegate" would promise a state the
             ledger does not have; these are the three that exist. -->
        <section v-if="canChangeDelegation && !delegationPending" class="my-governance__change glass-panel">
          <div class="my-governance__manage-head">
            <span class="my-governance__manage-icon">
              <v-icon size="18" color="var(--g-accent)">mdi-account-switch-outline</v-icon>
            </span>
            <span class="t-label my-governance__manage-title">{{ $t('governance.changeDelegationTitle') }}</span>
            <!-- The mechanics live behind this rather than on the card. A real
                 button, not an icon with a hover handler: it must be reachable
                 by keyboard and carry the baseline focus ring. -->
            <v-tooltip bottom max-width="320" content-class="glass-popover">
              <template #activator="{ on, attrs }">
                <button
                  type="button"
                  class="my-governance__manage-info"
                  v-bind="attrs"
                  :aria-label="String($t('common.learnMore'))"
                  v-on="on"
                >
                  <v-icon size="14">mdi-information-outline</v-icon>
                </button>
              </template>
              <span class="t-body-sm">{{ $t('governance.changeDelegationHint') }}</span>
              <span class="t-body-sm">{{ $t('governance.changeDelegationNote') }}</span>
            </v-tooltip>
          </div>

          <!-- The card's own state line, matching the support card's. Without it
               the card was a title and a row of buttons with a hole between
               them, and it said nothing about what your stake is doing now. -->
          <p class="t-body-lg my-governance__manage-state">
            {{ $t('governance.changeCurrentDrep', { name: drepName }) }}
          </p>

          <div class="my-governance__change-row">
            <GButton tier="secondary" block @click="goToDReps()">
              <v-icon left size="16" color="var(--g-accent)">mdi-account-search-outline</v-icon>
              {{ $t('governance.changeToAnotherDRep') }}
            </GButton>
            <GButton
              tier="secondary"
              block
              :disabled="isAbstaining"
              :loading="building === 'drep_always_abstain'"
              @click="delegateToPredefined('abstain')"
            >
              <v-icon left size="16" color="var(--g-text-3)">mdi-minus-circle-outline</v-icon>
              {{ isAbstaining ? $t('governance.alreadyAbstaining') : $t('governance.stepBackToAbstain') }}
            </GButton>
            <GButton
              tier="secondary"
              block
              :disabled="isNoConfidence"
              :loading="building === 'drep_always_no_confidence'"
              @click="delegateToPredefined('noConfidence')"
            >
              <v-icon left size="16" color="var(--g-warning)">mdi-close-circle-outline</v-icon>
              {{ isNoConfidence ? $t('governance.alreadyNoConfidence') : $t('governance.chooseNoConfidence') }}
            </GButton>
          </div>

        </section>

        <!-- ── CIP-149: a share of each withdrawal, sent to your DRep ──────── -->
        <!-- Only for a real DRep. The two predefined choices are not people and
             have nowhere to receive anything, and a wallet delegated to its own
             key would be paying itself. -->
        <section v-if="showsSupport" class="my-governance__support glass-panel">
          <!-- One icon, and it carries the STATE: accent while a share is going
               out, muted while none is. A second decorative icon beside it would
               say nothing the words do not. -->
          <div class="my-governance__manage-head">
            <span class="my-governance__manage-icon" :class="{ 'my-governance__manage-icon--off': !supportingNow }">
              <v-icon size="18" :color="supportingNow ? 'var(--g-accent)' : 'var(--g-text-3)'">
                {{ supportingNow ? 'mdi-gift-outline' : 'mdi-gift-off-outline' }}
              </v-icon>
            </span>
            <span class="t-label my-governance__manage-title">{{ $t('governance.supportTitle') }}</span>
            <v-tooltip bottom max-width="320" content-class="glass-popover">
              <template #activator="{ on, attrs }">
                <button
                  type="button"
                  class="my-governance__manage-info"
                  v-bind="attrs"
                  :aria-label="String($t('common.learnMore'))"
                  v-on="on"
                >
                  <v-icon size="14">mdi-information-outline</v-icon>
                </button>
              </template>
              <span class="t-body-sm">{{ $t('governance.supportHint') }}</span>
              <span class="t-body-sm">{{ $t('governance.supportTxNote') }}</span>
            </v-tooltip>
          </div>

          <div class="my-governance__support-state">
            <span class="my-governance__support-body">
              <span class="t-body-lg">
                {{
                  supportingNow
                    ? $t('governance.supportOnAt', { percent: supportPercentDisplay, name: drepName })
                    : $t('governance.supportOff')
                }}
              </span>
              <!-- The rate is a commitment to send, not proof anything arrives:
                   the withdrawal builder drops the donation output when the DRep
                   published no payment address, and says nothing when it does.
                   Stated here rather than discovered later. -->
              <span v-if="supportingNow && !drepCanReceive" class="t-caption my-governance__support-warn">
                <v-icon size="14" color="var(--g-warning)">mdi-alert-outline</v-icon>
                {{ $t('governance.supportNoPayoutAddress') }}
              </span>
            </span>
          </div>

          <div class="my-governance__support-row">
            <GButton tier="secondary" block @click="openSupportDialog()">
              <v-icon left size="16" color="var(--g-accent)">mdi-gift-outline</v-icon>
              {{ supportingNow ? $t('governance.supportChange') : $t('governance.supportStart') }}
            </GButton>
            <GButton v-if="supportingNow" tier="tertiary" block @click="openSupportDialog()">
              {{ $t('governance.supportStop') }}
            </GButton>
          </div>

        </section>
        </div>

        <!-- ── Registered but undelegated: the three ways to unlock ───────── -->
        <!-- Not while a delegation is in flight. These three cards are a prompt
             to take a position, and showing them over a submitted certificate
             asks the user to do the thing they just did — the exact complaint
             this fixes. The hero's qualifier above carries the state instead. -->
        <template v-if="status.status === 'registeredNoDRep' && !delegationPending">
          <div class="my-governance__choices">
            <div class="my-governance__choice my-governance__choice--featured glass-panel">
              <div class="my-governance__choice-top">
                <span class="my-governance__choice-icon">
                  <v-icon size="18" color="var(--g-accent)">mdi-account-check-outline</v-icon>
                </span>
                <span class="my-governance__badge t-caption">{{ $t('governance.unlocksWithdrawals') }}</span>
              </div>
              <span class="t-heading">{{ $t('governance.delegateToADRep') }}</span>
              <p class="t-body-sm my-governance__choice-copy">{{ $t('governance.delegateChoiceDesc') }}</p>
              <p class="t-caption my-governance__choice-note">{{ $t('governance.delegateChoiceNote') }}</p>
              <GButton tier="primary" block class="my-governance__choice-cta" @click="goToDReps()">
                {{ $t('governance.browseDReps') }}
              </GButton>
            </div>

            <div class="my-governance__choice glass-panel">
              <div class="my-governance__choice-top">
                <span class="my-governance__choice-icon">
                  <v-icon size="18" color="var(--g-text-3)">mdi-minus-circle-outline</v-icon>
                </span>
                <span class="my-governance__badge t-caption">{{ $t('governance.unlocksWithdrawals') }}</span>
              </div>
              <span class="t-heading">{{ $t('governance.alwaysAbstain') }}</span>
              <p class="t-body-sm my-governance__choice-copy">{{ $t('governance.abstainChoiceDesc') }}</p>
              <p class="t-caption my-governance__choice-note">{{ $t('governance.abstainChoiceNote') }}</p>
              <GButton tier="secondary" block class="my-governance__choice-cta" @click="delegateToPredefined('abstain')">
                {{ $t('governance.chooseAbstain') }}
              </GButton>
            </div>

            <div class="my-governance__choice glass-panel">
              <div class="my-governance__choice-top">
                <span class="my-governance__choice-icon">
                  <v-icon size="18" color="var(--g-text-3)">mdi-close-circle-outline</v-icon>
                </span>
                <span class="my-governance__badge t-caption">{{ $t('governance.unlocksWithdrawals') }}</span>
              </div>
              <span class="t-heading">{{ $t('governance.alwaysNoConfidence') }}</span>
              <p class="t-body-sm my-governance__choice-copy">{{ $t('governance.noConfidenceChoiceDesc') }}</p>
              <p class="t-caption my-governance__choice-note">{{ $t('governance.noConfidenceChoiceNote') }}</p>
              <GButton tier="secondary" block class="my-governance__choice-cta" @click="delegateToPredefined('noConfidence')">
                {{ $t('governance.chooseNoConfidence') }}
              </GButton>
            </div>
          </div>

          <div class="my-governance__honesty">
            <v-icon size="16" color="var(--g-accent)">mdi-information-outline</v-icon>
            <p class="t-body-sm my-governance__honesty-text">{{ $t('governance.threeChoicesHonesty') }}</p>
          </div>
        </template>

        <!-- ── Delegated: what the stake actually did ──────────────────── -->
        <div v-else class="my-governance__record glass-panel">
          <div class="my-governance__record-head">
            <span class="t-label">{{ $t('governance.howYourStakeWasCast') }}</span>
            <AsOf :timestamp="fetchedAt" />
          </div>

          <!-- True for a DRep that has never voted AND for the two predefined
               choices, which have no record to show and never will. -->
          <EmptyState
            v-if="!recentVotes.length"
            icon="mdi-vote-outline"
            :message="$t('governance.noVotesYet')"
          />

          <div v-else class="my-governance__rows">
            <div v-for="vote in recentVotes" :key="vote.key" class="my-governance__row">
              <span v-if="vote.typeLabel" class="t-label my-governance__row-type">{{ vote.typeLabel }}</span>
              <!-- The action, by its NAME. The id is the fallback, never the
                   headline: a truncated hash tells the reader nothing about what
                   their stake was cast on. A button rather than a clickable row,
                   so it is reachable by keyboard and the rationale control below
                   is not nested inside another control. -->
              <button
                v-if="vote.route"
                type="button"
                class="t-body-sm my-governance__row-title my-governance__row-link"
                @click="openAction(vote.route)"
              >
                {{ vote.title }}
              </button>
              <span v-else class="t-body-sm my-governance__row-title">{{ vote.title }}</span>

              <button
                v-if="vote.metaUrl"
                type="button"
                class="my-governance__rationale t-caption"
                @click="openRationale(vote)"
              >
                {{ $t('governance.rationaleAttached') }}
              </button>
              <span class="my-governance__vote t-caption" :class="`my-governance__vote--${vote.tone}`">
                {{ $t(vote.labelKey) }}
              </span>
              <span class="t-caption my-governance__row-when">{{ vote.when }}</span>
            </div>
          </div>

          <p class="t-caption my-governance__record-note">{{ $t('governance.onlyCastVotesCount') }}</p>
        </div>

      </div>

      <aside class="my-governance__side">
        <!-- alerts-panel: wired by delegation-alerts. Renders nothing at all
             when there is no DRep to watch, so it is safe here unconditionally. -->
        <DelegationAlertsPanel />

        <!-- What each state means: the legend the status hero is read against -->
        <div class="my-governance__legend glass-panel">
          <span class="t-label">{{ $t('governance.statusHelpTitle') }}</span>
          <div v-for="entry in legend" :key="entry.key" class="my-governance__legend-row">
            <span class="my-governance__dot my-governance__dot--small" :class="`my-governance__dot--${entry.tone}`"></span>
            <span class="my-governance__legend-body">
              <span class="t-body-sm my-governance__legend-title">{{ $t(`${entry.key}.title`) }}</span>
              <span class="t-caption">{{ $t(`${entry.key}.description`) }}</span>
            </span>
          </div>
          <p class="t-caption my-governance__legend-foot">
            {{ $t('common.learnMore') }}
            <a class="my-governance__link" :href="GOV_TOOLS_URL" target="_blank" rel="noopener noreferrer">{{ $t('governance.govToolsLink') }}</a>
            <span class="my-governance__sep">·</span>
            <a class="my-governance__link" :href="CIP_1694_URL" target="_blank" rel="noopener noreferrer">{{ $t('governance.cip1694') }}</a>
          </p>
        </div>

        <!-- Become a DRep. Hidden when the wallet already is one. -->
        <!-- Registration rides the voting sub-flag, because it posts a deposit
             and a certificate on chain. Offering the card without it produced a
             button that bounced off the router's own gate straight back to the
             dashboard: every OTHER way in (nav drawer, global search, the vote
             CTAs) already checked the flag, and only this one did not. -->
        <div
          v-if="status.status !== 'selfDRep' && registrationAvailable"
          class="my-governance__promo glass-panel"
        >
          <span class="my-governance__choice-icon">
            <v-icon size="20" color="var(--g-accent)">mdi-shield-check-outline</v-icon>
          </span>
          <span class="t-heading">{{ $t('governance.representYourself') }}</span>
          <p class="t-body-sm my-governance__choice-copy">{{ $t('governance.representYourselfDesc') }}</p>
          <ul class="my-governance__bullets">
            <li class="t-caption">{{ $t('governance.keysNeverLeaveWallet') }}</li>
            <li class="t-caption">{{ $t('governance.publicProfileSigned') }}</li>
            <li class="t-caption">{{ $t('governance.retireAnyTime') }}</li>
          </ul>
          <!-- Always secondary: this card renders in the delegated states,
               where the alerts panel above owns the screen's one gradient. -->
          <GButton tier="secondary" block class="my-governance__choice-cta" @click="goToRegister()">
            {{ $t('navigation.becomeDRep') }}
          </GButton>
        </div>
      </aside>
    </div>

    <WithdrawGateDialog :is-open="withdrawalBlocked" @close="closeWithdrawalDialog()" />

    <!-- The certificate is signed HERE now. Hardware, PassKey and Keystone all
         live inside this dialog, which is why the choice used to be routed to
         the directory to be made; there is no reason the reader has to travel
         to change their own delegation. -->
    <DRepDelegateDialog :isOpen="isDialogOpen" :drep="selectedDRep" :tx="tx" @close="closeDialog()" />
    <!-- Mounted only while open: opening it is what sends the request, and a
         request to an author's host must follow a click, never a render. -->
    <RationaleDialog
      v-if="rationaleOpen"
      :is-open="rationaleOpen"
      :url="rationaleUrl"
      :hash="rationaleHash"
      :action-title="rationaleTitle"
      @close="closeRationale()"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * The governance home: what THIS wallet's stake is doing, and how to change it.
 *
 * Everything on the page hangs off ONE derived state (`useGovernanceStatus`)
 * so the hero, the tone and the call to action can never disagree with each
 * other — which is exactly what happened when each card decided for itself.
 *
 * The only fetch here is the delegated DRep's record, once on mount. Every
 * number read off it is stamped with `AsOf`, because it comes from a synced
 * index rather than live chain, and every "n/a" below is a real absence: a
 * DRep with no votes has no rationale rate, and printing 0% would accuse them
 * of withholding rationales nobody asked for.
 */
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router/composables';
import { walletStore } from '@/stores/walletStore';
import NetworkStore, { networkStore } from '@/stores/networkStore';
import governanceActionsStore from '@/stores/governanceActionsStore';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import {
  applyGovernanceHydration,
  fetchDelegatedDRepRecord,
} from '@/shared/composables/useGovernanceHydration';
import { KEYWORD_DREPS } from '@/shared/utils/drepId';
import { drepPayoutAddress } from '@/modules/governance/utils/govAnchor';
import { useGovernanceStatus } from '@/shared/composables/useGovernanceStatus';
import { usePendingVoteDelegation } from '@/shared/composables/usePendingVoteDelegation';
import { governanceStore } from '@/stores/governanceStore';
import type { DelegatedDRepRecord, DRepVoteRecord } from '@/shared/composables/useDelegationHealth';
import { useWithdrawal } from '@/shared/composables/useWithdrawal';
import DelegationAlertsPanel from '@/modules/governance/components/alerts/DelegationAlertsPanel.vue';
import DRepAvatar from '@/modules/governance/components/dreps/DRepAvatar.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { formatInt } from '@/shared/utils/format';
import filters from '@/shared/utils/filters';
import networks from '@/utils/networks';
import { debugLog } from '@/utils/debug';
import { canonicalActionKey } from '@/shared/utils/drepView';
import { parseGovActionId, type GovActionId } from '@/shared/utils/govActionId';
import AsOf from '@/modules/governance/components/actions/AsOf.vue';
import WithdrawGateDialog from '@/modules/governance/dialogs/WithdrawGateDialog.vue';
import DRepDelegateDialog from '@/modules/governance/dialogs/DRepDelegateDialog.vue';
import { useDRepDelegation } from '@/modules/governance/composables/useDRepDelegation';
import RationaleDialog from '@/modules/governance/dialogs/RationaleDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import EmptyState from '@/shared/components/feedback/EmptyState.vue';
import ErrorState from '@/shared/components/feedback/ErrorState.vue';

const { t } = useTranslation();
const router = useRouter();
const { toCurrency, truncate } = filters;

/** Constants, not author-supplied links: safe to render directly. */
const GOV_TOOLS_URL = 'https://gov.tools/';
const CIP_1694_URL = 'https://cips.cardano.org/cip/CIP-1694';

const record = ref<DelegatedDRepRecord | null>(null);
const loading = ref(true);
const error = ref('');
const fetchedAt = ref<number | null>(null);

const { withdraw, withdrawalBlocked, closeWithdrawalDialog } = useWithdrawal();

const actionsState = governanceActionsStore.state;

const status = useGovernanceStatus(() => ({
  account: walletStore.account,
  record: record.value,
  ownDRepIds: walletStore.keys?.drep129,
  currentEpoch: NetworkStore.getCurrentEpoch(),
  activityWindow: networkStore.epochParams?.dRepInactivityPeriod ?? null,
  // Enables the recent-vote veto: a stale indexed expiry must not outvote a
  // vote the same record shows within the activity window.
  nowSec: Math.floor(Date.now() / 1000),
}));

const health = computed(() => status.value.health);

const subtitleKey = computed(() =>
  status.value.withdrawalsBlocked
    ? 'governance.myGovernanceSubtitleLocked'
    : 'governance.myGovernanceSubtitle',
);

const currencySymbol = computed(() =>
  networks.resolveCurrencySymbol(walletStore.loggedWallet?.chain, walletStore.loggedWallet?.network),
);

// BigInt in, string out: `lockedRewards` is exact lovelace and must never be
// narrowed through Number on the way to the formatter.
const lockedRewardsDisplay = computed(() =>
  toCurrency(status.value.lockedRewards.toString(), false, 2, currencySymbol.value),
);

const votingPowerDisplay = computed(() =>
  toCurrency(walletStore.account?.controlled_amount ?? '0', false, 0, currencySymbol.value, '', true),
);

const notAvailable = computed(() => String(t('common.notAvailable')));

const rationaleRecentDisplay = computed(() =>
  health.value.rationaleRecent === null ? notAvailable.value : `${health.value.rationaleRecent}%`,
);

const rationaleLongRunDisplay = computed(() =>
  health.value.rationaleLongRun === null
    ? String(t('governance.noVotesYet'))
    : String(t('governance.rationaleLongRun', { pct: health.value.rationaleLongRun })),
);

/**
 * REAL vote recency: the newest vote's block_time, rendered as a date like the
 * vote rows below. Never the window-derived `windowUsed` — that is expiry
 * arithmetic, and labelling it "last vote" fabricates a claim about voting
 * behaviour the record does not make. No vote time known means an honest n/a.
 */
const lastVoteDisplay = computed(() =>
  health.value.lastVoteAt === null
    ? notAvailable.value
    : new Date(health.value.lastVoteAt * 1000).toLocaleDateString(),
);

/**
 * The countdown caption, or NOTHING.
 *
 * `epochsLeft` is null in exactly two cases: the expiry was never known, or
 * `health.expiryStale` made the trust hierarchy throw it away. Rendering
 * "stays active for 0 more epochs" would be the false claim that hierarchy
 * exists to prevent — but so is answering the question with "n/a". The tile
 * above it already carries a real date; captioning that date "n/a" reads as if
 * the DATE were unknown, which is the opposite of true. An absent caption is
 * the honest render: the tile shows the fact it has and claims nothing else.
 */
const activityDisplay = computed(() =>
  health.value.epochsLeft === null
    ? ''
    : String(t('governance.activeForEpochs', { n: health.value.epochsLeft })),
);

// Same rule for the expiry: a provably stale one (health.expiryStale) is not
// shown at all, because printing "Expires epoch 629" at epoch 651 beside an
// active DRep is misinformation. Nor is it papered over with a filler line —
// "On-chain data" under a vote count says nothing the label did not already.
const expiresDisplay = computed(() =>
  record.value?.expires_epoch_no && !health.value.expiryStale
    ? String(t('governance.expiresEpochLabel', { n: record.value.expires_epoch_no }))
    : '',
);

/**
 * The two predefined choices are positions, not representatives: there is no
 * DRep behind `drep_always_abstain` to name, and rendering the keyword as if
 * it were a bech32 id (which is what truncating it produced) told the user
 * nothing. They get their proper name and no id line at all.
 */
const KEYWORD_NAME_KEYS: Record<string, string> = {
  abstain: 'governance.alwaysAbstain',
  noConfidence: 'governance.alwaysNoConfidence',
};

const keywordNameKey = computed(() => KEYWORD_NAME_KEYS[status.value.delegation] ?? null);

/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- upstream metadata is untyped JSON-LD */
const metaBody = computed<any>(() => (record.value?.metadata as any)?.meta_json?.body ?? null);

/**
 * CIP-119 `givenName` arrives either as a bare string or as a JSON-LD
 * `{ '@value': … }`. Falls back to the id so the chip is never blank.
 */
const drepName = computed(() => {
  if (keywordNameKey.value) return String(t(keywordNameKey.value));
  const given = metaBody.value?.givenName;
  const name = typeof given === 'object' && given !== null ? given['@value'] : given;
  const text = String(name ?? '').trim();
  return text.length > 0 ? text : truncate(status.value.drepId ?? '');
});

/**
 * The RAW `contentUrl`, handed to DRepAvatar unresolved on purpose: about a
 * quarter of DReps publish an `ipfs://` image, and the avatar owns the mapping
 * that turns one into something the extension can actually load.
 */
const drepImageSource = computed<string | null>(() => {
  const image = metaBody.value?.image;
  const url = image && typeof image === 'object' ? image['contentUrl'] : image;
  return typeof url === 'string' && url.trim() ? url.trim() : null;
});

/** The vote glyphs the record can carry, mapped to copy plus a tone. */
const VOTE_COPY: Record<string, { labelKey: string; tone: string }> = {
  yes: { labelKey: 'governance.votedYes', tone: 'yes' },
  no: { labelKey: 'governance.votedNo', tone: 'no' },
  abstain: { labelKey: 'governance.votedAbstain', tone: 'abstain' },
};

/**
 * Governance actions, indexed by the ONE canonical id form.
 *
 * A DRep's `proposal_id` is stamped by gero-backend and may be bech32
 * (`gov_action1…`) or `{txHash}#{index}`; Nexus lists the same action under both
 * spellings. Both sides go through `canonicalActionKey`, so a vote resolves to
 * its action whichever encoding either service happens to use — matching on the
 * raw strings resolved nothing at all for a bech32 feed.
 */
const actionIndex = computed(() => {
  const map = new Map<string, { title: string | null; type: string | null }>();
  for (const action of actionsState.actions) {
    const entry = {
      title: typeof action.title === 'string' && action.title.trim() ? action.title.trim() : null,
      type: typeof action.type === 'string' ? action.type : null,
    };
    for (const raw of [action.govActionId, action.govActionIdCip129]) {
      const key = canonicalActionKey(raw);
      if (key) map.set(key, entry);
    }
  }
  return map;
});

function typeLabel(type: string | null): string {
  if (!type) return '';
  const key = `governance.actionType.${type.toLowerCase()}`;
  const label = String(t(key));
  return label === key ? type : label;
}

/**
 * The newest votes, one row per proposal.
 *
 * Deduped by `proposal_id` keeping the newest: a DRep may re-vote on the same
 * action before it closes, and only the last one counts on chain, so listing
 * both would overstate their record.
 */
interface VoteRow {
  key: string;
  proposalId: string;
  /** The action's published name, or the truncated id when it is not loaded. */
  title: string;
  typeLabel: string;
  labelKey: string;
  tone: string;
  /** The CIP-136 anchor, when the voter published one. */
  metaUrl: string | null;
  metaHash: string | null;
  when: string;
  /** Set only when the id parses; without it there is no detail page to open. */
  route: GovActionId | null;
}

const recentVotes = computed<VoteRow[]>(() => {
  const votes: DRepVoteRecord[] = record.value?.votes ?? [];
  const newestFirst = [...votes].sort((a, b) => (b.block_time ?? -Infinity) - (a.block_time ?? -Infinity));
  const seen = new Set<string>();
  const rows: VoteRow[] = [];
  for (const vote of newestFirst) {
    const proposalId = String(vote.proposal_id ?? '').trim();
    const key = proposalId || `unknown-${rows.length}`;
    if (proposalId && seen.has(proposalId)) continue;
    if (proposalId) seen.add(proposalId);
    const copy = VOTE_COPY[String(vote.vote ?? '').toLowerCase()];
    const action = actionIndex.value.get(canonicalActionKey(proposalId) ?? '');
    const fallback = proposalId ? truncate(proposalId) : String(t('common.notAvailable'));
    const metaUrl = String(vote.meta_url ?? '').trim();
    rows.push({
      key,
      proposalId,
      // An unresolvable id keeps its truncated self. Never blank, and never a
      // guessed name for an action nobody has loaded.
      title: action?.title ?? fallback,
      typeLabel: typeLabel(action?.type ?? null),
      labelKey: copy?.labelKey ?? 'governance.didNotVote',
      tone: copy?.tone ?? 'none',
      metaUrl: metaUrl || null,
      metaHash: String(vote.meta_hash ?? '').trim() || null,
      when: vote.block_time ? new Date(vote.block_time * 1000).toLocaleDateString() : '',
      route: parseGovActionId(proposalId),
    });
    if (rows.length >= 6) break;
  }
  return rows;
});

/** The four states worth explaining, in the order the design canvas lists them. */
const legend = [
  { key: 'governance.status.represented', tone: 'success' },
  { key: 'governance.status.drepInactiveSoon', tone: 'warning' },
  { key: 'governance.status.registeredNoDRep', tone: 'critical' },
  { key: 'governance.status.notInGovernance', tone: 'neutral' },
];

/**
 * The one call to action the current state actually needs. Kept as a single
 * slot so the page can never render two competing primaries.
 */
const heroCta = computed<{ labelKey: string; run: () => void } | null>(() => {
  switch (status.value.status) {
    case 'drepRetired':
    case 'drepInactive':
    case 'drepInactiveSoon':
      return { labelKey: 'governance.findAReplacement', run: () => goToDReps() };
    case 'selfDRep':
      // Managing a registration lands on the same gated route as creating one,
      // so with voting off there is no CTA to offer rather than one that bounces.
      return registrationAvailable.value
        ? { labelKey: 'governance.manageRegistration', run: () => goToRegister() }
        : null;
    case 'notInGovernance':
      return { labelKey: 'governance.goToStaking', run: () => router.push({ name: 'staking' }) };
    default:
      return null;
  }
});

// A retired or expiring DRep is urgent enough to own the gradient; otherwise
// the promo card downstream keeps it, and there is never more than one.
/**
 * One gradient per screen, and in a delegated state this page is not the one
 * that gets it: the delegation-alerts panel drops into the slot above and
 * raises its own primary ("find a replacement", "review the record") whenever
 * an alert is live. So the page only claims the gradient where no alert can
 * exist, which is exactly where there is no DRep to alert about.
 *
 * That leaves `notInGovernance` (the hero CTA below) and `registeredNoDRep`
 * (the delegate choice card, a branch this hero never renders beside).
 */
const heroCtaTier = computed<'primary' | 'secondary'>(() =>
  status.value.drepId ? 'secondary' : 'primary',
);

// ---------------------------------------------------------------------------
// The rationale dialog
// ---------------------------------------------------------------------------

const openRationaleRow = ref<VoteRow | null>(null);

const rationaleOpen = computed(() => openRationaleRow.value !== null);
const rationaleUrl = computed(() => openRationaleRow.value?.metaUrl ?? null);
const rationaleHash = computed(() => openRationaleRow.value?.metaHash ?? null);
const rationaleTitle = computed(() => openRationaleRow.value?.title ?? null);

function openRationale(row: VoteRow): void {
  if (!row.metaUrl) return;
  openRationaleRow.value = row;
}

function closeRationale(): void {
  openRationaleRow.value = null;
}

function openAction(id: GovActionId): void {
  router.push({ name: 'governanceAction', params: { txHash: id.txHash, index: String(id.index) } });
}

/**
 * Delegation, driven from this page. The same composable the directory uses, so
 * the certificate, the fee and the signing surface are identical wherever the
 * choice is made.
 */
const { selectedDRep, tx, isDialogOpen, building, delegateToDRep, delegateToPredefined, closeDialog } =
  useDRepDelegation();

/** The pending qualifier. See usePendingVoteDelegation for why it is not a status. */
const delegationPending = usePendingVoteDelegation();

// ---------------------------------------------------------------------------
// CIP-149 support
// ---------------------------------------------------------------------------

/**
 * The rate this wallet committed to, in TENTHS OF A PERCENT.
 *
 * Named `bps` throughout the codebase, but it is not basis points: the
 * withdrawal builder computes `amount * bps / 1000` and the dialog renders
 * `bps / 10 + '%'`, so 50 is 5%. Matched here rather than corrected — the unit
 * is load-bearing in money math that already ships.
 */
const supportBps = computed(() => governanceStore.currentCompensationBps);

const supportingNow = computed(() => (supportBps.value ?? 0) > 0);

const supportPercentDisplay = computed(() => `${((supportBps.value ?? 0) / 10).toFixed(1)}%`);

/**
 * Whether the DRep published somewhere to receive it.
 *
 * The same check the withdrawal builder makes before it adds the donation
 * output — and it drops that output silently when this is false, which is why
 * the section says so instead of letting the user find out by not being thanked.
 */
const drepCanReceive = computed(() => drepPayoutAddress(record.value) !== null);

/**
 * Only offered against a real DRep, and never while a delegation is in flight:
 * changing the rate means submitting another vote-delegation certificate, which
 * would replace the one still waiting.
 */
const showsSupport = computed(
  () =>
    !delegationPending.value &&
    status.value.delegation === 'drep' &&
    !!record.value,
);

/**
 * Set, change or stop it — all three are the same gesture: re-delegate to the
 * SAME DRep, with different CIP-149 metadata attached. The dialog owns the
 * toggle and the presets, so it is the one surface for all of them; submitting
 * with the switch off is what clears the rate.
 */
function openSupportDialog(): void {
  const drep = record.value;
  if (!drep?.drep_id) return;
  void delegateToDRep({
    id: drep.drep_id,
    name: drepName.value,
    hex: drep.hex ?? undefined,
    has_script: drep.has_script ?? undefined,
  });
}

const isAbstaining = computed(() => walletStore.account?.drep_id === 'drep_always_abstain');
const isNoConfidence = computed(() => walletStore.account?.drep_id === 'drep_always_no_confidence');

/**
 * Whether there is a delegation to change. False for a stake key with none —
 * that case is the `registeredNoDRep` block above, which is a different
 * conversation (it is blocking withdrawals) and already offers all three.
 */
const canChangeDelegation = computed(() => !!walletStore.account?.drep_id);

function goToDReps(choice?: string): void {
  router.push({ name: 'governanceDReps', query: choice ? { choice } : undefined });
}

function goToActions(): void {
  router.push({ name: 'governanceActions' });
}

/**
 * Whether the registration route can actually be reached.
 *
 * The router gates `governanceRegister` on the voting sub-flag as well as the
 * master one, because registering posts a deposit and a certificate on chain.
 * Read here so the affordances match the gate instead of leading into a
 * redirect.
 */
const registrationAvailable = computed(
  () => featureFlagsStore.isGovernanceEnabled() && featureFlagsStore.isGovernanceVotingEnabled(),
);

function goToRegister(): void {
  // A guard redirect REJECTS the push promise (vue-router 3.4+), and
  // `router.onError` does not see it — that is the "Redirected when going from
  // ... via a navigation guard" left unhandled in the console. The flag can also
  // flip between render and click, so this stays defensive even now that the
  // affordances are gated.
  void Promise.resolve(router.push({ name: 'governanceRegister' })).catch(() => undefined);
}

/**
 * Make sure the action list is loaded, so the vote rows can name what they were
 * cast on instead of showing a hash.
 *
 * Only ever fires when the store has NEVER loaded (`fetchedAt === null`), which
 * is also the only moment its filters can be reset without changing a board the
 * user is looking at — and they have to be reset, because a board left filtered
 * to "active" would hide every closed action a past vote points at.
 */
function ensureActionTitles(): void {
  if (actionsState.fetchedAt !== null || actionsState.loading || actionsState.actions.length) return;
  const network = String(walletStore.loggedWallet?.network ?? '');
  if (!network) return;
  governanceActionsStore.setFilters({ type: null, status: null });
  void governanceActionsStore.loadActions(network);
}

/**
 * Fetch the delegated DRep's record. Absence is not retirement: a 404 leaves
 * `record` null, `recordAvailable` false, and the health strip hidden rather
 * than reporting a DRep as dead on missing data.
 *
 * The fetch and the store-write are the shared ones from
 * useGovernanceHydration, whose wallet-keyed bootstrap covers withdrawals
 * from pages that never mount this view; going through them here means the
 * governance store is written off this page's own single lookup (deduped
 * against the bootstrap's) rather than a second request.
 */
async function loadDRep(): Promise<void> {
  error.value = '';
  const drepId = walletStore.account?.drep_id;
  const wallet = walletStore.loggedWallet;
  // A keyword delegation has no record to fetch: the id is the whole story,
  // and asking the indexer for it only earns a 404.
  const fetchable =
    !!drepId && !!wallet && !KEYWORD_DREPS.includes(drepId as (typeof KEYWORD_DREPS)[number]);

  if (!fetchable) {
    record.value = null;
    loading.value = false;
    applyGovernanceHydration(null);
    return;
  }

  // Only blank the page when there is nothing on it yet. A REFRESH keeps what
  // is already rendered and swaps the new record in underneath it: this view
  // re-reads whenever the delegation changes, and turning the whole page into
  // skeletons for the duration threw the layout — the alerts panel jumped every
  // time. Correct regardless of what triggers the re-read.
  loading.value = record.value === null;
  try {
    record.value = await fetchDelegatedDRepRecord(drepId, wallet);
    fetchedAt.value = Date.now();
    applyGovernanceHydration(record.value);
    // Titles are only worth a request once there is a record with votes in it.
    if (record.value?.votes?.length) ensureActionTitles();
  } catch (err: unknown) {
    debugLog('MyGovernance: DRep lookup failed', err);
    record.value = null;
    error.value = String(t('governance.drepLookupFailed'));
    // Leave the store alone on failure rather than blanking a good record
    // with a transient network error.
  } finally {
    loading.value = false;
  }
}

// Re-reads whenever the delegation itself changes, so delegating from another
// surface (or a confirmation landing via Gero Sync) refreshes this page instead
// of stranding it on the previous DRep until a reload.
watch(() => walletStore.account?.drep_id, () => void loadDRep(), { immediate: true });
</script>

<style scoped>
.my-governance {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-4);
}
.my-governance__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--g-s-4);
  flex-wrap: wrap;
}
.my-governance__headline {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}
.my-governance__headline h1 {
  margin: 0;
}
.my-governance__subtitle {
  margin: 0;
}
.my-governance__header-side {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  flex-wrap: wrap;
}
.my-governance__skeleton {
  border-radius: var(--g-r-card);
}

/* ---- The two columns ---- */
.my-governance__grid {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: var(--g-s-4);
  align-items: start;
}
.my-governance__main,
.my-governance__side {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  min-width: 0;
}

/* ---- Hero ---- */
/* Surface, border and radius come from `.glass-panel` — declaring them here
   too would win on scoped specificity and repaint the panel solid. */
.my-governance__hero {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-4);
}
/* Elevation by hairline, never glow: the top edge carries the state's tone. */
.my-governance__hero::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--g-hairline-3);
}
.my-governance__hero--success::before { background: var(--g-grad); }
.my-governance__hero--warning::before { background: var(--g-warning); }
.my-governance__hero--critical::before { background: var(--g-error); }
.my-governance__hero-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--g-s-3);
  flex-wrap: wrap;
}
.my-governance__hero-headline {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  min-width: 0;
}
.my-governance__hero-title {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}
.my-governance__hero-copy,
.my-governance__hero-summary {
  margin: 0;
  max-width: 62ch;
}
.my-governance__hero-actions {
  display: flex;
  gap: var(--g-s-2);
}
.my-governance__dot {
  width: 10px;
  height: 10px;
  border-radius: var(--g-r-pill);
  background: var(--g-text-3);
  flex: none;
}
.my-governance__dot--small {
  width: 8px;
  height: 8px;
  margin-top: var(--g-s-1);
}
.my-governance__dot--success { background: var(--g-success); }
.my-governance__dot--warning { background: var(--g-warning); }
.my-governance__dot--critical { background: var(--g-error); }

.my-governance__drep-chip {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-1) var(--g-s-3) var(--g-s-1) var(--g-s-1);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-pill);
  max-width: 100%;
  min-width: 0;
}
.my-governance__drep-ident {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.my-governance__drep-name {
  color: var(--g-text-1);
  font-weight: 550;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.my-governance__drep-id {
  word-break: normal;
  line-height: 1.3;
}

.my-governance__locked {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  padding: var(--g-s-3) var(--g-s-4);
  background: var(--g-raised);
  border: 1px solid var(--g-error-line);
  border-radius: var(--g-r-control);
}
.my-governance__locked-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--g-r-control);
  background: var(--g-error-fill);
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.my-governance__locked-body {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}
.my-governance__locked-note {
  color: var(--g-error);
  font-weight: 550;
}

/* ---- Health strip ---- */
.my-governance__health {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--g-s-3);
}
.my-governance__tile {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  padding: var(--g-s-3) var(--g-s-4);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
}

/* ---- The three unlock choices ---- */
.my-governance__choices {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--g-s-4);
}
.my-governance__choice {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-4);
}
.my-governance__choice--featured {
  border-color: var(--g-accent);
}
.my-governance__choice-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-2);
}
.my-governance__choice-icon {
  width: 36px;
  height: 36px;
  border-radius: var(--g-r-control);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-2);
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.my-governance__badge {
  color: var(--g-success);
  background: var(--g-success-fill);
  border: 1px solid var(--g-success-line);
  border-radius: var(--g-r-chip);
  padding: 0 var(--g-s-2);
  white-space: nowrap;
}
.my-governance__choice-copy,
.my-governance__choice-note {
  margin: 0;
}
.my-governance__choice-cta {
  margin-top: auto;
}

/* ---- Honesty strip ---- */
/* Solid on purpose: glass means "this floats above content", and a one-line
   footnote under three cards is the most static thing on the page. */
/* The in-flight qualifier. Sits inside the hero rather than above it: it is a
   caveat on the state below, not a state of its own, and a full-width banner
   would read as the more important of the two. */
.my-governance__pending {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-3);
  padding: var(--g-s-3);
  margin-bottom: var(--g-s-3);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  background: var(--g-raised);
}
.my-governance__pending-text {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  min-width: 0;
}
.my-governance__pending-title {
  color: var(--g-text-1);
}

/* The two management cards, side by side and the SAME HEIGHT — `stretch`, not
   `start`. The change card carries three buttons and the support card one, so
   left to themselves they end at different depths and the pair reads as two
   unrelated panels that happen to be adjacent.
   The change card gets the wider track because three buttons have to fit across
   it; `auto-fit` still gives a lone card the full width, which matters because a
   wallet delegated to a keyword has no support card at all. */
.my-governance__manage {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: var(--g-s-4);
  align-items: stretch;
}
@media (min-width: 1100px) {
  .my-governance__manage {
    grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr);
  }
}
/* Both cards are columns whose action block is pushed to the bottom, so the two
   button rows sit on the same line however much text is above them. */
.my-governance__manage > .glass-panel {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
}
.my-governance__change-row,
.my-governance__support-row {
  margin-top: auto;
}
.my-governance__manage-head {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
}
/* The same 36px tile the choice cards use, so these join the page's existing
   action vocabulary instead of introducing a third one. */
.my-governance__manage-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex: none;
  border-radius: var(--g-r-control);
  border: 1px solid var(--g-hairline-2);
  background: var(--g-raised);
}
.my-governance__manage-icon--off {
  border-color: var(--g-hairline-1);
}
.my-governance__manage-title {
  min-width: 0;
  flex: 1;
}
/* The explanation lives behind this. A real button so it is tabbable and takes
   the baseline focus ring; no outline is cleared anywhere here. */
.my-governance__manage-info {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex: none;
  padding: 0;
  border: none;
  background: none;
  border-radius: var(--g-r-pill);
  color: var(--g-text-3);
  cursor: help;
}
.my-governance__manage-info:hover {
  color: var(--g-text-2);
}
/* Two paragraphs of prose need to sit apart inside the popover. */
.glass-popover .t-body-sm + .t-body-sm {
  display: block;
  margin-top: var(--g-s-2);
}

.my-governance__support {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-4);
}
.my-governance__support-state {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-3);
}
.my-governance__support-body {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  min-width: 0;
}
/* A commitment that cannot be honoured is not a smaller version of one that
   can, so it is toned as a warning rather than as another caption. */
.my-governance__support-warn {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-2);
  color: var(--g-warning);
}
.my-governance__support-row {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}
/* Vuetify gives `.v-btn` a `min-width` and a fixed height, and never lets
   `.v-btn__content` shrink — so in a narrow grid track the label ran straight
   past the border instead of wrapping inside it. `min-width: 0` on both is what
   actually lets the track govern the button; the rest is the wrap itself.
   Two classes, because Vuetify's own rule is (0,1,0) and a single class ties. */
.my-governance__change-row .v-btn.g-btn {
  height: auto;
  min-height: 36px;
  min-width: 0;
  max-width: 100%;
  padding: var(--g-s-2) var(--g-s-3);
  white-space: normal;
}
/* `>>>`, not a plain descendant: `.v-btn__content` lives inside GButton's own
   template, and a scoped rule never reaches it — the parent's data-v attribute
   only lands on the child's ROOT. That is why the earlier wrap did nothing and
   the label kept spilling past the border, icon and all. */
.my-governance__change-row >>> .v-btn__content {
  flex: 1 1 auto;
  min-width: 0;
  white-space: normal;
  line-height: 1.25;
  text-align: center;
}
/* Vuetify pulls a `left` icon 4px outside the content box. Harmless at its
   default 16px padding; here it is the difference between the icon sitting
   inside the button and hanging off it. */
.my-governance__change-row >>> .v-icon--left {
  margin-left: 0;
  margin-right: var(--g-s-2);
}
.my-governance__manage-state {
  margin: 0;
}

.my-governance__change {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-4);
}
/* A grid of equal columns rather than a wrapping row: the three used to break
   2 + 1 and leave a ragged edge. Equal tracks also state the thing the copy
   states — these are three alternatives of equal standing. Below the breakpoint
   the card is too narrow for three, so they become one column. */
.my-governance__change-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--g-s-2);
}
@media (max-width: 1099px) {
  .my-governance__change-row {
    grid-template-columns: minmax(0, 1fr);
  }
}

.my-governance__honesty {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  padding: var(--g-s-3) var(--g-s-4);
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-card);
}
.my-governance__honesty-text {
  margin: 0;
}
.my-governance__link {
  color: var(--g-accent);
}
.my-governance__sep {
  color: var(--g-text-3);
}

/* ---- Record + side column ---- */
.my-governance__record,
.my-governance__legend,
.my-governance__promo {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-4);
}
.my-governance__record-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
}
.my-governance__rows {
  display: flex;
  flex-direction: column;
}
.my-governance__row {
  display: flex;
  align-items: center;
  padding: var(--g-s-2) 0;
  gap: var(--g-s-3);
  min-height: var(--g-row-h-panel);
  border-bottom: 1px solid var(--g-hairline-1);
  flex-wrap: wrap;
}
.my-governance__row:last-child {
  border-bottom: none;
}
/* No ellipsis. The action TYPE is the whole label, and "Treasury With…" names
   nothing — the reader cannot tell a withdrawal from a parameter change. It
   wraps inside a fixed track instead, so the titles beside it stay aligned. */
.my-governance__row-type {
  width: 132px;
  flex: none;
  color: var(--g-text-3);
  line-height: 1.35;
}
.my-governance__row-title {
  flex: 1;
  min-width: 0;
  text-align: left;
  color: var(--g-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.my-governance__row-link {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}
.my-governance__row-link:hover {
  color: var(--g-accent);
}
.my-governance__row-when {
  width: 88px;
  text-align: right;
  flex: none;
}
.my-governance__rationale {
  color: var(--g-accent);
  background: none;
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-chip);
  padding: 0 var(--g-s-2);
  white-space: nowrap;
  cursor: pointer;
}
.my-governance__rationale:hover {
  border-color: var(--g-accent);
}
.my-governance__vote {
  border-radius: var(--g-r-chip);
  padding: 0 var(--g-s-2);
  border: 1px solid var(--g-hairline-2);
  white-space: nowrap;
  flex: none;
}
.my-governance__vote--yes {
  color: var(--g-success);
  background: var(--g-success-fill);
  border-color: var(--g-success-line);
}
.my-governance__vote--no {
  color: var(--g-error);
  background: var(--g-error-fill);
  border-color: var(--g-error-line);
}
.my-governance__vote--abstain {
  color: var(--g-text-2);
  background: var(--g-raised);
}
.my-governance__record-note {
  margin: 0;
  margin-top: auto;
}
.my-governance__legend-row {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-2);
}
.my-governance__legend-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.my-governance__legend-title {
  color: var(--g-text-1);
  font-weight: 550;
}
.my-governance__legend-foot {
  margin: 0;
  margin-top: auto;
  padding-top: var(--g-s-3);
  border-top: 1px solid var(--g-hairline-1);
  color: var(--g-text-3);
}
.my-governance__bullets {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  margin: 0;
  padding-left: var(--g-s-4);
}

/* The side panel sits around 400px and the popup narrower still. Below the
   two-column breakpoint everything stacks, and the side column follows the main
   one rather than being squeezed beside it. */
@media (max-width: 960px) {
  .my-governance__grid,
  .my-governance__health {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 720px) {
  .my-governance__row-type {
    width: auto;
  }
  .my-governance__row-title {
    flex-basis: 100%;
  }
}
</style>
