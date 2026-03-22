<template>
  <div class="perps-page">
    <!-- Header with back button and price ticker -->
    <div class="perps-header pa-4">
      <div class="d-flex align-center justify-space-between">
        <div class="d-flex align-center">
          <v-btn icon small class="mr-2" @click="$router.push('/')">
            <v-icon color="white">mdi-arrow-left</v-icon>
          </v-btn>
          <div>
            <div class="text-h6 white--text">{{ $t('miniGero.perpsTitle') }}</div>
            <div class="text-caption grey--text">{{ $t('perpetuals.poweredBy') }} Strike Finance</div>
          </div>
        </div>
        <div v-if="currentPrice" class="price-ticker">
          <div class="text-caption grey--text">ADA/USD</div>
          <div class="price-value">${{ Number(currentPrice).toFixed(4) }}</div>
          <div
            v-if="priceChange !== null"
            class="text-caption"
            :class="priceChange >= 0 ? 'green-text' : 'red-text'"
          >
            {{ priceChange >= 0 ? '+' : '' }}{{ priceChange.toFixed(2) }}%
          </div>
        </div>
      </div>
    </div>

    <!-- Not supported -->
    <div v-if="!perpetualsSupported" class="empty-state">
      <v-icon size="48" color="rgba(255,255,255,0.1)">mdi-chart-line</v-icon>
      <div class="text-body-2 grey--text mt-3 text-center">
        {{ $t('miniGero.perpsNotSupported') }}
      </div>
    </div>

    <template v-else>
      <!-- Segment toggle -->
      <div class="segment-toggle mx-4 mb-3">
        <button
          v-for="seg in segments"
          :key="seg.id"
          class="segment-btn"
          :class="{ 'segment-btn--active': activeSegment === seg.id }"
          @click="activeSegment = seg.id"
        >
          {{ seg.label }}
          <span v-if="seg.count > 0" class="segment-count">{{ seg.count }}</span>
        </button>
      </div>

      <!-- Positions -->
      <div v-if="activeSegment === 'positions'" class="segment-content px-4">
        <div v-if="loadingPositions" class="text-center py-6">
          <v-progress-circular indeterminate color="#26FAB0" size="32" width="3" />
          <div class="grey--text text-caption mt-2">{{ $t('perpetuals.loadingPositions') }}</div>
        </div>
        <div v-else-if="positions.length === 0" class="empty-state-small">
          <v-icon size="36" color="rgba(255,255,255,0.08)">mdi-chart-line</v-icon>
          <div class="text-body-2 grey--text mt-2">{{ $t('perpetuals.noOpenPositions') }}</div>
          <div class="text-caption grey--text mt-1">{{ $t('perpetuals.yourPerpetualPositions') }}</div>
        </div>
        <div v-else class="position-cards">
          <div v-for="pos in positions" :key="posKey(pos)" class="position-card">
            <div class="position-card-header">
              <div class="d-flex align-center" style="gap: 6px">
                <span class="position-ticker">ADA/USD</span>
                <span class="position-leverage">{{ pos.leverage }}x</span>
                <span
                  class="position-type-badge"
                  :class="pos.position === 'Long' ? 'badge-long' : 'badge-short'"
                >{{ pos.position.toUpperCase() }}</span>
              </div>
              <v-btn
                icon
                x-small
                color="error"
                @click="handleClosePosition(pos)"
                :loading="closingPositions[posKey(pos)]"
                :disabled="closingPositions[posKey(pos)]"
              >
                <v-icon small>mdi-close</v-icon>
              </v-btn>
            </div>
            <div class="position-card-body">
              <div class="position-stat">
                <span class="stat-label">{{ $t('perpetuals.entryPrice') }}</span>
                <span class="stat-value">${{ pos.entryPrice?.toFixed(4) || '0.0000' }}</span>
              </div>
              <div class="position-stat">
                <span class="stat-label">{{ $t('perpetuals.collateral') }}</span>
                <span class="stat-value">${{ pos.collateralAmount?.toFixed(2) || '0.00' }}</span>
              </div>
              <div class="position-stat">
                <span class="stat-label">{{ $t('perpetuals.pnlLabel') }}</span>
                <span
                  class="stat-value"
                  :class="(pos.pnl || 0) >= 0 ? 'green-text' : 'red-text'"
                >{{ formatPnl(pos.pnl) }}</span>
              </div>
              <div class="position-stat">
                <span class="stat-label">{{ $t('perpetuals.liquidationPrice') }}</span>
                <span class="stat-value">${{ pos.liquidationPrice?.toFixed(4) || '--' }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Limit Orders -->
      <div v-if="activeSegment === 'orders'" class="segment-content px-4">
        <div v-if="loadingOrders" class="text-center py-6">
          <v-progress-circular indeterminate color="#26FAB0" size="32" width="3" />
          <div class="grey--text text-caption mt-2">{{ $t('perpetuals.loadingLimitOrders') }}</div>
        </div>
        <div v-else-if="limitOrders.length === 0" class="empty-state-small">
          <v-icon size="36" color="rgba(255,255,255,0.08)">mdi-target</v-icon>
          <div class="text-body-2 grey--text mt-2">{{ $t('perpetuals.noLimitOrders') }}</div>
          <div class="text-caption grey--text mt-1">{{ $t('perpetuals.yourPendingLimitOrders') }}</div>
        </div>
        <div v-else class="position-cards">
          <div v-for="order in limitOrders" :key="posKey(order)" class="position-card">
            <div class="position-card-header">
              <div class="d-flex align-center" style="gap: 6px">
                <span class="position-ticker">ADA/USD</span>
                <span class="position-leverage">{{ order.leverage }}x</span>
                <span
                  class="position-type-badge"
                  :class="order.position === 'Long' ? 'badge-long' : 'badge-short'"
                >{{ (order.position || '').toUpperCase() }}</span>
              </div>
              <v-btn
                icon
                x-small
                color="error"
                @click="handleCancelOrder(order)"
                :loading="cancellingOrders[posKey(order)]"
                :disabled="cancellingOrders[posKey(order)]"
              >
                <v-icon small>mdi-close</v-icon>
              </v-btn>
            </div>
            <div class="position-card-body">
              <div class="position-stat">
                <span class="stat-label">{{ $t('perpetuals.limitPrice') }}</span>
                <span class="stat-value">${{ order.limitUSDPrice?.toFixed(4) || '--' }}</span>
              </div>
              <div class="position-stat">
                <span class="stat-label">{{ $t('perpetuals.collateral') }}</span>
                <span class="stat-value">${{ order.collateralAmount?.toFixed(2) || '0.00' }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- History -->
      <div v-if="activeSegment === 'history'" class="segment-content px-4">
        <div v-if="loadingHistory" class="text-center py-6">
          <v-progress-circular indeterminate color="#26FAB0" size="32" width="3" />
          <div class="grey--text text-caption mt-2">{{ $t('perpetuals.loadingHistory') }}</div>
        </div>
        <div v-else-if="history.length === 0" class="empty-state-small">
          <v-icon size="36" color="rgba(255,255,255,0.08)">mdi-format-list-bulleted</v-icon>
          <div class="text-body-2 grey--text mt-2">{{ $t('perpetuals.noHistory') }}</div>
        </div>
        <div v-else class="position-cards">
          <div v-for="(tx, i) in history" :key="tx.txHash || i" class="position-card">
            <div class="position-card-header">
              <div class="d-flex align-center" style="gap: 6px">
                <span class="position-ticker">{{ tx.pair || 'ADA/USD' }}</span>
                <span
                  class="position-type-badge"
                  :class="(tx.positionType || tx.type || '').toLowerCase() === 'long' ? 'badge-long' : 'badge-short'"
                >{{ (tx.action || '').toUpperCase() }}</span>
              </div>
              <span class="text-caption grey--text">{{ formatDate(tx.time) }}</span>
            </div>
            <div class="position-card-body">
              <div class="position-stat">
                <span class="stat-label">{{ $t('perpetuals.entryPrice') }}</span>
                <span class="stat-value">${{ (tx.enteredPrice || tx.entryPrice || 0).toFixed(4) }}</span>
              </div>
              <div class="position-stat">
                <span class="stat-label">{{ $t('perpetuals.pnlLabel') }}</span>
                <span
                  class="stat-value"
                  :class="(tx.pnl || 0) >= 0 ? 'green-text' : 'red-text'"
                >{{ formatPnl(tx.pnl) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Open Position FAB -->
      <v-btn
        fab
        small
        class="open-position-fab"
        @click="showNewPosition = true"
      >
        <v-icon>mdi-plus</v-icon>
      </v-btn>

      <!-- New Position Bottom Sheet -->
      <BottomSheet
        v-model="showNewPosition"
        :title="$t('perpetuals.openNewPosition')"
        height="75%"
      >
        <div class="new-position-form">
          <!-- Direction -->
          <div class="form-section mb-3">
            <div class="form-label mb-1">{{ $t('perpetuals.positionDirection') }}</div>
            <div class="direction-toggle">
              <button
                class="dir-btn"
                :class="{ 'dir-btn--long-active': newPos.direction === 'LONG' }"
                @click="newPos.direction = 'LONG'"
              >
                <v-icon x-small class="mr-1">mdi-trending-up</v-icon>
                {{ $t('perpetuals.long') }}
              </button>
              <button
                class="dir-btn"
                :class="{ 'dir-btn--short-active': newPos.direction === 'SHORT' }"
                @click="newPos.direction = 'SHORT'"
              >
                <v-icon x-small class="mr-1">mdi-trending-down</v-icon>
                {{ $t('perpetuals.short') }}
              </button>
            </div>
          </div>

          <!-- Order Type -->
          <div class="form-section mb-3">
            <div class="form-label mb-1">{{ $t('perpetuals.orderType') }}</div>
            <div class="direction-toggle">
              <button
                class="dir-btn"
                :class="{ [newPos.direction === 'SHORT' ? 'dir-btn--short-active' : 'dir-btn--long-active']: newPos.orderType === 'MARKET' }"
                @click="newPos.orderType = 'MARKET'"
              >
                <v-icon x-small class="mr-1">mdi-flash</v-icon>
                MARKET
              </button>
              <button
                class="dir-btn"
                :class="{ [newPos.direction === 'SHORT' ? 'dir-btn--short-active' : 'dir-btn--long-active']: newPos.orderType === 'LIMIT' }"
                @click="newPos.orderType = 'LIMIT'"
              >
                <v-icon x-small class="mr-1">mdi-target</v-icon>
                LIMIT
              </button>
            </div>
          </div>

          <!-- Limit Price (only for LIMIT) -->
          <div v-if="newPos.orderType === 'LIMIT'" class="form-section mb-3">
            <div class="form-label mb-1">{{ $t('perpetuals.limitPrice') }}</div>
            <div class="form-input-row">
              <v-text-field
                v-model.number="newPos.limitPrice"
                placeholder="0.0000"
                dense outlined hide-details dark
                type="number" step="0.0001"
                class="form-input"
                suffix="USD"
              />
            </div>
          </div>

          <!-- Collateral -->
          <div class="form-section mb-3">
            <div class="d-flex align-center justify-space-between mb-1">
              <div class="form-label">{{ $t('perpetuals.collateral') }}</div>
              <span class="text-caption grey--text">{{ $t('perpetuals.available') }}: {{ availableAda }} ADA</span>
            </div>
            <div class="form-input-row">
              <v-text-field
                v-model.number="newPos.collateral"
                placeholder="0.00"
                dense outlined hide-details dark
                type="number" step="1"
                class="form-input"
                suffix="ADA"
              />
            </div>
            <div v-if="collateralBelowMin" class="text-caption mt-1" style="color: #F97066;">
              {{ $t('perpetuals.minCollateral', { ada: minCollateralAda }) }}
            </div>
          </div>

          <!-- Leverage -->
          <div class="form-section mb-3">
            <div class="d-flex align-center justify-space-between mb-1">
              <div class="form-label">{{ $t('perpetuals.leverage') }}</div>
              <span
                class="leverage-display"
                :class="newPos.direction === 'SHORT' ? 'red-text' : 'green-text'"
              >{{ newPos.leverage.toFixed(1) }}x</span>
            </div>
            <v-slider
              v-model="newPos.leverage"
              :min="1.1" :max="15" :step="0.1"
              hide-details thumb-label
              :color="newPos.direction === 'SHORT' ? '#ef4444' : '#26FAB0'"
              :track-color="newPos.direction === 'SHORT' ? 'rgba(239,68,68,0.2)' : 'rgba(38,250,176,0.2)'"
              :thumb-color="newPos.direction === 'SHORT' ? '#ef4444' : '#26FAB0'"
              class="leverage-slider"
            />
          </div>

          <!-- Position Summary -->
          <div class="position-summary mb-3">
            <div class="summary-row">
              <span class="text-caption grey--text">{{ $t('perpetuals.positionSize') }}</span>
              <span class="text-caption white--text">{{ positionSize }} ADA</span>
            </div>
            <div v-if="currentPrice" class="summary-row">
              <span class="text-caption grey--text">{{ $t('perpetuals.estEntryPrice') }}</span>
              <span class="text-caption white--text">
                {{ newPos.orderType === 'LIMIT' && newPos.limitPrice > 0 ? '$' + newPos.limitPrice.toFixed(4) : '$' + Number(currentPrice).toFixed(4) }}
              </span>
            </div>
            <div class="summary-row">
              <span class="text-caption grey--text">{{ $t('perpetuals.estLiqPrice') }}</span>
              <span class="text-caption white--text">{{ liquidationPrice }}</span>
            </div>
          </div>

          <!-- Authentication -->
          <div v-if="positionError" class="text-caption red-text mb-2">{{ positionError }}</div>

          <!-- Normal wallet (password) -->
          <template v-if="isNormalWallet && !isPrfWallet">
            <div class="form-section mb-3">
              <div class="text-caption grey--text mb-1">{{ $t('miniGero.spendingPassword') }}</div>
              <v-text-field
                v-model="spendingPassword"
                :placeholder="$t('miniGero.spendingPassword')"
                dense outlined hide-details dark
                type="password"
                class="form-input"
              />
            </div>
            <v-btn
              block
              :loading="openingPosition"
              :disabled="!canOpen"
              class="open-btn"
              :class="newPos.direction === 'SHORT' ? 'open-btn--short' : 'open-btn--long'"
              @click="handleOpenPosition"
            >
              <v-icon left small>{{ newPos.orderType === 'MARKET' ? 'mdi-flash' : 'mdi-target' }}</v-icon>
              {{ newPos.orderType === 'MARKET' ? $t('perpetuals.openMarketPosition') : $t('perpetuals.openLimitOrder') }}
            </v-btn>
          </template>

          <!-- PRF wallet (PassKey) -->
          <template v-else-if="isPrfWallet">
            <div class="text-center mb-3">
              <v-icon size="40" color="#00c7f3" class="mb-2">mdi-fingerprint</v-icon>
              <div class="text-body-2 white--text text-center">{{ $t('miniGero.prfAuthPrompt') }}</div>
            </div>
            <PassKeyAuthButton
              :disabled="openingPosition || !canOpenPrf"
              @success="onPassKeySuccess"
              @error="onPassKeyError"
              style="width: 100%"
              class="mb-2"
            />
          </template>

          <!-- Ledger -->
          <template v-else-if="walletType === WalletType.Ledger">
            <div class="hw-notice">
              <v-icon size="40" color="#00c7f3" class="mb-2">mdi-usb</v-icon>
              <div class="text-body-2 white--text text-center mb-2">{{ $t('miniGero.connectLedger') }}</div>
              <div v-if="loggedWallet?.btSupported" class="d-flex align-center justify-center mb-2" style="gap: 8px;">
                <v-btn x-small :outlined="isBT" :color="!isBT ? '#00c7f3' : '#555'" class="black--text" @click="isBT = false">
                  <v-icon x-small class="mr-1">mdi-usb</v-icon> USB
                </v-btn>
                <v-btn x-small :outlined="!isBT" :color="isBT ? '#00c7f3' : '#555'" class="black--text" @click="isBT = true">
                  <v-icon x-small class="mr-1">mdi-bluetooth</v-icon> BT
                </v-btn>
              </div>
            </div>
            <v-btn
              block color="#00c7f3" class="black--text font-weight-bold"
              :disabled="openingPosition || !canOpenBase" :loading="openingPosition"
              @click="signLedger"
            >
              <v-icon left small>mdi-draw</v-icon>
              {{ $t('wallet.sign') }}
            </v-btn>
          </template>

          <!-- Trezor -->
          <template v-else-if="walletType === WalletType.Trezor">
            <div class="hw-notice">
              <v-icon size="40" color="#00c7f3" class="mb-2">mdi-shield-check-outline</v-icon>
              <div class="text-body-2 white--text text-center mb-2">{{ $t('miniGero.connectTrezor') }}</div>
            </div>
            <v-btn
              block color="#00c7f3" class="black--text font-weight-bold"
              :disabled="openingPosition || !canOpenBase" :loading="openingPosition"
              @click="signTrezor"
            >
              <v-icon left small>mdi-draw</v-icon>
              {{ $t('wallet.sign') }}
            </v-btn>
          </template>

          <!-- Keystone -->
          <template v-else-if="walletType === WalletType.Keystone">
            <div class="hw-notice">
              <v-icon size="40" color="#00c7f3" class="mb-2">mdi-qrcode</v-icon>
              <div class="text-body-2 white--text text-center mb-2">{{ $t('miniGero.keystoneSign') }}</div>
            </div>
            <v-btn
              block color="#00c7f3" class="black--text font-weight-bold"
              :disabled="openingPosition || !canOpenBase" :loading="openingPosition"
              @click="signKeystone"
            >
              <v-icon left small>mdi-qrcode-scan</v-icon>
              {{ $t('wallet.sign') }}
            </v-btn>
          </template>
        </div>
      </BottomSheet>

      <!-- Confirm Action (close/cancel) BottomSheet -->
      <BottomSheet
        :value="showConfirmAction"
        @input="showConfirmAction = $event"
        :title="confirmActionTitle"
        height="auto"
      >
        <div class="pa-4" style="padding-bottom: 72px !important;">
          <!-- Action summary -->
          <div v-if="confirmActionItem" class="position-summary mb-3">
            <div class="summary-row">
              <span class="text-caption grey--text">{{ confirmActionType === 'close' ? $t('perpetuals.position') : $t('perpetuals.limitOrder') }}</span>
              <span class="text-caption white--text">
                ADA/USD {{ confirmActionItem.leverage }}x {{ (confirmActionItem.position || '').toUpperCase() }}
              </span>
            </div>
            <div v-if="confirmActionType === 'close' && confirmActionItem.pnl !== undefined" class="summary-row">
              <span class="text-caption grey--text">{{ $t('perpetuals.pnlLabel') }}</span>
              <span class="text-caption" :class="confirmActionItem.pnl >= 0 ? 'green-text' : 'red-text'">
                {{ formatPnl(confirmActionItem.pnl) }}
              </span>
            </div>
          </div>

          <div v-if="confirmActionError" class="text-caption red-text mb-2">{{ confirmActionError }}</div>

          <!-- Normal wallet -->
          <template v-if="isNormalWallet && !isPrfWallet">
            <div class="form-section mb-3">
              <div class="text-caption grey--text mb-1">{{ $t('miniGero.spendingPassword') }}</div>
              <v-text-field
                v-model="confirmPassword"
                :placeholder="$t('miniGero.spendingPassword')"
                dense outlined hide-details dark
                type="password"
                class="form-input"
              />
            </div>
            <v-btn
              block color="#F97066" class="white--text font-weight-bold"
              :loading="confirmActionLoading"
              :disabled="!confirmPassword || confirmActionLoading"
              @click="executeConfirmAction"
            >
              {{ confirmActionType === 'close' ? $t('perpetuals.closePosition') : $t('perpetuals.cancelOrder') }}
            </v-btn>
          </template>

          <!-- PRF wallet -->
          <template v-else-if="isPrfWallet">
            <div class="hw-notice">
              <v-icon size="40" color="#00c7f3" class="mb-2">mdi-fingerprint</v-icon>
              <div class="text-body-2 white--text text-center">{{ $t('miniGero.prfAuthPrompt') }}</div>
            </div>
            <PassKeyAuthButton
              :disabled="confirmActionLoading"
              @success="onConfirmPassKeySuccess"
              @error="onConfirmPassKeyError"
              style="width: 100%"
              class="mb-2"
            />
          </template>

          <!-- Ledger -->
          <template v-else-if="walletType === WalletType.Ledger">
            <div class="hw-notice">
              <v-icon size="40" color="#00c7f3" class="mb-2">mdi-usb</v-icon>
              <div class="text-body-2 white--text text-center mb-2">{{ $t('miniGero.connectLedger') }}</div>
              <div v-if="loggedWallet?.btSupported" class="d-flex align-center justify-center mb-2" style="gap: 8px;">
                <v-btn x-small :outlined="isBT" :color="!isBT ? '#00c7f3' : '#555'" class="black--text" @click="isBT = false">
                  <v-icon x-small class="mr-1">mdi-usb</v-icon> USB
                </v-btn>
                <v-btn x-small :outlined="!isBT" :color="isBT ? '#00c7f3' : '#555'" class="black--text" @click="isBT = true">
                  <v-icon x-small class="mr-1">mdi-bluetooth</v-icon> BT
                </v-btn>
              </div>
            </div>
            <v-btn
              block color="#F97066" class="white--text font-weight-bold"
              :loading="confirmActionLoading" :disabled="confirmActionLoading"
              @click="executeConfirmAction"
            >
              <v-icon left small>mdi-draw</v-icon>
              {{ confirmActionType === 'close' ? $t('perpetuals.closePosition') : $t('perpetuals.cancelOrder') }}
            </v-btn>
          </template>

          <!-- Trezor -->
          <template v-else-if="walletType === WalletType.Trezor">
            <div class="hw-notice">
              <v-icon size="40" color="#00c7f3" class="mb-2">mdi-shield-check-outline</v-icon>
              <div class="text-body-2 white--text text-center mb-2">{{ $t('miniGero.connectTrezor') }}</div>
            </div>
            <v-btn
              block color="#F97066" class="white--text font-weight-bold"
              :loading="confirmActionLoading" :disabled="confirmActionLoading"
              @click="executeConfirmAction"
            >
              <v-icon left small>mdi-draw</v-icon>
              {{ confirmActionType === 'close' ? $t('perpetuals.closePosition') : $t('perpetuals.cancelOrder') }}
            </v-btn>
          </template>

          <!-- Keystone -->
          <template v-else-if="walletType === WalletType.Keystone">
            <div class="hw-notice">
              <v-icon size="40" color="#00c7f3" class="mb-2">mdi-qrcode</v-icon>
              <div class="text-body-2 white--text text-center mb-2">{{ $t('miniGero.keystoneSign') }}</div>
            </div>
            <v-btn
              block color="#F97066" class="white--text font-weight-bold"
              :loading="confirmActionLoading" :disabled="confirmActionLoading"
              @click="executeConfirmAction"
            >
              <v-icon left small>mdi-qrcode-scan</v-icon>
              {{ confirmActionType === 'close' ? $t('perpetuals.closePosition') : $t('perpetuals.cancelOrder') }}
            </v-btn>
          </template>
        </div>
      </BottomSheet>

      <!-- Keystone QR dialog -->
      <KeystoneSignDialog
        :isOpen="showKeystoneDialog"
        :keystoneType="keystoneType"
        :keystoneCbor="keystoneCbor"
        @scan="onKeystoneScan"
        @error="onKeystoneError"
        @close="showKeystoneDialog = false"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, toRefs, onMounted, onBeforeUnmount } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { priceStore } from '@/stores/priceStore';
import { networkStore } from '@/stores/networkStore';
import strikeFinanceApi, {
  type PerpetualPosition,
  type LimitOrder,
  type PerpetualTransaction,
  type ClosePerpetualRequest,
  type CancelLimitOrderRequest,
  type CreatePerpetualRequest,
  type CreateLimitOrderRequest,
  type Asset,
} from '@/api/strike-finance.api';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { WalletType } from '@/models/types';
import { Cardano, Serialization } from '@cardano-sdk/core';
import networks from '@/utils/networks';
import filters from '@/shared/utils/filters';
import BottomSheet from '../components/BottomSheet.vue';
import PassKeyAuthButton from '@/shared/components/PassKeyAuthButton.vue';
import KeystoneSignDialog from '@/shared/dialogs/KeystoneSignDialog.vue';
import ledgerUtils from '@/shared/utils/ledger';
import { createKeystoneSignRequest, type KeystoneSignRequestResponse, parseSignature } from '@/shared/utils/keystone';
import type { UR } from '@keystonehq/keystone-sdk';

const { loggedWallet, tokens, utxos, keys } = toRefs(walletStore);

const walletType = computed(() => loggedWallet.value?.type || WalletType.Normal);
const isNormalWallet = computed(() => walletType.value === WalletType.Normal);
const isPrfWallet = computed(() =>
  loggedWallet.value?.encryptionMethod === 'prf' ||
  (!!loggedWallet.value?.prfEncryptedPrivateKey && !!loggedWallet.value?.webAuthnCredentialId)
);
const isBT = ref(false);
const keystoneType = ref('');
const keystoneCbor = ref('');
const showKeystoneDialog = ref(false);

const perpetualsSupported = computed(() => {
  if (!loggedWallet.value) return false;
  return networks.resolvePerpetualsSupport(loggedWallet.value.chain, loggedWallet.value.network);
});

const currentPrice = computed(() => {
  if (priceStore.adaUsd?.lastPrice) return priceStore.adaUsd.lastPrice;
  return networkStore.price?.lastPrice || null;
});

const priceChange = computed(() => {
  if (priceStore.adaUsd?.priceChangePercentage !== undefined) return priceStore.adaUsd.priceChangePercentage;
  return networkStore.price?.priceChangePercentage ?? null;
});

// Segments
const activeSegment = ref<'positions' | 'orders' | 'history'>('positions');
const loadingPositions = ref(false);
const loadingOrders = ref(false);
const loadingHistory = ref(false);
const positions = ref<PerpetualPosition[]>([]);
const limitOrders = ref<LimitOrder[]>([]);
const history = ref<PerpetualTransaction[]>([]);
const closingPositions = ref<Record<string, boolean>>({});
const cancellingOrders = ref<Record<string, boolean>>({});

const segments = computed(() => [
  { id: 'positions' as const, label: 'Positions', count: positions.value.length },
  { id: 'orders' as const, label: 'Orders', count: limitOrders.value.length },
  { id: 'history' as const, label: 'History', count: history.value.length },
]);

// New position form
const showNewPosition = ref(false);
const openingPosition = ref(false);
const spendingPassword = ref('');
const positionError = ref('');

// Confirm action sheet (close position / cancel order)
const showConfirmAction = ref(false);
const confirmActionType = ref<'close' | 'cancel'>('close');
const confirmActionItem = ref<any>(null);
const confirmActionLoading = ref(false);
const confirmActionError = ref('');
const confirmPassword = ref('');
const confirmActionTitle = computed(() =>
  confirmActionType.value === 'close' ? 'Close Position' : 'Cancel Order'
);

const newPos = reactive({
  direction: 'LONG' as 'LONG' | 'SHORT',
  orderType: 'MARKET' as 'MARKET' | 'LIMIT',
  collateral: 0,
  leverage: 2,
  limitPrice: 0,
});

const availableAda = computed(() => {
  const adaToken = Object.values(tokens.value || {}).find((t: any) => t.policy_id === '') as any;
  if (adaToken?.quantity) return filters.convertFromSmallestUnit(adaToken.quantity, 6).toFixed(2);
  return '0.00';
});

const positionSize = computed(() => {
  if (!newPos.collateral || !newPos.leverage) return '0.00';
  return (newPos.collateral * newPos.leverage).toFixed(2);
});

const liquidationPrice = computed(() => {
  const price = newPos.orderType === 'LIMIT' && newPos.limitPrice > 0
    ? newPos.limitPrice
    : Number(currentPrice.value);
  if (!price || !newPos.leverage) return '--';
  const liqPrice = strikeFinanceApi.calculateLiquidationPrice(
    price, newPos.leverage, newPos.direction.toLowerCase() as 'long' | 'short'
  );
  return '$' + liqPrice.toFixed(4);
});

const positionValueUsd = computed(() => {
  const price = Number(currentPrice.value || 0);
  return newPos.collateral * newPos.leverage * price;
});

const minCollateralAda = computed(() => {
  const price = Number(currentPrice.value || 0);
  const leverage = newPos.leverage || 1;
  return price > 0 ? (20 / (price * leverage)).toFixed(2) : '0.00';
});

const collateralBelowMin = computed(() =>
  newPos.collateral > 0 && positionValueUsd.value < 20
);

const canOpenBase = computed(() => {
  if (!newPos.collateral || newPos.collateral <= 0) return false;
  if (positionValueUsd.value < 20) return false;
  if (newPos.leverage <= 1) return false;
  if (newPos.orderType === 'LIMIT' && (!newPos.limitPrice || newPos.limitPrice <= 0)) return false;
  if (openingPosition.value) return false;
  return true;
});

const canOpen = computed(() => {
  if (!canOpenBase.value) return false;
  if (!spendingPassword.value) return false;
  return true;
});

const canOpenPrf = computed(() => canOpenBase.value);

function posKey(item: any): string {
  return `${item.outRef?.txHash || ''}#${item.outRef?.outputIndex || 0}`;
}

function formatPnl(pnl: number | undefined): string {
  if (pnl === undefined || pnl === null) return '$0.00';
  const abs = Math.abs(pnl).toFixed(2);
  return pnl < 0 ? `-$${abs}` : `$${abs}`;
}

function formatDate(timestamp: number): string {
  if (!timestamp) return '--';
  const d = new Date(timestamp);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Data loading ──

async function loadPositions(showLoading = true) {
  const address = loggedWallet.value?.baseAddress;
  if (!address) return;
  if (showLoading) loadingPositions.value = true;
  try {
    const res = await strikeFinanceApi.getPositions(address);
    positions.value = res.data || [];
  } catch (e) {
    console.warn('[Perps] Failed to load positions:', e);
  } finally {
    loadingPositions.value = false;
  }
}

async function loadLimitOrders(showLoading = true) {
  const address = loggedWallet.value?.baseAddress;
  if (!address) return;
  if (showLoading) loadingOrders.value = true;
  try {
    const res = await strikeFinanceApi.getLimitOrders(address);
    limitOrders.value = res.data || [];
  } catch (e) {
    console.warn('[Perps] Failed to load limit orders:', e);
  } finally {
    loadingOrders.value = false;
  }
}

async function loadHistory() {
  const address = loggedWallet.value?.baseAddress;
  if (!address) return;
  loadingHistory.value = true;
  try {
    const res = await strikeFinanceApi.getPerpetualHistory(address);
    history.value = res.data?.transactions || [];
  } catch (e) {
    console.warn('[Perps] Failed to load history:', e);
  } finally {
    loadingHistory.value = false;
  }
}

// ── Transaction signing (wallet-type-aware) ──

async function getWitnesses(txCbor: string, opts?: { password?: string | null; privateKeyBytes?: number[] }): Promise<string> {
  const type = walletType.value;

  if (type === WalletType.Ledger) {
    const txSerialized = Serialization.Transaction.fromCbor(txCbor as any);
    const txCore = txSerialized.toCore();
    const signatures: Cardano.Signatures = await ledgerUtils.txToLedger(
      txCore, keys.value, utxos.value,
      !isBT.value,
      networks.resolveNetwork(loggedWallet.value.chain, loggedWallet.value.network),
    );
    const ws = Serialization.TransactionWitnessSet.fromCore({ signatures });
    return ws.toCbor() as string;
  }

  if (type === WalletType.Trezor) {
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.TREZOR,
      data: { method: 'signTx', txCbor },
    }) as { data: { success?: boolean; error?: string; signatures?: Array<[string, string]> } };
    if (!response.data.success) throw new Error(response.data.error || 'Trezor signing failed');
    const signatures: Cardano.Signatures = new Map(response.data.signatures as Array<[string, string]>);
    const ws = Serialization.TransactionWitnessSet.fromCore({ signatures });
    return ws.toCbor() as string;
  }

  if (type === WalletType.Keystone) {
    // Keystone is async (QR scan) — handled separately
    throw new Error('KEYSTONE_QR_REQUIRED');
  }

  // Normal / PRF wallet — sign via background
  const signResult = await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.SIGN_TX,
    data: {
      txCbor,
      partialSign: true,
      password: opts?.password ?? null,
      privateKeyBytes: opts?.privateKeyBytes,
      accountIndex: 0,
      utxos: utxos.value,
      addresses: keys.value,
      mergeWitnesses: false,
    },
  }) as { data: { witnesses?: string; error?: string } };
  if (signResult.data.error) throw new Error(signResult.data.error);
  return signResult.data.witnesses!;
}

async function signAndSubmit(txCbor: string, opts?: { password?: string | null; privateKeyBytes?: number[] }): Promise<void> {
  const witnesses = await getWitnesses(txCbor, opts);
  await strikeFinanceApi.submitTx(txCbor, witnesses);
}

function startKeystoneSign(txCbor: string, callback: string) {
  pendingKeystoneCbor.value = txCbor;
  pendingKeystoneCallback.value = callback;
  const txSerialized = Serialization.Transaction.fromCbor(txCbor as any);
  const signRequestResponse: KeystoneSignRequestResponse = createKeystoneSignRequest(
    txSerialized, loggedWallet.value, utxos.value, keys.value
  );
  keystoneType.value = signRequestResponse.ur.type;
  keystoneCbor.value = signRequestResponse.ur.cbor.toString('hex');
  showKeystoneDialog.value = true;
}

// ── Open Position ──

async function handleOpenPosition() {
  openingPosition.value = true;
  positionError.value = '';

  try {
    // Verify password
    const pwResult = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.VERIFY_SPENDING_PASSWORD,
      data: { password: spendingPassword.value },
    }) as { data: { success: boolean; error?: string } };

    if (!pwResult.data.success) {
      positionError.value = 'Wrong password';
      return;
    }

    const txCbor = await buildPerpsOpenCbor();
    await signAndSubmit(txCbor, { password: spendingPassword.value });
    resetNewPositionForm();
  } catch (e: any) {
    console.error('[Perps] Open position error:', e);
    positionError.value = e?.response?.data?.message || e?.message || 'Failed to open position';
  } finally {
    openingPosition.value = false;
  }
}

// ── PRF (PassKey) open position ──

async function onPassKeySuccess(pkBytes: Uint8Array) {
  openingPosition.value = true;
  positionError.value = '';

  try {
    const txCbor = await buildPerpsOpenCbor();
    await signAndSubmit(txCbor, { privateKeyBytes: Array.from(pkBytes) });
    resetNewPositionForm();
  } catch (e: any) {
    console.error('[Perps] PRF open position error:', e);
    positionError.value = e?.response?.data?.message || e?.message || 'Failed to open position';
  } finally {
    openingPosition.value = false;
  }
}

function onPassKeyError(error: Error) {
  console.error('[Perps] PassKey error:', error);
  positionError.value = error.message || 'PassKey authentication failed';
}

// ── Build perpetual TX CBOR ──

async function buildPerpsOpenCbor(): Promise<string> {
  const address = loggedWallet.value?.baseAddress;
  if (!address) throw new Error('No wallet address');

  const asset: Asset = { policyId: '', assetName: '' };

  if (newPos.orderType === 'MARKET') {
    const request: CreatePerpetualRequest = {
      address,
      asset,
      collateralAmount: newPos.collateral,
      leverage: newPos.leverage,
      position: newPos.direction === 'LONG' ? 'Long' : 'Short',
      enteredPositionTime: Date.now(),
    };
    const res = await strikeFinanceApi.openPosition(request);
    return res.data['cbor'];
  } else {
    const request: CreateLimitOrderRequest = {
      address,
      asset,
      collateralAmount: newPos.collateral,
      leverage: newPos.leverage,
      position: newPos.direction === 'LONG' ? 'Long' : 'Short',
      limitUSDPrice: newPos.limitPrice,
    };
    const res = await strikeFinanceApi.openLimitOrder(request);
    return res.data['cbor'];
  }
}

function resetNewPositionForm() {
  showNewPosition.value = false;
  spendingPassword.value = '';
  newPos.collateral = 0;
  newPos.leverage = 2;
  newPos.limitPrice = 0;

  setTimeout(() => {
    loadPositions(false);
    loadLimitOrders(false);
  }, 3000);
}

// ── HW wallet open position (Ledger/Trezor use shared getWitnesses) ──

async function signLedger() {
  openingPosition.value = true;
  positionError.value = '';
  try {
    const txCbor = await buildPerpsOpenCbor();
    await signAndSubmit(txCbor);
    resetNewPositionForm();
  } catch (e: any) {
    ledgerUtils.ledgerErrorHandling(e);
    positionError.value = e?.message || 'Ledger signing failed';
  } finally {
    openingPosition.value = false;
  }
}

async function signTrezor() {
  openingPosition.value = true;
  positionError.value = '';
  try {
    const txCbor = await buildPerpsOpenCbor();
    await signAndSubmit(txCbor);
    resetNewPositionForm();
  } catch (e: any) {
    if (e?.message?.includes('Failure_ActionCancelled') || e?.message?.includes('cancelled')) {
      positionError.value = 'Trezor signing cancelled';
    } else {
      positionError.value = e?.message || 'Trezor signing failed';
    }
  } finally {
    openingPosition.value = false;
  }
}

async function signKeystone() {
  openingPosition.value = true;
  positionError.value = '';
  try {
    const txCbor = await buildPerpsOpenCbor();
    startKeystoneSign(txCbor, 'open');
  } catch (e: any) {
    console.error('[Perps] Keystone sign request error:', e);
    positionError.value = e?.message || 'Keystone signing failed';
    openingPosition.value = false;
  }
}

// ── Keystone QR callbacks ──

const pendingKeystoneCbor = ref('');
const pendingKeystoneCallback = ref('');

async function onKeystoneScan(ur: UR) {
  try {
    const signature = parseSignature(ur);
    if (!signature?.witnessSet || typeof signature.witnessSet !== 'string') {
      throw new Error('Invalid Keystone signature');
    }
    showKeystoneDialog.value = false;

    await strikeFinanceApi.submitTx(pendingKeystoneCbor.value, signature.witnessSet);

    // Trigger appropriate reload based on callback context
    if (pendingKeystoneCallback.value === 'open') {
      resetNewPositionForm();
    } else if (pendingKeystoneCallback.value === 'close' || pendingKeystoneCallback.value === 'cancel') {
      finishConfirmAction();
    }
  } catch (e: any) {
    console.error('[Perps] Keystone QR error:', e);
    const errMsg = e?.message || 'Keystone scan failed';
    positionError.value = errMsg;
    confirmActionError.value = errMsg;
    showKeystoneDialog.value = false;
  } finally {
    openingPosition.value = false;
    confirmActionLoading.value = false;
  }
}

function onKeystoneError(error: string) {
  console.error('[Perps] Keystone scanner error:', error);
  const errMsg = error || 'Keystone scanner error';
  positionError.value = errMsg;
  confirmActionError.value = errMsg;
  showKeystoneDialog.value = false;
  openingPosition.value = false;
  confirmActionLoading.value = false;
}

// ── Close Position ──

function handleClosePosition(pos: PerpetualPosition) {
  confirmActionType.value = 'close';
  confirmActionItem.value = pos;
  confirmActionError.value = '';
  confirmPassword.value = '';
  showConfirmAction.value = true;
}

// ── Cancel Limit Order ──

function handleCancelOrder(order: LimitOrder) {
  confirmActionType.value = 'cancel';
  confirmActionItem.value = order;
  confirmActionError.value = '';
  confirmPassword.value = '';
  showConfirmAction.value = true;
}

// ── Execute confirm action (close/cancel with auth) ──

async function buildConfirmActionCbor(): Promise<string> {
  const item = confirmActionItem.value;
  if (!item) throw new Error('No item selected');

  if (confirmActionType.value === 'close') {
    const closeRequest: ClosePerpetualRequest = {
      address: loggedWallet.value?.baseAddress,
      asset: { policyId: item.asset.asset.policyId, assetName: item.asset.asset.assetName },
      outRef: { txHash: item.outRef.txHash, outputIndex: item.outRef.outputIndex },
    };
    const res = await strikeFinanceApi.closePosition(closeRequest);
    return res.data['cbor'];
  } else {
    const cancelRequest: CancelLimitOrderRequest = {
      address: loggedWallet.value?.baseAddress,
      asset: { policyId: item.asset.asset.policyId, assetName: item.asset.asset.assetName },
      outRef: { txHash: item.outRef.txHash, outputIndex: item.outRef.outputIndex },
    };
    const res = await strikeFinanceApi.cancelLimitOrder(cancelRequest);
    return res.data['cbor'];
  }
}

function finishConfirmAction() {
  showConfirmAction.value = false;
  confirmPassword.value = '';
  confirmActionItem.value = null;
  if (confirmActionType.value === 'close') {
    setTimeout(() => loadPositions(false), 5000);
  } else {
    setTimeout(() => loadLimitOrders(false), 5000);
  }
}

async function executeConfirmAction() {
  confirmActionLoading.value = true;
  confirmActionError.value = '';

  try {
    if (isNormalWallet.value && !isPrfWallet.value) {
      const pwResult = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.VERIFY_SPENDING_PASSWORD,
        data: { password: confirmPassword.value },
      }) as { data: { success: boolean; error?: string } };
      if (!pwResult.data.success) {
        confirmActionError.value = 'Wrong password';
        return;
      }
    }

    const txCbor = await buildConfirmActionCbor();

    if (walletType.value === WalletType.Keystone) {
      startKeystoneSign(txCbor, confirmActionType.value);
      return;
    }

    await signAndSubmit(txCbor, { password: confirmPassword.value || null });
    finishConfirmAction();
  } catch (e: any) {
    console.error(`[Perps] ${confirmActionType.value} error:`, e);
    confirmActionError.value = e?.response?.data?.message || e?.message || 'Operation failed';
  } finally {
    confirmActionLoading.value = false;
  }
}

async function onConfirmPassKeySuccess(pkBytes: Uint8Array) {
  confirmActionLoading.value = true;
  confirmActionError.value = '';

  try {
    const txCbor = await buildConfirmActionCbor();
    await signAndSubmit(txCbor, { privateKeyBytes: Array.from(pkBytes) });
    finishConfirmAction();
  } catch (e: any) {
    console.error(`[Perps] PRF ${confirmActionType.value} error:`, e);
    confirmActionError.value = e?.response?.data?.message || e?.message || 'Operation failed';
  } finally {
    confirmActionLoading.value = false;
  }
}

function onConfirmPassKeyError(error: Error) {
  console.error('[Perps] Confirm PassKey error:', error);
  confirmActionError.value = error.message || 'PassKey authentication failed';
}

// ── Lifecycle ──

let refreshInterval: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  if (perpetualsSupported.value) {
    loadPositions();
    loadLimitOrders();
    loadHistory();

    // Auto-refresh positions every 30s
    refreshInterval = setInterval(() => {
      if (activeSegment.value === 'positions') loadPositions(false);
    }, 30000);
  }
});

onBeforeUnmount(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
});
</script>

<style scoped>
.perps-page {
  min-height: 100%;
  padding-bottom: 80px;
}

.perps-header {
  padding-bottom: 8px !important;
}

.price-ticker {
  text-align: right;
}

.price-value {
  color: white;
  font-size: 16px;
  font-weight: 700;
  font-family: monospace;
}

.green-text { color: #26FAB0 !important; }
.red-text { color: #ef4444 !important; }

/* Segment toggle */
.segment-toggle {
  display: flex;
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 3px;
  gap: 2px;
}

.segment-btn {
  flex: 1;
  padding: 6px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #888;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.segment-btn--active {
  background: rgba(38, 250, 176, 0.15);
  color: #26FAB0;
  font-weight: 600;
}

.segment-count {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 0 5px;
  font-size: 10px;
  min-width: 16px;
  text-align: center;
}

.segment-btn--active .segment-count {
  background: rgba(38, 250, 176, 0.2);
}

/* Empty states */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 24px;
}

.empty-state-small {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 24px;
}

/* Position cards */
.position-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.position-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 12px;
}

.position-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.position-ticker {
  color: white;
  font-size: 13px;
  font-weight: 600;
}

.position-leverage {
  color: #888;
  font-size: 11px;
  background: rgba(255, 255, 255, 0.06);
  padding: 1px 5px;
  border-radius: 4px;
}

.position-type-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  letter-spacing: 0.5px;
}

.badge-long {
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
  border: 1px solid rgba(16, 185, 129, 0.3);
}

.badge-short {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.position-card-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.position-stat {
  display: flex;
  flex-direction: column;
}

.stat-label {
  font-size: 10px;
  color: #666;
}

.stat-value {
  font-size: 13px;
  color: white;
  font-weight: 500;
}

/* FAB */
.open-position-fab {
  position: fixed;
  bottom: 72px;
  right: 16px;
  z-index: 3;
  background: linear-gradient(135deg, #26FAB0, #00c7f3) !important;
  color: #000 !important;
}

/* New position form */
.new-position-form {
  padding: 4px 0;
}

.form-section {
  margin-bottom: 0;
}

.form-label {
  font-size: 12px;
  color: #999;
  font-weight: 500;
}

.leverage-display {
  font-size: 14px;
  font-weight: 700;
  font-family: monospace;
}

.direction-toggle {
  display: flex;
  gap: 4px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 10px;
  padding: 3px;
}

.dir-btn {
  flex: 1;
  padding: 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #888;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dir-btn--long-active {
  background: rgba(38, 250, 176, 0.15);
  color: #26FAB0;
}

.dir-btn--short-active {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.form-input >>> .v-input__slot {
  background: rgba(255, 255, 255, 0.04) !important;
  min-height: 36px !important;
}

.form-input >>> .v-input__slot fieldset {
  border-color: rgba(255, 255, 255, 0.08) !important;
}

.leverage-slider {
  margin-top: 0 !important;
}

.position-summary {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 10px 12px;
}

.summary-row {
  display: flex;
  justify-content: space-between;
  padding: 3px 0;
}

.open-btn {
  font-weight: 600;
  text-transform: none;
  border-radius: 10px;
  height: 44px !important;
  color: #000 !important;
}

.open-btn--long {
  background: linear-gradient(135deg, #26FAB0, #00ffd1) !important;
}

.open-btn--short {
  background: linear-gradient(135deg, #ef4444, #f97066) !important;
  color: white !important;
}

.open-btn.v-btn--disabled {
  background: rgba(255, 255, 255, 0.06) !important;
  color: #666 !important;
}

.hw-notice {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  margin-bottom: 12px;
}

/* Hide number input spinners */
.form-input ::v-deep input[type="number"]::-webkit-outer-spin-button,
.form-input ::v-deep input[type="number"]::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.form-input ::v-deep input[type="number"] {
  -moz-appearance: textfield;
}
</style>
