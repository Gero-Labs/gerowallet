<template>
  <div class="tx-details">
    <div class="tx-details-header">
      <span class="white--text text-caption font-weight-bold text-uppercase">
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
          <span class="tx-output-addr grey--text text-caption">{{ out.truncatedAddress }}</span>
        </div>
        <div class="tx-output-right">
          <span
            class="text-caption font-weight-medium"
            :style="{ color: iconColorForKind(out.kind) }"
          >{{ out.ada }} ₳</span>
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
              <v-icon size="14" color="#94CFA8" class="mr-1" v-bind="attrs" v-on="on">
                mdi-cash-refund
              </v-icon>
            </template>
            <span>{{ t('wallet.rewardsWithdrawnTooltip') }}</span>
          </v-tooltip>
          <span class="tx-output-addr grey--text text-caption">{{ withdrawal.truncatedStakeAddress }}</span>
        </div>
        <div class="tx-output-right">
          <span class="text-caption font-weight-medium" style="color: #94CFA8;">{{ withdrawal.ada }} ₳</span>
        </div>
      </div>
    </div>

    <v-divider class="tx-details-divider" />

    <div class="tx-details-section">
      <div v-if="!totals.isInternal" class="tx-summary-row">
        <span class="grey--text text-caption">{{ t('signTx.totalSending') }}</span>
        <span class="white--text text-caption font-weight-medium">{{ totals.totalSendingAda }} ₳</span>
      </div>
      <div class="tx-summary-row">
        <span class="grey--text text-caption">{{ t('signTx.networkFee') }}</span>
        <span class="white--text text-caption font-weight-medium">{{ totals.feeAda }} ₳</span>
      </div>
      <div v-if="totals.withdrawalAda" class="tx-summary-row">
        <span class="grey--text text-caption">{{ t('wallet.rewardsWithdrawn') }}</span>
        <span class="text-caption font-weight-medium">- {{ totals.withdrawalAda }} ₳</span>
      </div>
      <v-divider
        v-if="!totals.isInternal || totals.withdrawalAda"
        class="tx-details-divider my-1"
      />
      <div class="tx-summary-row tx-summary-total">
        <span class="white--text text-caption font-weight-bold">{{ t('signTx.youPay') }}</span>
        <span class="text-caption font-weight-bold">{{ totals.youPayAda }} ₳</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
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

defineProps<{
  outputs: TxDetailsOutput[];
  totals: TxDetailsTotals;
  withdrawal?: TxDetailsWithdrawal | null;
  riskBadge?: TxDetailsRiskBadge | null;
  riskLoading?: boolean;
  /** Raw CBOR for the copy-to-clipboard button. Hidden when empty. */
  cborHex?: string;
}>();

function iconForKind(kind: TxOutputKind): string {
  if (kind === 'external') return 'mdi-arrow-top-right';
  if (kind === 'change') return 'mdi-keyboard-return';
  return 'mdi-arrow-u-left-bottom';
}

function iconColorForKind(kind: TxOutputKind): string {
  if (kind === 'external') return '#FDA29B';
  if (kind === 'change') return '#94969c';
  return '#94CFA8';
}

function tooltipKeyForKind(kind: TxOutputKind): string {
  if (kind === 'external') return 'signTx.toRecipientTooltip';
  if (kind === 'change') return 'signTx.changeTooltip';
  return 'signTx.toYouTooltip';
}
</script>

<style scoped>
.tx-details {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  overflow: hidden;
}

.tx-details-header {
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.02);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.tx-internal-banner {
  padding: 6px 12px;
  background: rgba(148, 207, 168, 0.06);
  border-bottom: 1px solid rgba(148, 207, 168, 0.15);
  text-align: center;
}

.tx-internal-banner .text-caption {
  color: #94CFA8 !important;
  font-weight: 500;
}

.tx-details-section {
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tx-details-divider {
  border-color: rgba(255, 255, 255, 0.06) !important;
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
  font-family: 'SFMono-Regular', Menlo, Consolas, monospace;
  font-size: 10px !important;
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
  font-size: 9px;
  padding: 1px 6px;
  border-radius: 8px;
  background: rgba(0, 199, 243, 0.12);
  color: #00c7f3;
  border: 1px solid rgba(0, 199, 243, 0.3);
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
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 10px;
  border: 1px solid;
  background: rgba(255, 255, 255, 0.02);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  height: 20px;
}

.tx-summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.tx-summary-total {
  margin-top: 2px;
}
</style>
