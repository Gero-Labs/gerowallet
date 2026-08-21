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
          </section>

          <!-- Anything needing the user's attention comes before anything decorative -->
          <section v-if="actionableOrders.length" class="realfi-attention">
            <div>
              <p class="t-body-lg mb-1">{{ $t('realfi.attention.title') }}</p>
              <p class="t-body-sm realfi-attention__body">
                {{ $tc('realfi.attention.body', actionableOrders.length) }}
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
              <p v-else class="t-body realfi-muted">{{ $t('realfi.referrals.none') }}</p>
            </section>

            <!-- Activity -->
            <section class="realfi-card">
              <div class="realfi-card__head">
                <span class="t-label">{{ $t('realfi.activity.label') }}</span>
              </div>
              <ul v-if="orders.length" class="realfi-orders">
                <li v-for="order in orders" :key="order.txHash" class="realfi-order">
                  <span class="t-body-sm">{{ actionLabel(order.action) }}</span>
                  <span :class="['realfi-pill', pillClass(order.status)]">
                    {{ statusLabel(order.status) }}
                  </span>
                </li>
              </ul>
              <p v-else class="t-body realfi-muted">{{ $t('realfi.activity.none') }}</p>
            </section>
          </div>

          <p class="t-caption realfi-foot">{{ $t('realfi.preview') }}</p>
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
import { useRealFi } from './composables/useRealFi';
import { fromSmallestUnit, type RealFiOrderAction, type RealFiOrderStatus } from './types';

const {
  isLoading,
  unavailableReason,
  position,
  points,
  referrals,
  orders,
  actionableOrders,
  hasPosition,
  hasPointsRecord,
  load,
} = useRealFi();

const t = (key: string) => i18n.t(key) as string;

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
  return t(`realfi.actions.${action.toLowerCase()}`);
}

function statusLabel(status: RealFiOrderStatus): string {
  return t(`realfi.statuses.${lowerFirst(status)}`);
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function pillClass(status: RealFiOrderStatus): string {
  if (status === 'Executed') return 'realfi-pill--ok';
  if (status === 'Invalidated' || status === 'InvalidMinReceived') return 'realfi-pill--warn';
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

// `protocol` (fees, limits, rate) is loaded by the composable and will be read here
// when the transactional phase lands; nothing on this read-only screen needs it yet.
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
  padding: var(--g-s-5);
  margin-bottom: var(--g-s-4);
  background: var(--g-raised);
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

.realfi-attention {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  padding: var(--g-s-3) var(--g-s-4);
  margin-bottom: var(--g-s-4);
  background: var(--g-warning-fill);
  border: 1px solid var(--g-warning-line);
  border-radius: var(--g-r-control);
}

.realfi-attention__body {
  margin: 0;
  color: var(--g-text-2);
}

.realfi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--g-s-4);
}

.realfi-card {
  padding: var(--g-s-4);
  background: var(--g-raised);
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
