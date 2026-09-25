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
          <section v-if="isEmpty" class="realfi-start">
            <span class="realfi-glyph realfi-glyph--lg" aria-hidden="true"></span>
            <!-- Holding USDrf but nothing staked is a DIFFERENT state from holding
                 nothing: telling someone with 9,994 USDrf to "get USDrf" is noise. -->
            <template v-if="hasUsdr">
              <h2 class="t-heading realfi-start__title">{{ $t('realfi.start.readyTitle') }}</h2>
              <p class="t-body realfi-start__body">
                {{ $t('realfi.start.readyBody', { amount: usdrLabel }) }}
              </p>
              <GButton tier="primary" class="mt-4" @click="openRealFiApp()">
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
            <p class="t-caption realfi-start__note">{{ $t('realfi.start.note') }}</p>
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
          </section>

          <!-- Anything needing the user's attention comes before anything decorative -->
          <section v-if="actionableOrders.length" class="realfi-notice realfi-notice--warn">
            <div class="realfi-notice__text">
              <p class="t-body-lg mb-1">{{ $t('realfi.attention.title') }}</p>
              <p class="t-body-sm realfi-notice__body">
                {{ $tc('realfi.attention.body', actionableOrders.length) }}
              </p>
            </div>
            <!-- Cancelling needs a transaction, which Gero cannot build yet — so the
                 banner hands off to RealFi rather than asking for something the page
                 cannot do. -->
            <GButton tier="secondary" compact @click="openRealFiApp()">
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
              <template v-if="referrals.code">
                <div class="realfi-row">
                  <span class="t-caption">{{ $t('realfi.referrals.code') }}</span>
                  <span class="g-mono realfi-strong">{{ referrals.code }}</span>
                </div>
                <div class="realfi-row">
                  <span class="t-caption">{{ $t('realfi.referrals.invited') }}</span>
                  <span class="t-body-sm realfi-strong g-num">{{ invitedLabel }}</span>
                </div>
                <div class="realfi-row">
                  <span class="t-caption">{{ $t('realfi.referrals.earned') }}</span>
                  <span class="t-body-sm realfi-strong g-num">{{ referralPointsLabel }}</span>
                </div>
              </template>
              <template v-else>
                <p class="t-body realfi-muted">{{ $t('realfi.referrals.none') }}</p>
                <!-- Reading a code on RealFi CREATES one and joins their referral
                     programme, so it only ever happens on this tap. -->
                <GButton
                  tier="secondary"
                  compact
                  class="mt-3"
                  :loading="isRequestingCode"
                  @click="requestReferralCode()"
                >
                  {{ $t('realfi.referrals.get') }}
                </GButton>
              </template>
            </section>

            <!-- Activity -->
            <section class="realfi-card">
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
                  <span :class="['realfi-pill', pillClass(order.status)]">
                    {{ statusLabel(order.status) }}
                  </span>
                </li>
              </ul>
              <p v-else class="t-body realfi-muted">{{ $t('realfi.activity.none') }}</p>
            </section>
          </div>

          </template>

          <p v-if="isTestnet" class="t-caption realfi-foot">{{ $t('realfi.preview') }}</p>
        </template>
      </v-col>
    </v-row>
  </v-layout>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { formatUsd, formatInt, formatSignedChange } from '@/shared/utils/format';
import i18n from '@/plugins/i18n';
import WalletStore from '@/stores/walletStore';
import { Network } from '@/models/types';
import { useRealFi } from './composables/useRealFi';
import {
  fromSmallestUnit,
  ORDER_STATUSES_FAILED,
  ORDER_STATUSES_NEEDING_ACTION,
  type RealFiOrderAction,
  type RealFiOrderStatus,
} from './types';

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
} = useRealFi();

const t = (key: string, values?: Record<string, unknown>) => i18n.t(key, values) as string;

/* ── Network ──────────────────────────────────────────────────────────────── */

const isTestnet = computed(() => WalletStore.state.loggedWallet?.network !== Network.MAINNET);

/**
 * RealFi's own app for the wallet's network. Constants, never built from remote data,
 * so window.open has no injection surface. Transacting happens there until staking
 * from Gero lands.
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
