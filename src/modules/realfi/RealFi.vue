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
          <!-- An order just went on chain but RealFi has not indexed it yet. Without
               this the page would re-offer the same USDrf, inviting a second order. -->
          <section v-if="pendingTxId" class="realfi-notice">
            <div class="realfi-notice__text">
              <p class="t-body-lg mb-1">{{ $t('realfi.pending.title') }}</p>
              <p class="t-body-sm realfi-notice__body">{{ $t('realfi.pending.body') }}</p>
            </div>
          </section>

          <!-- Nothing staked and no activity. Rendering the hero here would show "$0.00"
               with no explanation, and at launch that is every user's first look. -->
          <section v-if="isEmpty" class="realfi-start">
            <span class="realfi-glyph realfi-glyph--lg" aria-hidden="true"></span>
            <!-- Holding USDrf but nothing staked is a DIFFERENT state from holding
                 nothing: telling someone with 9,994 USDrf to "get USDrf" is noise. -->
            <template v-if="hasUsdr">
              <h2 class="t-heading realfi-start__title">{{ $t('realfi.start.readyTitle') }}</h2>
              <p class="t-body realfi-start__body">
                {{ $t('realfi.start.readyBody', { amount: usdrLabel }) }}
              </p>
              <template v-if="canTransact">
                <GButton
                  v-if="!pendingTxId"
                  tier="primary"
                  class="mt-4"
                  @click="openAmount('stake')"
                >
                  {{ $t('realfi.start.stakeCta') }}
                </GButton>
              </template>
              <GButton v-else tier="primary" class="mt-4" @click="openRealFiApp()">
                {{ $t('realfi.start.readyCta') }}
              </GButton>
            </template>
            <template v-else>
              <h2 class="t-heading realfi-start__title">{{ $t('realfi.start.title') }}</h2>
              <p class="t-body realfi-start__body">{{ $t('realfi.start.body') }}</p>
              <GButton tier="primary" class="mt-4" @click="openRealFiApp()">
                {{ $t('realfi.start.cta') }}
              </GButton>
            </template>
            <p v-if="apyLabel" class="t-caption realfi-start__note">{{ apyLabel }}</p>
            <p v-if="!canTransact" class="t-caption realfi-start__note">
              {{ $t('realfi.start.note') }}
            </p>
          </section>

          <template v-else>
          <!-- Position -->
          <section class="realfi-hero">
            <div class="realfi-hero__top">
              <span class="t-label">{{ $t('realfi.position.label') }}</span>
              <!-- Plain coloured text, never a chip: the design language reserves
                   chips for status and gives deltas a glyph instead. -->
              <span :class="['t-body-sm', 'g-num', deltaClass]">{{ yieldLabel }}</span>
            </div>

            <p class="t-display g-num realfi-hero__value">{{ positionValue }}</p>

            <div class="realfi-hero__meta">
              <span class="t-body-sm">
                {{ $t('realfi.position.earned') }}
                <b :class="['realfi-strong', 'g-num', deltaClass]">{{ earnedLabel }}</b>
              </span>
              <span class="t-body-sm">
                {{ $t('realfi.position.principal') }}
                <b class="realfi-strong g-num">{{ principalLabel }}</b>
              </span>
            </div>
            <p v-if="apyLabel" class="t-caption realfi-hero__apy">{{ apyLabel }}</p>
            <div
              v-if="canTransact && !pendingTxId && (hasUsdr || canUnstake)"
              class="realfi-hero__actions"
            >
              <GButton v-if="hasUsdr" tier="primary" compact @click="openAmount('stake')">
                {{ $t('receive.tabStake') }}
              </GButton>
              <GButton v-if="canUnstake" tier="secondary" compact @click="openAmount('unstake')">
                {{ $t('staking.unstake') }}
              </GButton>
            </div>
          </section>

          <!-- Released USDrf waiting in its timelock: the user's money, one tap away. -->
          <section v-if="canTransact && claimableOrders.length" class="realfi-notice">
            <div class="realfi-notice__text">
              <p class="t-body-lg mb-1">{{ $t('realfi.claim.title') }}</p>
              <p class="t-body-sm realfi-notice__body">
                {{ $tc('realfi.claim.body', claimableOrders.length) }}
              </p>
            </div>
            <GButton tier="primary" compact @click="claim(claimableOrders[0])">
              {{ $t('dashboard.claim') }}
            </GButton>
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
            <GButton
              v-if="canTransact"
              tier="secondary"
              compact
              @click="cancelOrders(actionableOrders)"
            >
              {{ $tc('realfi.attention.cancelCta', actionableOrders.length) }}
            </GButton>
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
              <div class="realfi-card__head">
                <span class="t-label">{{ $t('realfi.referrals.label') }}</span>
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
            </section>

            <!-- Activity — only once there is some; the start card covers "none yet". -->
            <section v-if="!isEmpty" class="realfi-card">
              <div class="realfi-card__head">
                <span class="t-label">{{ $t('realfi.activity.label') }}</span>
              </div>
              <ul v-if="orders.length" class="realfi-orders">
                <li
                  v-for="order in orders"
                  :key="`${order.txHash}#${order.outputIndex}`"
                  class="realfi-order"
                >
                  <span class="realfi-order__what">
                    <span class="t-body-sm">{{ actionLabel(order.action) }}</span>
                    <!-- The id RealFi support asks for, and what a failed order's
                         notice tells the user to send them. -->
                    <span class="t-caption g-mono realfi-order__tx" :title="order.txHash">
                      {{ shortTx(order.txHash) }}
                    </span>
                  </span>
                  <span class="realfi-order__side">
                    <template v-if="canTransact">
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
                      <span v-else-if="claimableFrom(order)" class="t-caption">
                        {{ $t('realfi.claim.from', { date: claimableFrom(order) }) }}
                      </span>
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
            @close="amountMode = null"
            @confirm="onAmountConfirm"
          />
          <RealFiOrderFlow ref="flow" @placed="onPlaced" @support="openRealFiSupport()" />
        </template>
      </v-col>
    </v-row>
  </v-layout>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { formatUsd, formatInt, formatSignedChange } from '@/shared/utils/format';
import i18n from '@/plugins/i18n';
import snackbar from '@/plugins/snackbar';
import WalletStore from '@/stores/walletStore';
import { Network } from '@/models/types';
import { useRealFi } from './composables/useRealFi';
import type { RealFiBuildRequest } from './services/realfiOrders';
import {
  fromSmallestUnit,
  isCancellable,
  isClaimable,
  isUnclaimed,
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
  claimableOrders,
} = useRealFi();

const t = (key: string, values?: Record<string, unknown>) => i18n.t(key, values) as string;

/* ── Network ──────────────────────────────────────────────────────────────── */

const isTestnet = computed(() => WalletStore.state.loggedWallet?.network !== Network.MAINNET);

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

/* ── The order just sent ───────────────────────────────────────────────────── */

/**
 * The tx id of an order that is on chain but not yet in RealFi's list.
 *
 * RealFi indexes asynchronously, so a reload right after submitting still shows the
 * page as it was: the start card offering to stake the very USDrf just sent. Until
 * the order appears, the page says it was sent and offers no new orders.
 */
const pendingTxId = ref<string | null>(null);
const PENDING_POLL_MS = 5000;
/** Two minutes. Past that, stop waiting; the next manual refresh will show it. */
const PENDING_MAX_POLLS = 24;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

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

function pollForPlaced(txId: string, remaining: number): void {
  clearPendingTimer();
  if (remaining <= 0 || hasLanded(txId)) {
    if (pendingTxId.value === txId) pendingTxId.value = null;
    return;
  }
  pendingTimer = setTimeout(async () => {
    await load({ quiet: true });
    pollForPlaced(txId, remaining - 1);
  }, PENDING_POLL_MS);
}

function onPlaced(txId: string): void {
  pendingTxId.value = txId;
  void load();
  pollForPlaced(txId, PENDING_MAX_POLLS);
}

onBeforeUnmount(clearPendingTimer);

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

.realfi-hero__apy {
  margin: var(--g-s-3) 0 0;
}

.realfi-hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-2);
  margin-top: var(--g-s-4);
}

.realfi-hero__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-4);
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
