<template>
  <v-layout>
    <v-row no-gutters>
      <v-col cols="12" class="realfi-page">
        <!-- Header: the partner lockup is the only place the RealFi brand appears -->
        <div class="realfi-head">
          <div class="realfi-lockup">
            <span class="realfi-glyph" aria-hidden="true"></span>
            <span class="t-heading">{{ $t('realfi.title') }}</span>
          </div>
          <GButton
            tier="tertiary"
            compact
            :loading="isLoading"
            :aria-label="$t('common.refresh')"
            @click="load()"
          >
            {{ $t('common.refresh') }}
          </GButton>
        </div>

        <!-- Loading: skeletons rather than a spinner, so the layout does not jump -->
        <div v-if="isLoading && !hasPosition" class="realfi-grid">
          <div class="g-skeleton realfi-skeleton realfi-skeleton--hero"></div>
          <div class="g-skeleton realfi-skeleton"></div>
          <div class="g-skeleton realfi-skeleton"></div>
        </div>

        <!-- Unavailable: say which kind of unavailable, never a generic error -->
        <div v-else-if="unavailableReason" class="realfi-empty">
          <p class="t-body-lg mb-2">{{ unavailableTitle }}</p>
          <p class="t-body realfi-empty__body">{{ unavailableBody }}</p>
          <GButton
            v-if="unavailableReason === 'request-failed'"
            tier="secondary"
            class="mt-4"
            @click="load()"
          >
            {{ $t('common.tryAgain') }}
          </GButton>
        </div>

        <template v-else>
          <!-- Nothing staked and no activity. Rendering the hero here would show "$0.00"
               with no explanation, and at launch that is every user's first look. -->
          <section v-if="isEmpty && !pendingOrders.length" class="realfi-start">
            <span class="realfi-glyph realfi-glyph--lg" aria-hidden="true"></span>
            <template v-if="hasUsdr">
              <h2 class="t-heading realfi-start__title">{{ $t('realfi.start.readyTitle') }}</h2>
              <p class="t-body realfi-start__body">
                {{ $t('realfi.start.readyBody', { amount: usdrLabel }) }}
              </p>
            </template>
            <template v-else>
              <h2 class="t-heading realfi-start__title">{{ $t('realfi.start.title') }}</h2>
              <p class="t-body realfi-start__body">{{ $t('realfi.start.body') }}</p>
            </template>
            <RealFiGettingStarted
              :mainnet="isMainnet"
              :hasUsdr="hasUsdr"
              :canStake="canTransact && !ordersLocked"
              :canStakeExternally="!canTransact && !ordersLocked"
              :canAcquire="canSwapUsdcx"
              :canSwapUsdrf="canSwapUsdrf"
              :hasUsdcx="hasUsdcx"
              :usdcxLabel="usdcxLabel"
              :swapStatus="swapStatusForGuide"
              :canRetryAvailability="canRetryUsdrfAvailability"
              @check-eligibility="openRealFiApp()"
              @get-usdrf="onGetUsdrf"
              @get-usdcx="openUsdcxSwap()"
              @open-realfi="openRealFiApp()"
              @retry-availability="refreshUsdrfAvailability()"
              @stake="onStake"
            />
            <RealFiYieldChart
              v-if="showYieldChart"
              class="realfi-start__yield"
              :history="apyHistory"
              :avgPercent="apyAvg"
            />
            <p v-else-if="apyLabel" class="t-caption realfi-start__note">{{ apyLabel }}</p>
            <p v-if="!canTransact" class="t-caption realfi-start__note">
              {{ $t('realfi.start.note') }}
            </p>
          </section>

          <template v-else-if="!isEmpty">
          <!-- Position -->
          <section class="realfi-hero">
            <!-- Actions sit in the header row: on the card's own line they left the
                 right half empty whenever there was no chart beside the figure. -->
            <div class="realfi-hero__top">
              <span class="t-label">{{ $t('realfi.position.label') }}</span>
              <div
                v-if="(canTransact && !ordersLocked && (hasUsdr || canUnstake)) || (hasPosition && canSwapUsdrf)"
                class="realfi-hero__actions"
              >
                <GButton v-if="hasPosition && canSwapUsdrf" tier="secondary" compact @click="openUsdrfSwap()">
                  {{ $t('realfi.gettingStarted.getUsdrf') }}
                </GButton>
                <GButton v-if="canTransact && !ordersLocked && hasUsdr" tier="primary" compact @click="openAmount('stake')">
                  {{ $t('realfi.stakeAction') }}
                </GButton>
                <GButton
                  v-if="canTransact && !ordersLocked && canUnstake"
                  tier="secondary"
                  compact
                  @click="openAmount('unstake')"
                >
                  {{ $t('staking.unstake') }}
                </GButton>
              </div>
            </div>

            <div :class="['realfi-hero__body', { 'realfi-hero__body--split': showYieldChart }]">
              <div class="realfi-hero__main">
                <p class="t-display g-num realfi-hero__value">{{ positionValue }}</p>
                <!-- What is actually held, and the rate that turns it into the dollar
                     figure above: the value moves with the rate, the sUSDrf does not. -->
                <p v-if="holdingLabel" class="t-body-sm g-num realfi-hero__holding">
                  {{ holdingLabel }}
                </p>
                <p v-if="apyLabel && !showYieldChart" class="t-caption realfi-hero__apy">
                  {{ apyLabel }}
                </p>
              </div>
              <RealFiYieldChart
                v-if="showYieldChart"
                class="realfi-hero__yield"
                :history="apyHistory"
                :avgPercent="apyAvg"
              />
            </div>

            <!-- The numbers behind the headline, one per column. "Total with RealFi"
                 is the one a user doing sums wants: the position excludes anything in
                 cooldown, which is still theirs and still at RealFi. -->
            <dl class="realfi-stats">
              <div class="realfi-stats__item">
                <dt class="t-caption">{{ $t('realfi.position.earned') }}</dt>
                <dd :class="['t-heading', 'g-num', deltaClass]">{{ earnedLabel }}</dd>
                <!-- Plain coloured text, never a chip: the design language reserves
                     chips for status and gives deltas a glyph instead. -->
                <dd :class="['t-caption', 'g-num', deltaClass]">
                  {{ $t('realfi.stats.toDate', { change: yieldLabel }) }}
                </dd>
              </div>
              <div class="realfi-stats__item">
                <dt class="t-caption">{{ $t('realfi.position.principal') }}</dt>
                <dd class="t-heading g-num">{{ principalLabel }}</dd>
              </div>
              <div v-if="cooling" class="realfi-stats__item">
                <dt class="t-caption">{{ $t('realfi.stats.cooldown') }}</dt>
                <dd class="t-heading g-num">{{ cooling.amount }}</dd>
                <dd v-if="cooling.next" class="t-caption g-num">{{ cooling.next }}</dd>
              </div>
              <div v-if="totalWithRealFi" class="realfi-stats__item">
                <dt class="t-caption">{{ $t('realfi.stats.total') }}</dt>
                <dd class="t-heading g-num">{{ totalWithRealFi }}</dd>
                <dd class="t-caption">{{ $t('realfi.stats.totalNote') }}</dd>
              </div>
            </dl>
          </section>

          <details v-if="isMainnet" class="realfi-guide-disclosure">
            <summary class="t-body-sm">{{ $t('realfi.gettingStarted.showGuide') }}</summary>
            <RealFiGettingStarted
              class="mt-3"
              compact
              :mainnet="isMainnet"
              :hasUsdr="hasUsdr"
              :canStake="canTransact && !ordersLocked"
              :canStakeExternally="!canTransact && !ordersLocked"
              :canAcquire="canSwapUsdcx"
              :canSwapUsdrf="canSwapUsdrf"
              :hasUsdcx="hasUsdcx"
              :usdcxLabel="usdcxLabel"
              :swapStatus="swapStatusForGuide"
              :canRetryAvailability="canRetryUsdrfAvailability"
              @check-eligibility="openRealFiApp()"
              @get-usdrf="onGetUsdrf"
              @get-usdcx="openUsdcxSwap()"
              @open-realfi="openRealFiApp()"
              @retry-availability="refreshUsdrfAvailability()"
              @stake="onStake"
            />
          </details>

          <!-- Unstaked but not claimed: the USDrf sits in RealFi's cooldown timelock,
               in neither the wallet nor the position. Each one shows how much, how far
               through the cooldown it is, and when it opens; then it can be claimed. -->
          <section v-if="unstakes.length" class="realfi-unstaking" aria-live="polite">
            <div class="realfi-unstaking__head">
              <span class="t-label">{{ unstakingTitle }}</span>
              <span v-if="unstakingSummary" class="t-body-sm g-num realfi-unstaking__summary">
                {{ unstakingSummary }}
              </span>
            </div>
            <ul class="realfi-unstaking__list">
              <li v-for="u in unstakes" :key="u.key" class="realfi-unstake">
                <span class="realfi-unstake__amount">
                  <span class="t-body g-num realfi-strong">{{ u.amount }}</span>
                  <span v-if="u.from" class="t-caption g-num">{{ u.from }}</span>
                </span>
                <span class="realfi-unstake__time">
                  <span
                    v-if="u.progress !== null"
                    class="realfi-unstake__track"
                    role="progressbar"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    :aria-valuenow="Math.round(u.progress * 100)"
                    :aria-label="$t('realfi.unstaking.progress')"
                  >
                    <span
                      :class="['realfi-unstake__fill', { 'realfi-unstake__fill--ready': u.ready }]"
                      :style="{ transform: `scaleX(${u.progress})` }"
                    />
                  </span>
                  <span class="t-caption g-num">{{ u.when }}</span>
                </span>
                <GButton
                  v-if="u.ready && canTransact && !ordersLocked"
                  tier="primary"
                  compact
                  @click="claim(u.order)"
                >
                  {{ $t('dashboard.claim') }}
                </GButton>
              </li>
            </ul>
          </section>

          <!-- Anything needing the user's attention comes before anything decorative -->
          <section v-if="actionableOrders.length" class="realfi-notice realfi-notice--warn">
            <div class="realfi-notice__text">
              <p class="t-body-lg mb-1">{{ $t('realfi.attention.title') }}</p>
              <p class="t-body-sm realfi-notice__body">
                {{
                  $tc(
                    canTransact ? 'realfi.attention.bodyInWallet' : 'realfi.attention.body',
                    actionableOrders.length,
                  )
                }}
              </p>
            </div>
            <!-- One transaction cancels every stranded order. Without in-wallet
                 orders the banner hands off to RealFi instead. -->
            <template v-if="canTransact">
              <GButton
                v-if="!ordersLocked"
                tier="secondary"
                compact
                @click="cancelOrders(actionableOrders)"
              >
                {{ $tc('realfi.attention.cancelCta', actionableOrders.length) }}
              </GButton>
            </template>
            <GButton v-else tier="secondary" compact @click="openRealFiApp()">
              {{ $t('realfi.attention.cta') }}
            </GButton>
          </section>

          <!-- Failed with no documented recovery: RealFi support is the way out. -->
          <section v-if="failedOrders.length" class="realfi-notice realfi-notice--error">
            <div class="realfi-notice__text">
              <p class="t-body-lg mb-1">{{ $t('realfi.failed.title') }}</p>
              <p class="t-body-sm realfi-notice__body">
                {{ $tc('realfi.failed.body', failedOrders.length) }}
              </p>
            </div>
            <GButton tier="secondary" compact @click="openRealFiSupport()">
              {{ $t('realfi.failed.cta') }}
            </GButton>
          </section>

          <!-- In compliance review: nothing is wrong, but a still order looks stuck. -->
          <section v-if="reviewOrders.length" class="realfi-notice">
            <div class="realfi-notice__text">
              <p class="t-body-lg mb-1">{{ $t('realfi.review.title') }}</p>
              <p class="t-body-sm realfi-notice__body">
                {{ $tc('realfi.review.body', reviewOrders.length) }}
              </p>
            </div>
          </section>
          </template>

          <!-- Points and referrals render with or without a stake: a wallet can hold
               points or referral results before it stakes, and the invite link is how
               a new user brings a friend before doing anything else. -->
          <div class="realfi-grid">
            <!-- Points -->
            <section class="realfi-card">
              <div class="realfi-card__head">
                <span class="t-label">{{ $t('realfi.points.label') }}</span>
                <p class="t-caption realfi-card__about">{{ $t('realfi.points.about') }}</p>
              </div>
              <template v-if="hasPointsRecord">
                <p class="realfi-stat g-num">
                  {{ pointsLabel }}
                  <span v-if="multiplierLabel" class="realfi-mult">{{ multiplierLabel }}</span>
                </p>
                <div v-if="potentialLabel" class="realfi-row">
                  <span class="t-caption">{{ $t('realfi.points.pending') }}</span>
                  <span class="t-body-sm realfi-strong g-num">{{ potentialLabel }}</span>
                </div>
              </template>
              <p v-else class="t-body realfi-muted">{{ $t('realfi.points.none') }}</p>
            </section>

            <!-- Referrals -->
            <section class="realfi-card">
              <div :class="['realfi-card__head', { 'realfi-card__head--action': referrals.code }]">
                <span class="t-label">{{ $t('realfi.referrals.label') }}</span>
                <!-- The link, not the bare code, is what to share: RealFi reads `ref`
                     from the address a friend first arrives on. -->
                <GButton v-if="referrals.code" tier="secondary" compact @click="copyInviteLink()">
                  {{ inviteCopied ? $t('common.copied') : $t('realfi.referrals.copyLink') }}
                </GButton>
              </div>
              <p v-if="!referrals.code" class="t-body realfi-muted realfi-card__intro">
                {{ $t('realfi.referrals.none') }}
              </p>
              <div class="realfi-row">
                <span class="t-caption">{{ $t('realfi.referrals.code') }}</span>
                <span v-if="referrals.code" class="g-mono realfi-strong">{{ referrals.code }}</span>
                <!-- Reading a code on RealFi CREATES one and joins their referral
                     programme, so it only ever happens on this tap. -->
                <GButton
                  v-else
                  tier="secondary"
                  compact
                  :loading="isRequestingCode"
                  @click="requestReferralCode()"
                >
                  {{ $t('realfi.referrals.get') }}
                </GButton>
              </div>
              <!-- The totals are genuine reads, loaded with the page. They never waited
                   on the code, and a user who has invited people should see it. -->
              <div class="realfi-row">
                <span class="t-caption">{{ $t('realfi.referrals.invited') }}</span>
                <span class="t-body-sm realfi-strong g-num">{{ invitedLabel }}</span>
              </div>
              <div class="realfi-row">
                <span class="t-caption">{{ $t('realfi.referrals.earned') }}</span>
                <span class="t-body-sm realfi-strong g-num">{{ referralPointsLabel }}</span>
              </div>
              <p v-if="referrals.code" class="t-caption realfi-muted realfi-card__foot">
                {{ $t('realfi.referrals.linkHint') }}
              </p>
            </section>

            <!-- Activity — once there is some, or an order is on its way; the start card
                 covers "none yet". -->
            <section v-if="!isEmpty || pendingOrders.length" class="realfi-card">
              <div class="realfi-card__head">
                <span class="t-label">{{ $t('realfi.activity.label') }}</span>
              </div>
              <ul v-if="orders.length || pendingOrders.length" class="realfi-orders">
                <!-- Orders sent that RealFi has not listed yet, shown the way the home
                     screen shows an unconfirmed transaction. They survive a refresh. -->
                <li
                  v-for="pending in pendingOrders"
                  :key="pending.txId"
                  class="realfi-order realfi-order--pending"
                >
                  <span class="realfi-order__what">
                    <span class="realfi-order__label">
                      <span class="t-body-sm">{{ pendingLabel(pending.kind) }}</span>
                      <v-progress-circular
                        indeterminate
                        :size="12"
                        :width="2"
                        color="warning"
                        class="flex-shrink-0"
                        :aria-label="$t('dashboard.transactionPendingConfirmation')"
                        :title="$t('dashboard.transactionPendingConfirmation')"
                      />
                    </span>
                    <span class="t-caption g-mono realfi-order__tx" :title="pending.txId">
                      {{ shortTx(pending.txId) }}
                    </span>
                  </span>
                  <span class="realfi-order__side">
                    <span class="realfi-pill realfi-pill--wait">{{ $t('common.pending') }}</span>
                  </span>
                </li>
                <li
                  v-for="order in orders"
                  :key="`${order.txHash}#${order.outputIndex}`"
                  class="realfi-order"
                >
                  <span class="realfi-order__what">
                    <span class="t-body-sm realfi-order__label">
                      {{ actionLabel(order.action) }}
                      <span v-if="orderAmountLabel(order)" class="g-num realfi-strong">
                        {{ orderAmountLabel(order) }}
                      </span>
                    </span>
                    <span v-if="claimableFrom(order)" class="t-caption realfi-order__when">
                      {{ $t('realfi.claim.from', { date: claimableFrom(order) }) }}
                    </span>
                    <!-- The id RealFi support asks for, and what a failed order's
                         notice tells the user to send them. -->
                    <span class="t-caption g-mono realfi-order__tx" :title="order.txHash">
                      {{ shortTx(order.txHash) }}
                    </span>
                  </span>
                  <span class="realfi-order__side">
                    <template v-if="canTransact && !ordersLocked">
                      <GButton
                        v-if="isRowClaimable(order)"
                        tier="primary"
                        compact
                        @click="claim(order)"
                      >
                        {{ $t('dashboard.claim') }}
                      </GButton>
                      <GButton
                        v-else-if="isRowCancellable(order)"
                        tier="tertiary"
                        compact
                        @click="cancelOrders([order])"
                      >
                        {{ $t('realfi.cancel.cta') }}
                      </GButton>
                    </template>
                    <span :class="['realfi-pill', pillClass(order.status)]">
                      {{ statusLabel(order.status) }}
                    </span>
                  </span>
                </li>
              </ul>
              <p v-else class="t-body realfi-muted">{{ $t('realfi.activity.none') }}</p>
            </section>
          </div>

          <p v-if="isTestnet" class="t-caption realfi-foot">{{ $t('realfi.preview') }}</p>
        </template>

        <template v-if="canTransact">
          <RealFiAmountDialog
            v-if="amountMode"
            :isOpen="!!amountMode"
            :mode="amountMode"
            :balanceUnits="amountMode === 'stake' ? usdrUnits : susdrUnits"
            :unlockDate="unlockDateLabel"
            :rate="rate === null ? null : rate.toString()"
            :apyPercent="protocol && (protocol.apyAvg90Percent != null ? protocol.apyAvg90Percent : protocol.apyPercent)"
            @close="amountMode = null"
            @confirm="onAmountConfirm"
          />
          <RealFiOrderFlow ref="flow" @placed="onPlaced" @support="openRealFiSupport()" />
        </template>
        <SwapDialog
          v-if="swapDialogOpen && canSwapUsdcx"
          :isOpen="swapDialogOpen"
          :sellTokenUnit="swapSellTokenUnit"
          :buyTokenUnit="swapBuyTokenUnit"
          @close="closeSwapDialog()"
        />
      </v-col>
    </v-row>
  </v-layout>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { formatUsd, formatInt, formatSignedChange } from '@/shared/utils/format';
import i18n from '@/plugins/i18n';
import snackbar from '@/plugins/snackbar';
import WalletStore from '@/stores/walletStore';
import { Blockchain, Network } from '@/models/types';
import featureFlagsStore from '@/stores/featureFlagsStore';
import { useRealFi } from './composables/useRealFi';
import RealFiYieldChart from './components/RealFiYieldChart.vue';
import RealFiGettingStarted from './components/RealFiGettingStarted.vue';
import { heldUnits, MAINNET_USDCX_UNIT, usdcxAssetIdFor, usdrAssetIdFor } from './assets';
import { useRealFiSwapAvailability } from './composables/useRealFiSwapAvailability';
import type { RealFiBuildRequest, RealFiOrderKind } from './services/realfiOrders';
import {
  PENDING_MAX_AGE_MS,
  readPendingOrders,
  savePendingOrders,
  type PendingOrder,
} from './pendingOrders';
import {
  fromSmallestUnit,
  isCancellable,
  isClaimable,
  isUnclaimed,
  susdrRate,
  usdrForSusdr,
  ORDER_STATUSES_FAILED,
  ORDER_STATUSES_NEEDING_ACTION,
  type RealFiOrder,
  type RealFiOrderAction,
  type RealFiOrderStatus,
  type SmallestUnit,
} from './types';

// Loaded only when in-wallet orders are on: they pull in every wallet type's signer.
const RealFiAmountDialog = defineAsyncComponent(
  () => import('./components/RealFiAmountDialog.vue'),
);
const RealFiOrderFlow = defineAsyncComponent(() => import('./components/RealFiOrderFlow.vue'));
const SwapDialog = defineAsyncComponent(
  () => import('@/modules/dashboard/dialogs/SwapDialog.vue'),
);

const {
  isLoading,
  unavailableReason,
  position,
  points,
  referrals,
  orders,
  actionableOrders,
  reviewOrders,
  failedOrders,
  hasPosition,
  hasPointsRecord,
  usdrBalance,
  hasUsdr,
  protocol,
  isRequestingCode,
  load,
  requestReferralCode,
  canTransact,
  usdrUnits,
  susdrUnits,
  susdrBalance,
  currentSlot,
} = useRealFi();

const t = (key: string, values?: Record<string, unknown>) => i18n.t(key, values) as string;

/* ── Network ──────────────────────────────────────────────────────────────── */

const isTestnet = computed(() => WalletStore.state.loggedWallet?.network !== Network.MAINNET);
const isMainnet = computed(() => {
  const w = WalletStore.state.loggedWallet;
  return w?.chain === Blockchain.CARDANO && w.network === Network.MAINNET;
});
const swapEnabled = computed(() => featureFlagsStore.isSwapEnabled());
const {
  status: usdrfSwapStatus,
  isUsdcxAvailable: hasUsdcxSwapAvailability,
  isUsdrfAvailable: hasUsdrfSwapAvailability,
  canCheck: canCheckUsdrfAvailability,
  refresh: refreshUsdrfAvailability,
} = useRealFiSwapAvailability();
const swapStatusForGuide = computed(() =>
  swapEnabled.value ? usdrfSwapStatus.value : 'disabled',
);
const canRetryUsdrfAvailability = computed(
  () => canCheckUsdrfAvailability.value && ['unknown', 'unavailable'].includes(usdrfSwapStatus.value),
);
// ADA → USDCx, the first leg. It needs only USDCx in the swap catalogue: tying it to
// USDrf being listed hid a working swap behind one that does not exist yet.
const canSwapUsdcx = computed(
  () => isMainnet.value && !unavailableReason.value && hasUsdcxSwapAvailability.value,
);
// USDCx → USDrf is a separate, default-off flag: its only route is the SundaeSwap V4
// pool, which the aggregator serves only after V4 is promoted.
const canSwapUsdrf = computed(
  () => canSwapUsdcx.value && hasUsdrfSwapAvailability.value && featureFlagsStore.isRealFiUsdrfSwapEnabled(),
);
// USDCx already in the wallet: the guide skips the ADA swap and goes to the USDrf leg.
const usdcxUnits = computed<SmallestUnit>(() =>
  heldUnits(WalletStore.state.tokens, usdcxAssetIdFor(WalletStore.state.loggedWallet?.network)),
);
const hasUsdcx = computed(() => BigInt(usdcxUnits.value) > 0n);
const usdcxLabel = computed(() => unitsLabel(usdcxUnits.value, 'USDCx'));
const mainnetUsdrfUnit = usdrAssetIdFor(Network.MAINNET) ?? '';
const swapDialogOpen = ref(false);
const swapSellTokenUnit = ref('');
const swapBuyTokenUnit = ref('');
const activeSwapScope = ref('');
const swapScope = computed(() => {
  const w = WalletStore.state.loggedWallet;
  return `${w?.id ?? ''}:${w?.chain ?? ''}:${w?.network ?? ''}:${w?.baseAddress ?? ''}:${canSwapUsdcx.value}`;
});

watch(swapScope, (scope) => {
  if (swapDialogOpen.value && scope !== activeSwapScope.value) closeSwapDialog(false);
});

// The USDrf swap flag is live: switching it off closes an open USDCx → USDrf dialog. The
// ADA → USDCx swap does not depend on it and stays open.
watch(canSwapUsdrf, (canSwap) => {
  if (!canSwap && swapDialogOpen.value && swapBuyTokenUnit.value === mainnetUsdrfUnit) {
    closeSwapDialog(false);
  }
});

function openUsdrfSwap(): void {
  if (!canSwapUsdrf.value) return;
  swapSellTokenUnit.value = MAINNET_USDCX_UNIT;
  swapBuyTokenUnit.value = mainnetUsdrfUnit;
  activeSwapScope.value = swapScope.value;
  swapDialogOpen.value = true;
}

function openUsdcxSwap(): void {
  if (!canSwapUsdcx.value) return;
  swapSellTokenUnit.value = 'lovelace';
  swapBuyTokenUnit.value = MAINNET_USDCX_UNIT;
  activeSwapScope.value = swapScope.value;
  swapDialogOpen.value = true;
}

function onGetUsdrf(): void {
  if (canSwapUsdrf.value) openUsdrfSwap();
  else if (isTestnet.value) openRealFiApp();
}

function onStake(): void {
  if (ordersLocked.value) return;
  if (canTransact.value) openAmount('stake');
  else openRealFiApp();
}

function closeSwapDialog(refresh = true): void {
  const wasOpen = swapDialogOpen.value;
  swapDialogOpen.value = false;
  swapSellTokenUnit.value = '';
  swapBuyTokenUnit.value = '';
  activeSwapScope.value = '';
  if (refresh && wasOpen) void load({ quiet: true });
}

/**
 * RealFi's own app for the wallet's network. Constants, never built from remote data,
 * so window.open has no injection surface. Transacting happens there whenever Gero
 * does not place the order itself: the staking flag is off, or there is no USDrf yet.
 */
const realFiAppUrl = computed(() =>
  isTestnet.value ? 'https://preprod.realfi.co' : 'https://app.realfi.co',
);

function openRealFiApp(): void {
  window.open(realFiAppUrl.value, '_blank', 'noopener,noreferrer');
}

/** RealFi's contact page — the `support` URL in their own runtime config. */
const REALFI_SUPPORT_URL = 'https://realfi.co/contact';

function openRealFiSupport(): void {
  window.open(REALFI_SUPPORT_URL, '_blank', 'noopener,noreferrer');
}

/* ── Start state ──────────────────────────────────────────────────────────── */

/**
 * Nothing to show yet: no position AND no orders. Orders matter to the check — a
 * wallet that has unstaked everything still has a cooldown and an activity trail
 * worth seeing, and a "get started" screen would be wrong for it.
 */
const isEmpty = computed(() => !hasPosition.value && orders.value.length === 0);

/**
 * Full figure, not formatBalance's compact "2.50K": this sits in a sentence telling
 * someone what they hold, and USDrf tracks the dollar, so cents are the right unit.
 */
const usdrLabel = computed(() => `${formatUsd(usdrBalance.value, { symbol: false })} USDrf`);

/**
 * RealFi's published fund APY, only ever with its date. It is the private-credit
 * fund's gross weighted average and can be months old, so a bare percentage would
 * read as a live promise. Nothing is shown when RealFi publishes nothing.
 */
const apyLabel = computed(() => {
  const p = protocol.value;
  if (!p || p.apyPercent === null || !p.apyAsOf) return '';
  const date = new Date(`${p.apyAsOf}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  return t('realfi.apy', {
    rate: p.apyPercent.toFixed(1),
    date: date.toLocaleDateString(i18n.locale, { dateStyle: 'medium', timeZone: 'UTC' }),
  });
});

/* ── Position ─────────────────────────────────────────────────────────────── */

const positionValue = computed(() => formatUsd(fromSmallestUnit(position.value?.totalUSDrValue)));
const principalLabel = computed(() => formatUsd(fromSmallestUnit(position.value?.principal)));

const earnedAmount = computed(() => fromSmallestUnit(position.value?.earned));

/** Money, formatted as money. */
const earnedLabel = computed(() => formatUsd(earnedAmount.value));

/**
 * The direction, carried by the glyph.
 *
 * `formatSignedChange` is the PERCENTAGE formatter — it appends '%' — so it takes
 * `yieldPercent`, never the dollar amount. Feeding it the earned figure renders
 * "$382.14 earned" as "▲ 382.1%", which is how this read before.
 *
 * Note this is yield to date, not an APY: the SDK does not return a rate, and
 * labelling a cumulative figure "APY" would overstate it.
 */
const yieldLabel = computed(() => formatSignedChange(position.value?.yieldPercent ?? 0));

/** Colour reinforces the glyph; it is never the only signal. */
const deltaClass = computed(() => (earnedAmount.value < 0 ? 'delta-down' : 'delta-up'));

/* ── Points and referrals ─────────────────────────────────────────────────── */

const pointsLabel = computed(() => formatInt(points.value.pointsBalance));
const potentialLabel = computed(() =>
  points.value.potentialPoints ? formatInt(points.value.potentialPoints) : '',
);
const multiplierLabel = computed(() =>
  points.value.multiplier ? `${points.value.multiplier}×` : '',
);
const invitedLabel = computed(() => formatInt(referrals.value.invitedCount));

/** RealFi's app on this wallet's network, carrying the code as the `ref` it reads. */
const inviteLink = computed(() =>
  referrals.value.code
    ? `${realFiAppUrl.value}/?ref=${encodeURIComponent(referrals.value.code)}`
    : '',
);

const inviteCopied = ref(false);
let inviteCopiedTimer: ReturnType<typeof setTimeout> | null = null;

async function copyInviteLink(): Promise<void> {
  if (!inviteLink.value) return;
  try {
    await navigator.clipboard.writeText(inviteLink.value);
  } catch {
    // No clipboard permission: leave the label as it was rather than claim a copy.
    return;
  }
  inviteCopied.value = true;
  if (inviteCopiedTimer) clearTimeout(inviteCopiedTimer);
  inviteCopiedTimer = setTimeout(() => {
    inviteCopied.value = false;
  }, 2000);
}

const referralPointsLabel = computed(() => formatInt(referrals.value.rewardPoints));

/* ── Orders ───────────────────────────────────────────────────────────────── */

function actionLabel(action: RealFiOrderAction): string {
  // lowerFirst, not toLowerCase: `DirectMint` must map to `directMint`.
  return t(`realfi.actions.${lowerFirst(action)}`);
}

function statusLabel(status: RealFiOrderStatus): string {
  return t(`realfi.statuses.${lowerFirst(status)}`);
}

/** `d26ab7…0690f6` — enough to match against an explorer or a support reply. */
function shortTx(txHash: string): string {
  return txHash.length > 14 ? `${txHash.slice(0, 6)}…${txHash.slice(-6)}` : txHash;
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function pillClass(status: RealFiOrderStatus): string {
  if (status === 'Executed') return 'realfi-pill--ok';
  if (ORDER_STATUSES_NEEDING_ACTION.includes(status) || ORDER_STATUSES_FAILED.includes(status)) {
    return 'realfi-pill--warn';
  }
  return 'realfi-pill--wait';
}

/* ── In-wallet orders ── */

/** An unstake binds to the protocol's next cooldown boundary; without it, none can be built. */
const canUnstake = computed(() => susdrBalance.value > 0 && !!protocol.value?.nextCooldownSlot);

const amountMode = ref<'stake' | 'unstake' | null>(null);
const flow = ref<{ run(req: RealFiBuildRequest): Promise<void> } | null>(null);

function openAmount(mode: 'stake' | 'unstake'): void {
  amountMode.value = mode;
}

/**
 * When a slot arrives, as a local date and time. Post-Shelley a slot is one second
 * on both mainnet and preprod, so the distance from the tip is the wait.
 */
function slotToDate(slot: string | null | undefined): string {
  const tip = currentSlot.value;
  if (!slot || tip === null) return '';
  const at = new Date(Date.now() + (Number(slot) - tip) * 1000);
  return at.toLocaleString(i18n.locale, { dateStyle: 'medium', timeStyle: 'short' });
}

const unlockDateLabel = computed(() => slotToDate(protocol.value?.nextCooldownSlot));

function onAmountConfirm(amount: SmallestUnit): void {
  const mode = amountMode.value;
  amountMode.value = null;
  const unlockSlot = protocol.value?.nextCooldownSlot;
  if (mode === 'stake') {
    void flow.value?.run({ kind: 'stake', amount });
  } else if (mode === 'unstake' && unlockSlot) {
    void flow.value?.run({ kind: 'unstake', amount, unlockSlot });
  } else {
    // A reload between opening the dialog and confirming took the cooldown slot away.
    snackbar.setError(t('realfi.order.errors.buildFailed'));
  }
}

/* ── Orders sent, not listed yet ── */

/**
 * Orders on chain that RealFi has not listed yet, newest first.
 *
 * RealFi indexes asynchronously, and on preprod that has run past two minutes. Each
 * one shows in Activity as pending until it is listed, is kept across a refresh (see
 * `pendingOrders.ts`), and is re-checked on one timer, so several can be in flight.
 */
const pendingOrders = ref<PendingOrder[]>([]);
/** Advanced on each re-check; drives the order lock below. */
const now = ref(Date.now());

/**
 * Nexus caches a wallet's orders for 15 s, so checking any faster would only read the
 * same answer again.
 */
const PENDING_POLL_MS = 15_000;
/**
 * New orders wait this long after one is sent: until then the wallet's own balance
 * may still show the funds just spent, and would offer them again.
 */
const ORDER_LOCK_MS = 120_000;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

const ordersLocked = computed(() =>
  pendingOrders.value.some((p) => now.value - p.at < ORDER_LOCK_MS),
);

interface PendingOwner {
  network: string;
  address: string;
}

/** The logged-in wallet's storage key; null when there is no address to key on. */
function currentWalletKey(): PendingOwner | null {
  const w = WalletStore.state.loggedWallet;
  return w?.network && w.baseAddress ? { network: w.network, address: w.baseAddress } : null;
}

/**
 * The wallet `pendingOrders` belongs to, fixed when the list is loaded, never read
 * live. The page is kept alive across a wallet switch, so a live read would save
 * one wallet's pending orders under the next wallet's key.
 */
let pendingOwner: PendingOwner | null = null;

/** Worded like the settled row it will become, as the home screen does for a send. */
const PENDING_LABEL_KEYS: Record<RealFiOrderKind, string> = {
  stake: 'realfi.actions.stake',
  unstake: 'realfi.actions.unstake',
  claim: 'realfi.activity.claimed',
  cancel: 'realfi.statuses.canceled',
};

function pendingLabel(kind: RealFiOrderKind): string {
  return t(PENDING_LABEL_KEYS[kind]);
}

function clearPendingTimer(): void {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = null;
}

/** A new order shows as its own tx; a claim or cancel as the order it settled. */
function hasLanded(txId: string): boolean {
  return orders.value.some(
    (o) => o.txHash === txId || o.resultTxHash === txId || o.claimTxHash === txId,
  );
}

/** Drop what RealFi now lists or what has aged out, and keep storage in step. */
function settlePending(): void {
  now.value = Date.now();
  const still = pendingOrders.value.filter(
    (p) => !hasLanded(p.txId) && now.value - p.at < PENDING_MAX_AGE_MS,
  );
  if (still.length !== pendingOrders.value.length) pendingOrders.value = still;
  if (!still.length) clearPendingTimer();
  if (pendingOwner) savePendingOrders(pendingOwner.network, pendingOwner.address, still);
}

/** One timer for every pending order: re-read the order list, settle, go again. */
function schedulePendingCheck(): void {
  clearPendingTimer();
  if (!pendingOrders.value.length) return;
  pendingTimer = setTimeout(async () => {
    await load({ quiet: true, ordersOnly: true });
    settlePending();
    schedulePendingCheck();
  }, PENDING_POLL_MS);
}

function onPlaced(txId: string, kind: RealFiOrderKind): void {
  now.value = Date.now();
  pendingOrders.value = [
    { txId, kind, at: now.value },
    ...pendingOrders.value.filter((p) => p.txId !== txId),
  ];
  settlePending();
  void load();
  schedulePendingCheck();
}

/**
 * Load the logged-in wallet's pending orders: those sent on an earlier visit that
 * RealFi had not listed yet. Also run on a wallet switch, which swaps the list for
 * the new wallet's (the old one's stays saved under its own key).
 */
function restorePending(): void {
  clearPendingTimer();
  pendingOwner = currentWalletKey();
  pendingOrders.value = pendingOwner
    ? readPendingOrders(pendingOwner.network, pendingOwner.address)
    : [];
  schedulePendingCheck();
}

watch(
  () => {
    const w = WalletStore.state.loggedWallet;
    return `${w?.network ?? ''}:${w?.baseAddress ?? ''}`;
  },
  restorePending,
);

// Any fresh order list (the page's own loads included) may list a pending order.
watch(orders, () => {
  if (pendingOrders.value.length) settlePending();
});

onMounted(restorePending);
onBeforeUnmount(() => {
  clearPendingTimer();
  if (inviteCopiedTimer) clearTimeout(inviteCopiedTimer);
});

function claim(order: RealFiOrder | undefined): void {
  if (!order?.resultTxHash || order.resultOutputIndex === undefined || !order.unlockSlot) {
    snackbar.setError(t('realfi.order.errors.buildFailed'));
    return;
  }
  void flow.value?.run({
    kind: 'claim',
    resultUtxo: { txHash: order.resultTxHash, index: order.resultOutputIndex },
    unlockSlot: order.unlockSlot,
  });
}

function cancelOrders(list: RealFiOrder[]): void {
  if (!list.length) return;
  void flow.value?.run({
    kind: 'cancel',
    orderInputs: list.map((o) => ({ txHash: o.txHash, index: o.outputIndex })),
  });
}

function isRowClaimable(order: RealFiOrder): boolean {
  return isClaimable(order, currentSlot.value);
}

function isRowCancellable(order: RealFiOrder): boolean {
  return isCancellable(order);
}

/** A smallest-unit amount as "5,168.24 USDrf". Tokens track the dollar, so cents. */
function unitsLabel(units: SmallestUnit, ticker: string): string {
  return `${formatUsd(fromSmallestUnit(units), { symbol: false })} ${ticker}`;
}

/** What an order put in, in its own token. Only the two actions Gero places. */
function orderAmountLabel(order: RealFiOrder): string {
  if (!order.amount) return '';
  if (order.action === 'Stake') return unitsLabel(order.amount, 'USDrf');
  if (order.action === 'Unstake') return unitsLabel(order.amount, 'sUSDrf');
  return '';
}

/* ── Rate and yield ── */

/** USDrf per sUSDrf now, scaled by 1e6, by RealFi's formula; null without its inputs. */
const rate = computed<bigint | null>(() => {
  const inputs = protocol.value?.rateInputs;
  return inputs ? susdrRate(inputs, Date.now()) : null;
});

const rateLabel = computed(() =>
  rate.value === null ? '' : t('realfi.rate', { rate: fromSmallestUnit(rate.value.toString()).toFixed(4) }),
);

/** "4,169.64 sUSDrf · 1 sUSDrf = 1.0336 USDrf": what is held, and what it is worth. */
const holdingLabel = computed(() => {
  const held = position.value?.totalSUSDr;
  if (!held || held === '0') return '';
  return [unitsLabel(held, 'sUSDrf'), rateLabel.value].filter(Boolean).join(' · ');
});

const apyHistory = computed(() => protocol.value?.apyHistory ?? []);
const apyAvg = computed(() => protocol.value?.apyAvg90Percent ?? 0);
/** Two days make a line; fewer, and the one-line APY says it better. */
const showYieldChart = computed(
  () => apyHistory.value.length >= 2 && protocol.value?.apyAvg90Percent != null,
);

/* ── Unstaking ── */

/** "2d 3h", "14h 20m", "12m": the wait, at the precision a person plans with. */
function formatWait(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return t('realfi.duration.dh', { d, h });
  if (h > 0) return t('realfi.duration.hm', { h, m });
  return t('realfi.duration.m', { m: Math.max(m, 1) });
}

interface UnstakeView {
  key: string;
  order: RealFiOrder;
  /** USDrf when known (exact from Nexus, or estimated at today's rate), else sUSDrf. */
  amount: string;
  /** Units of USDrf behind `amount`, for the total; null when only sUSDrf is known. */
  usdrUnits: bigint | null;
  from: string;
  /** 0..1 through the cooldown; null when its start is unknown. */
  progress: number | null;
  ready: boolean;
  when: string;
  secondsLeft: number;
}

/**
 * Every unstake whose USDrf has not been claimed. Nexus reads the exact USDrf from
 * the timelock; until it can, the sUSDrf sent in is converted at today's rate and
 * marked as an estimate, and without a rate the sUSDrf itself is shown.
 */
const unstakes = computed<UnstakeView[]>(() =>
  orders.value.filter(isUnclaimed).map((order) => {
    const tip = currentSlot.value;
    const unlock = Number(order.unlockSlot);
    const ready = isClaimable(order, tip);
    let usdrUnits: bigint | null = null;
    let amount: string;
    if (order.resultAmount) {
      usdrUnits = BigInt(order.resultAmount);
      amount = unitsLabel(order.resultAmount, 'USDrf');
    } else if (order.amount && rate.value !== null) {
      const est = usdrForSusdr(order.amount, rate.value);
      usdrUnits = BigInt(est);
      amount = `≈ ${unitsLabel(est, 'USDrf')}`;
    } else {
      amount = unitsLabel(order.amount ?? '0', 'sUSDrf');
    }
    const from = usdrUnits !== null && order.amount
      ? t('realfi.unstaking.from', { amount: unitsLabel(order.amount, 'sUSDrf') })
      : '';
    const start = Number(order.slot);
    const progress = tip !== null && order.slot && unlock > start
      ? Math.min(1, Math.max(0, (tip - start) / (unlock - start)))
      : null;
    const secondsLeft = tip === null ? 0 : unlock - tip;
    const date = slotToDate(order.unlockSlot);
    const when = ready
      ? t('realfi.claim.title')
      : tip === null
        ? date
        : t('realfi.unstaking.opens', { date, wait: formatWait(secondsLeft) });
    return {
      key: `${order.txHash}#${order.outputIndex}`,
      order,
      amount,
      usdrUnits,
      from,
      progress: ready ? 1 : progress,
      ready,
      when,
      secondsLeft,
    };
  }),
);

const unstakingTitle = computed(() =>
  t(unstakes.value.some((u) => u.ready) ? 'realfi.claim.title' : 'realfi.unstaking.title'),
);

/**
 * USDrf still at RealFi after unstaking: every unclaimed unstake, cooling or ready.
 * Null when any amount is unknown in USDrf, since a partial sum would understate it.
 */
const unclaimedUsdr = computed<{ units: bigint; estimated: boolean } | null>(() => {
  const list = unstakes.value;
  if (!list.length || list.some((u) => u.usdrUnits === null)) return null;
  return {
    units: list.reduce((sum, u) => sum + (u.usdrUnits as bigint), 0n),
    estimated: list.some((u) => !u.order.resultAmount),
  };
});

/** The stat-strip cell for money in cooldown: how much, and when the next opens. */
const cooling = computed<{ amount: string; next: string } | null>(() => {
  const waiting = unstakes.value.filter((u) => !u.ready);
  if (!waiting.length) return null;
  let amount: string;
  if (waiting.every((u) => u.usdrUnits !== null)) {
    const units = waiting.reduce((sum, u) => sum + (u.usdrUnits as bigint), 0n).toString();
    const estimated = waiting.some((u) => !u.order.resultAmount);
    amount = `${estimated ? '≈ ' : ''}${unitsLabel(units, 'USDrf')}`;
  } else {
    amount = t('realfi.stats.unstakes', { n: waiting.length });
  }
  const next =
    currentSlot.value === null
      ? ''
      : t('realfi.unstaking.next', { wait: formatWait(Math.min(...waiting.map((u) => u.secondsLeft))) });
  return { amount, next };
});

/** Position plus everything unclaimed, in dollars: all the user has at RealFi. */
const totalWithRealFi = computed(() => {
  const extra = unclaimedUsdr.value;
  if (!extra) return '';
  const staked = BigInt(position.value?.totalUSDrValue ?? '0');
  const total = fromSmallestUnit((staked + extra.units).toString());
  return `${extra.estimated ? '≈ ' : ''}${formatUsd(total)}`;
});

/** "5,685.06 USDrf in cooldown · next opens in 14h 20m", as far as it is known. */
const unstakingSummary = computed(() => {
  const list = unstakes.value;
  const cooling = list.filter((u) => !u.ready);
  if (!cooling.length) return '';
  const parts: string[] = [];
  if (cooling.every((u) => u.usdrUnits !== null)) {
    const total = cooling.reduce((sum, u) => sum + (u.usdrUnits as bigint), 0n).toString();
    const estimated = cooling.some((u) => !u.order.resultAmount);
    parts.push(t('realfi.unstaking.total', {
      amount: `${estimated ? '≈ ' : ''}${unitsLabel(total, 'USDrf')}`,
    }));
  }
  if (currentSlot.value !== null) {
    const next = Math.min(...cooling.map((u) => u.secondsLeft));
    parts.push(t('realfi.unstaking.next', { wait: formatWait(next) }));
  }
  return parts.join(' · ');
});

/** For an unstake still in its cooldown: when it can be claimed. Empty otherwise. */
function claimableFrom(order: RealFiOrder): string {
  return isUnclaimed(order) && !isClaimable(order, currentSlot.value)
    ? slotToDate(order.unlockSlot)
    : '';
}

/* ── Unavailable copy ─────────────────────────────────────────────────────── */

const unavailableTitle = computed(() =>
  unavailableReason.value ? t(`realfi.unavailable.${camel(unavailableReason.value)}.title`) : '',
);
const unavailableBody = computed(() =>
  unavailableReason.value ? t(`realfi.unavailable.${camel(unavailableReason.value)}.body`) : '',
);

function camel(value: string): string {
  return value.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

onMounted(load);
</script>

<style lang="scss" scoped>
.realfi-page {
  max-width: var(--g-content-max);
  margin: 0 auto;
  padding: var(--g-s-5) var(--g-s-4);
}

.realfi-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
  margin-bottom: var(--g-s-5);
}

.realfi-lockup {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}

/* The partner mark: a ring bisected by a rule. Drawn rather than shipped as an
   asset so it inherits the token colour and stays crisp at any zoom. */
.realfi-glyph {
  position: relative;
  flex: none;
  width: 20px;
  height: 20px;
  border: 1.5px solid var(--g-partner-realfi);
  border-radius: var(--g-r-pill);

  &::after {
    content: '';
    position: absolute;
    top: -3px;
    bottom: -3px;
    left: 50%;
    width: 1.5px;
    background: var(--g-partner-realfi);
    transform: translateX(-50%);
  }
}

.realfi-hero {
  @include g-glass-panel(false);
  padding: var(--g-s-5);
  margin-bottom: var(--g-s-4);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-card);
}

.realfi-hero__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
}

.realfi-hero__value {
  margin: var(--g-s-3) 0 var(--g-s-2);
}

.realfi-hero__body--split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 340px);
  gap: var(--g-s-5);
  align-items: start;
}

.realfi-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--g-s-4);
  padding-top: var(--g-s-4);
  margin: var(--g-s-4) 0 0;
  border-top: 1px solid var(--g-hairline-1);

  dd {
    margin: 0;
  }
}

.realfi-stats__item {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  min-width: 0;

  dt {
    color: var(--g-text-3);
  }

  .t-heading {
    color: var(--g-text-1);
  }
}

.realfi-hero__holding {
  margin: 0 0 var(--g-s-2);
  color: var(--g-text-2);
}

.realfi-hero__yield {
  padding-left: var(--g-s-5);
  border-left: 1px solid var(--g-hairline-1);
}

@media (max-width: 720px) {
  .realfi-hero__body--split {
    grid-template-columns: minmax(0, 1fr);
  }

  .realfi-hero__yield {
    padding: var(--g-s-4) 0 0;
    border-left: 0;
    border-top: 1px solid var(--g-hairline-1);
  }
}

.realfi-start__yield {
  width: 100%;
  max-width: 360px;
  margin-top: var(--g-s-5);
  text-align: left;
}

.realfi-unstaking {
  @include g-glass-panel(false);
  padding: var(--g-s-4) var(--g-s-5);
  margin-bottom: var(--g-s-4);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-card);
}

.realfi-unstaking__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-2) var(--g-s-4);
  margin-bottom: var(--g-s-2);
}

.realfi-unstaking__summary {
  color: var(--g-text-2);
}

.realfi-unstaking__list {
  padding: 0;
  margin: 0;
  list-style: none;
}

.realfi-unstake {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) minmax(0, 2fr) auto;
  gap: var(--g-s-4);
  align-items: center;
  padding: var(--g-s-3) 0;
  border-top: 1px solid var(--g-hairline-1);
}

.realfi-unstake__amount,
.realfi-unstake__time {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  min-width: 0;
}

.realfi-unstake__track {
  display: block;
  height: 4px;
  overflow: hidden;
  background: var(--g-hairline-2);
  border-radius: var(--g-r-pill);
}

/* Motion as feedback: the bar only moves when the chain tip does. */
.realfi-unstake__fill {
  display: block;
  height: 100%;
  background: var(--g-partner-realfi);
  border-radius: inherit;
  transform-origin: left center;
  transition: transform var(--g-dur-base) ease;
}

.realfi-unstake__fill--ready {
  background: var(--g-success);
}

@media (max-width: 560px) {
  .realfi-unstake {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .realfi-unstake__time {
    grid-column: 1 / -1;
    grid-row: 2;
  }
}

.realfi-hero__apy {
  margin: var(--g-s-3) 0 0;
}

.realfi-hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-2);
}

.realfi-strong {
  color: var(--g-text-1);
  font-weight: 600;
}

.realfi-muted {
  margin: 0;
  color: var(--g-text-3);
}

.realfi-notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
  padding: var(--g-s-3) var(--g-s-4);
  margin-bottom: var(--g-s-4);
  background: var(--g-overlay);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
}

.realfi-notice--warn {
  background: var(--g-warning-fill);
  border-color: var(--g-warning-line);
}

.realfi-notice--error {
  background: var(--g-error-fill);
  border-color: var(--g-error-line);
}

.realfi-notice__text {
  flex: 1 1 240px;
}

.realfi-notice__body {
  margin: 0;
  color: var(--g-text-2);
}

.realfi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--g-s-4);
}

.realfi-card {
  @include g-glass-panel(false);
  padding: var(--g-s-4);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
}

.realfi-card__intro {
  margin-bottom: var(--g-s-2);
}

.realfi-card__head {
  margin-bottom: var(--g-s-3);
}

.realfi-card__head--action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
}

.realfi-card__foot {
  margin-top: var(--g-s-3);
}

.realfi-card__about {
  margin: var(--g-s-1) 0 0;
  color: var(--g-text-3);
}

.realfi-stat {
  margin: 0;
  font-size: 24px;
  font-weight: 620;
  letter-spacing: -0.02em;
  color: var(--g-text-1);
}

.realfi-mult {
  display: inline-flex;
  align-items: center;
  padding: 2px var(--g-s-2);
  margin-left: var(--g-s-2);
  font-size: 11px;
  font-weight: 700;
  color: var(--g-accent);
  vertical-align: middle;
  background: var(--g-overlay);
  border-radius: var(--g-r-chip);
}

.realfi-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-3);
  padding: var(--g-s-2) 0;
  border-bottom: 1px solid var(--g-hairline-1);

  &:last-child {
    border-bottom: none;
  }
}

.realfi-orders {
  padding: 0;
  margin: 0;
  list-style: none;
}

.realfi-order {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
  min-height: var(--g-row-h-panel);
  border-bottom: 1px solid var(--g-hairline-1);

  &:last-child {
    border-bottom: none;
  }
}

.realfi-order__what {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.realfi-order__side {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--g-s-2);
}

.realfi-order__label {
  display: flex;
  align-items: center;
  gap: var(--g-s-1);
  white-space: nowrap;
}

.realfi-order__when {
  color: var(--g-text-2);
}

.realfi-order__tx {
  color: var(--g-text-3);
}

.realfi-pill {
  padding: 3px var(--g-s-2);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  border-radius: var(--g-r-pill);
}

.realfi-pill--ok {
  color: var(--g-success);
  background: var(--g-success-fill);
  border: 1px solid var(--g-success-line);
}

.realfi-pill--warn {
  color: var(--g-warning);
  background: var(--g-warning-fill);
  border: 1px solid var(--g-warning-line);
}

.realfi-pill--wait {
  color: var(--g-text-2);
  background: var(--g-overlay);
  border: 1px solid var(--g-hairline-2);
}

.realfi-start {
  @include g-glass-panel(false);
  margin-bottom: var(--g-s-4);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--g-s-6) var(--g-s-5);
  text-align: center;
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-card);
}

.realfi-glyph--lg {
  width: 32px;
  height: 32px;
  margin-bottom: var(--g-s-4);
  border-width: 2px;

  &::after {
    width: 2px;
  }
}

.realfi-start__title {
  margin: 0 0 var(--g-s-2);
}

.realfi-start__body {
  max-width: 46ch;
  margin: 0;
}

.realfi-start__note {
  max-width: 46ch;
  margin: var(--g-s-4) 0 0;
}

.realfi-empty {
  padding: var(--g-s-6) var(--g-s-5);
  text-align: center;
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
}

.realfi-empty__body {
  max-width: 46ch;
  margin: 0 auto;
}

.realfi-skeleton {
  height: 120px;
}

.realfi-skeleton--hero {
  grid-column: 1 / -1;
  height: 148px;
}

.realfi-foot {
  margin-top: var(--g-s-4);
}
</style>
