<template>
  <div class="tx-details">
    <div class="tx-details-header">
      <span class="t-label">
        {{ t('signTx.transactionDetails') }}
      </span>
      <div class="d-flex align-center">
        <v-tooltip v-if="riskBadge" top content-class="custom-tooltip" max-width="240">
          <template v-slot:activator="{ on, attrs }">
            <span
              class="risk-badge"
              :style="{ color: riskBadge.color, borderColor: riskBadge.color }"
              v-bind="attrs"
              v-on="on"
            >
              <v-icon :color="riskBadge.color" size="11" class="mr-1">{{ riskBadge.icon }}</v-icon>
              {{ t(`signTx.risk.${riskBadge.label}`) }}
            </span>
          </template>
          <span>{{ t(`signTx.risk.${riskBadge.label}Tooltip`) }}</span>
        </v-tooltip>
        <v-progress-circular
          v-else-if="riskLoading"
          indeterminate
          size="12"
          width="2"
          color="grey"
        />
        <v-divider class="ml-2 mr-1" vertical />
        <v-tooltip v-if="cborHex" top content-class="custom-tooltip">
          <template v-slot:activator="{ on, attrs }">
            <span v-bind="attrs" v-on="on" class="ml-1 d-inline-flex">
              <CopyButton x-small :value="cborHex" />
            </span>
          </template>
          <span>{{ t('signTx.copyCbor') }}</span>
        </v-tooltip>
      </div>
    </div>

    <div v-if="totals.isInternal" class="tx-internal-banner">
      <span class="white--text text-caption">{{ t('signTx.internalTransfer') }}</span>
    </div>

    <div class="tx-details-section">
      <div
        v-for="(out, i) in outputs"
        :key="'out-' + i"
        class="tx-output-row"
      >
        <div class="tx-output-left">
          <v-tooltip top content-class="custom-tooltip" max-width="260">
            <template v-slot:activator="{ on, attrs }">
              <v-icon
                size="14"
                :color="iconColorForKind(out.kind)"
                class="mr-1"
                v-bind="attrs"
                v-on="on"
              >
                {{ iconForKind(out.kind) }}
              </v-icon>
            </template>
            <span>{{ t(tooltipKeyForKind(out.kind)) }}</span>
          </v-tooltip>
          <span class="tx-output-addr g-mono">{{ out.truncatedAddress }}</span>
        </div>
        <div class="tx-output-right">
          <span
            class="text-caption font-weight-medium"
            :style="{ color: iconColorForKind(out.kind) }"
          >{{ out.ada }} {{ unit }}</span>
          <v-tooltip
            v-if="(out.assets && out.assets.length > 0) || (out.assetCount && out.assetCount > 0)"
            top
            content-class="custom-tooltip tx-asset-tooltip"
            max-width="260"
          >
            <template v-slot:activator="{ on, attrs }">
              <span class="tx-asset-pill ml-1" v-bind="attrs" v-on="on">
                {{ out.assetPillLabel || `+${out.assets?.length ?? out.assetCount}` }}
              </span>
            </template>
            <div>
              <div class="font-weight-bold mb-1">
                {{ tc('signTx.assetCountTooltip', out.assets?.length ?? out.assetCount ?? 0, { count: out.assets?.length ?? out.assetCount ?? 0 }) }}
              </div>
              <div v-if="out.assets && out.assets.length" class="tx-asset-list">
                <div
                  v-for="asset in out.assets.slice(0, ASSET_TOOLTIP_LIMIT)"
                  :key="asset.unit"
                  class="tx-asset-line"
                >
                  <span class="tx-asset-qty">{{ asset.formattedQuantity }}</span>
                  <span class="tx-asset-name grey--text">{{ asset.label }}</span>
                </div>
                <div
                  v-if="out.assets.length > ASSET_TOOLTIP_LIMIT"
                  class="text-caption grey--text mt-1"
                >
                  {{ t('signTx.andMoreTokens', { count: out.assets.length - ASSET_TOOLTIP_LIMIT }) }}
                </div>
              </div>
            </div>
          </v-tooltip>
        </div>
      </div>

      <div v-if="withdrawal" class="tx-output-row">
        <div class="tx-output-left">
          <v-tooltip top content-class="custom-tooltip" max-width="260">
            <template v-slot:activator="{ on, attrs }">
              <v-icon size="14" color="success" class="mr-1" v-bind="attrs" v-on="on">
                mdi-cash-refund
              </v-icon>
            </template>
            <span>{{ t('wallet.rewardsWithdrawnTooltip') }}</span>
          </v-tooltip>
          <span class="tx-output-addr g-mono">{{ withdrawal.truncatedStakeAddress }}</span>
        </div>
        <div class="tx-output-right">
          <span class="text-caption font-weight-medium g-num" style="color: var(--g-success);">{{ withdrawal.ada }} {{ unit }}</span>
        </div>
      </div>
    </div>

    <v-divider class="tx-details-divider" />

    <div class="tx-details-section">
      <div v-if="!totals.isInternal" class="tx-summary-row">
        <span class="tx-sum-label">{{ t('signTx.totalSending') }}</span>
        <span class="tx-sum-value g-num">{{ totals.totalSendingAda }} {{ unit }}</span>
      </div>
      <div class="tx-summary-row">
        <span class="tx-sum-label">{{ resolvedFeeLabel }}</span>
        <span class="tx-sum-value g-num">{{ totals.feeAda }} {{ resolvedFeeUnit }}</span>
      </div>
      <div v-if="totals.withdrawalAda" class="tx-summary-row">
        <span class="tx-sum-label">{{ t('wallet.rewardsWithdrawn') }}</span>
        <span class="tx-sum-value g-num" style="color: var(--g-success);">- {{ totals.withdrawalAda }} {{ unit }}</span>
      </div>
      <v-divider
        v-if="!totals.isInternal || totals.withdrawalAda"
        class="tx-details-divider my-1"
      />
      <div class="tx-summary-row tx-summary-total">
        <span class="tx-sum-total-label">{{ t('signTx.youPay') }}</span>
        <span class="tx-sum-total-value g-num">{{ totals.youPayAda }} {{ unit }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import { useTranslation } from '@/shared/composables/useTranslation';

const { t, tc } = useTranslation();

const ASSET_TOOLTIP_LIMIT = 8;

export type TxOutputKind = 'external' | 'change' | 'own';

export interface TxDetailsAsset {
  unit: string;
  label: string;
  formattedQuantity: string;
}

export interface TxDetailsOutput {
  kind: TxOutputKind;
  truncatedAddress: string;
  ada: string;
  /** Full asset list — enables the per-asset tooltip. */
  assets?: TxDetailsAsset[];
  /** Fallback when caller only has a count, not the full list. */
  assetCount?: number;
  /** Override for the pill label (defaults to `+N`). */
  assetPillLabel?: string;
}

export interface TxDetailsWithdrawal {
  truncatedStakeAddress: string;
  ada: string;
}

export interface TxDetailsTotals {
  totalSendingAda: string;
  feeAda: string;
  /** Non-empty when rewards were pulled into the tx. */
  withdrawalAda?: string;
  youPayAda: string;
  isInternal: boolean;
}

export interface TxDetailsRiskBadge {
  color: string;
  icon: string;
  /** Matches signTx.risk.* i18n keys: low | medium | high | unverified. */
  label: string;
}

const props = withDefaults(defineProps<{
  outputs: TxDetailsOutput[];
  totals: TxDetailsTotals;
  withdrawal?: TxDetailsWithdrawal | null;
  riskBadge?: TxDetailsRiskBadge | null;
  riskLoading?: boolean;
  /** Raw CBOR for the copy-to-clipboard button. Hidden when empty. */
  cborHex?: string;
  /**
   * Amount unit shown after output/sending/you-pay values. Defaults to the
   * ADA symbol so the Cardano flow is unchanged; Midnight passes NIGHT/tNIGHT.
   */
  unit?: string;
  /**
   * Unit for the network-fee row. Defaults to {@link unit}. Midnight pays fees
   * in DUST while amounts are in NIGHT, so it passes a distinct feeUnit.
   */
  feeUnit?: string;
  /**
   * Label for the network-fee row. Defaults to the Cardano `signTx.networkFee`
   * copy so every existing caller is unchanged; Midnight passes an "estimated"
   * label since the real DUST fee is only known post-auth.
   */
  feeLabel?: string;
}>(), {
  unit: '₳',
  feeUnit: undefined,
  feeLabel: undefined,
});

/** Fee unit falls back to the amount unit when the caller doesn't split them. */
const resolvedFeeUnit = computed(() => props.feeUnit ?? props.unit);

/** Fee label falls back to the Cardano copy when the caller doesn't override it. */
const resolvedFeeLabel = computed(() => props.feeLabel ?? t('signTx.networkFee'));

function iconForKind(kind: TxOutputKind): string {
  if (kind === 'external') return 'mdi-arrow-top-right';
  if (kind === 'change') return 'mdi-keyboard-return';
  return 'mdi-arrow-u-left-bottom';
}

function iconColorForKind(kind: TxOutputKind): string {
  if (kind === 'external') return 'var(--g-error)';
  if (kind === 'change') return 'var(--g-text-3)';
  return 'var(--g-success)';
}

function tooltipKeyForKind(kind: TxOutputKind): string {
  if (kind === 'external') return 'signTx.toRecipientTooltip';
  if (kind === 'change') return 'signTx.changeTooltip';
  return 'signTx.toYouTooltip';
}
</script>

<style scoped>
.tx-details {
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  overflow: hidden;
}

.tx-details-header {
  padding: 8px 12px;
  border-bottom: 1px solid var(--g-hairline-1);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.tx-internal-banner {
  padding: 6px 12px;
  background: var(--g-success-fill);
  border-bottom: 1px solid var(--g-success-line);
  text-align: center;
}

.tx-internal-banner .text-caption {
  color: var(--g-success) !important;
  font-weight: 500;
}

.tx-details-section {
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tx-details-divider {
  border-color: var(--g-hairline-1) !important;
}

.tx-output-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.tx-output-left {
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1;
}

.tx-output-addr {
  font-size: 12px !important;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tx-output-right {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.tx-asset-pill {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: var(--g-r-control);
  background: var(--g-hairline-1);
  color: var(--g-text-2);
  border: 1px solid var(--g-hairline-2);
  cursor: help;
}

.tx-asset-list {
  max-height: 180px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tx-asset-line {
  display: flex;
  gap: 6px;
  font-size: 11px;
  line-height: 1.3;
}

.tx-asset-qty {
  font-weight: 600;
  white-space: nowrap;
}

.tx-asset-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.risk-badge {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: var(--g-r-control);
  border: 1px solid;
  background: transparent;
  height: 20px;
}

.tx-summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* Net panel: label left in the muted tone, value right-aligned and tabular so
   digits line up down the column (the specimen's rule for amounts). */
.tx-sum-label { font-size: 12.5px; color: var(--g-text-3); }
.tx-sum-value { font-size: 14px; font-weight: 600; color: var(--g-text-1); text-align: right; }
.tx-sum-total-label { font-size: 13px; font-weight: 600; color: var(--g-text-1); }
.tx-sum-total-value { font-size: 15px; font-weight: 700; color: var(--g-text-1); text-align: right; }

.tx-summary-total {
  margin-top: 2px;
}
</style>
