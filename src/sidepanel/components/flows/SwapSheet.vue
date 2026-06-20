<template>
  <BottomSheet :value="value" @input="onSheetInput" :title="sheetTitle" height="68%" persistent>
    <div class="swap-sheet">

      <!-- ═══════ MAINTENANCE OVERLAY ═══════ -->
      <div v-if="!isSwapEnabled" class="maintenance-overlay">
        <v-icon size="56" color="warning">mdi-alert-circle-outline</v-icon>
        <div class="text-h6 white--text mt-3">{{ $t('miniGero.swapMaintenance') }}</div>
      </div>

      <!-- ═══════ SUCCESS / STATUS ═══════ -->
      <div v-else-if="step === 'status'" class="success-overlay">
        <template v-if="txSuccess">
          <v-icon size="56" color="#47CD89">mdi-check-circle</v-icon>
          <div class="text-h6 white--text mt-3">
            {{ swapType === 'limit' ? $t('miniGero.orderPlaced') : $t('miniGero.swapSuccess') }}
          </div>
          <div class="text-caption grey--text mt-1 text-center">{{ $t('miniGero.txSubmittedDesc') }}</div>
          <div v-if="txId" class="tx-id-box mt-4" @click="copyTxId">
            <span class="text-caption grey--text">{{ truncateStr(txId) }}</span>
            <v-icon x-small :color="primaryColor" class="ml-1">mdi-content-copy</v-icon>
          </div>
        </template>
        <template v-else>
          <v-icon size="56" color="#F97066">mdi-close-circle</v-icon>
          <div class="text-h6 white--text mt-3">{{ $t('miniGero.swapFailed') }}</div>
          <div v-if="statusError" class="text-caption mt-2 text-center" style="color: #F97066">{{ statusError }}</div>
        </template>
        <v-btn block :color="primaryColor" class="black--text font-weight-bold mt-6" @click="onDone">
          {{ txSuccess ? $t('miniGero.done') : $t('miniGero.tryAgain') }}
        </v-btn>
      </div>

      <!-- ═══════ TOKEN SELECT OVERLAY ═══════ -->
      <div v-else-if="step === 'token-select'" class="token-select-overlay">
        <v-text-field
          v-model="tokenSearchQuery"
          :placeholder="$t('miniGero.searchTokens')"
          outlined dense dark hide-details
          class="mini-input mb-3"
          prepend-inner-icon="mdi-magnify"
          clearable
          autofocus
        />
        <div class="token-list">
          <div
            v-for="token in filteredTokenList"
            :key="token.unit"
            class="token-list-item"
            @click="onTokenSelected(token)"
          >
            <v-avatar size="32" class="mr-3">
              <img :src="getTokenImg(token)" :alt="token.ticker" @error="onTokenImgError($event, token)" />
            </v-avatar>
            <div class="token-item-info">
              <span class="white--text text-body-2 font-weight-bold">{{ token.ticker || token.name }}</span>
              <span class="grey--text text-caption">{{ token.name }}</span>
            </div>
            <v-spacer />
            <div class="text-right">
              <div class="white--text text-body-2">{{ formatTokenBalance(token) }}</div>
              <div v-if="token.verified" class="text-caption" style="color: #47CD89">
                <v-icon x-small color="#47CD89">mdi-check-decagram</v-icon>
              </div>
            </div>
            <v-icon
              v-if="(selectingTokenSide === 'A' && token.unit === selectedTokenA.unit) ||
                    (selectingTokenSide === 'B' && token.unit === selectedTokenB.unit)"
              small :color="primaryColor" class="ml-2"
            >mdi-check-circle</v-icon>
          </div>
          <div v-if="filteredTokenList.length === 0" class="text-caption grey--text text-center pa-4">
            {{ $t('miniGero.noTokensFound') }}
          </div>
        </div>
        <v-btn text small color="#888" class="mt-2" @click="step = previousStep">
          {{ $t('miniGero.back') }}
        </v-btn>
      </div>

      <!-- ═══════ SETTINGS OVERLAY ═══════ -->
      <div v-else-if="step === 'settings'" class="settings-overlay">
        <!-- Slippage -->
        <div class="glass-card pa-4 mb-4">
          <div class="text-body-2 white--text font-weight-bold mb-3">{{ $t('miniGero.slippageTolerance') }}</div>
          <div class="d-flex" style="gap: 8px; flex-wrap: wrap">
            <v-btn
              v-for="preset in slippagePresets"
              :key="preset.value"
              small
              :outlined="slippageRef !== preset.value"
              :color="slippageRef === preset.value ? primaryColor : 'rgba(255,255,255,0.15)'"
              :class="slippageRef === preset.value ? 'black--text' : 'white--text'"
              @click="slippageRef = preset.value"
            >
              <v-icon v-if="preset.value === 'unlimited'" x-small color="red" class="mr-1">mdi-infinity</v-icon>
              {{ preset.label }}
            </v-btn>
          </div>
          <div class="d-flex align-center mt-2" style="gap: 8px">
            <input
              v-model="customSlippage"
              type="text"
              inputmode="decimal"
              class="amount-input"
              :placeholder="$t('miniGero.custom')"
              style="width: 80px; font-size: 13px"
              @input="onCustomSlippage"
            />
            <span class="text-caption grey--text">%</span>
          </div>
          <div v-if="slippageRef === 'unlimited' || (slippageRef !== 'auto' && Number(slippageRef) > 5)" class="text-caption mt-2" style="color: #F97066">
            {{ $t('miniGero.highSlippageWarning') }}
          </div>
        </div>

        <!-- DEX Routing -->
        <div class="glass-card pa-4">
          <div class="d-flex align-center justify-space-between mb-3">
            <span class="text-body-2 white--text font-weight-bold">{{ $t('miniGero.dexRouting') }}</span>
            <v-btn x-small text :color="primaryColor" @click="toggleAllDexes">
              {{ allDexesEnabled ? $t('miniGero.deselectAll') : $t('miniGero.selectAll') }}
            </v-btn>
          </div>
          <div class="dex-grid">
            <div
              v-for="dex in dexList"
              :key="dex"
              class="dex-chip"
              :class="{ active: !blacklistedDexes.includes(dex) }"
              @click="toggleDex(dex)"
            >
              <span class="text-caption">{{ dex }}</span>
            </div>
          </div>
        </div>

        <v-btn block :color="primaryColor" class="black--text font-weight-bold mt-4" @click="step = previousStep">
          {{ $t('miniGero.done') }}
        </v-btn>
      </div>

      <!-- ═══════ REVIEW STEP ═══════ -->
      <div v-else-if="step === 'review'" class="review-step">
        <div class="glass-card pa-4 mb-3">
          <div class="review-row">
            <span class="detail-label">{{ $t('miniGero.youPay') }}</span>
            <span class="detail-value white--text font-weight-bold">
              {{ selectedTokenA.quantity }} {{ selectedTokenA.ticker }}
              <div class="text-caption grey--text">${{ getUsdValue(selectedTokenA) }}</div>
            </span>
          </div>
          <div class="review-row">
            <span class="detail-label">{{ $t('miniGero.youReceive') }}</span>
            <span class="detail-value white--text font-weight-bold">
              {{ selectedTokenB.quantity }} {{ selectedTokenB.ticker }}
              <div class="text-caption grey--text">${{ getUsdValue(selectedTokenB) }}</div>
            </span>
          </div>
          <div v-if="swapType === 'swap'" class="review-row">
            <span class="detail-label">{{ $t('miniGero.rate') }}</span>
            <span class="detail-value">{{ pairPrice }}</span>
          </div>
          <div v-if="swapType === 'swap' && calculateWeightedPriceImpact !== 0" class="review-row">
            <span class="detail-label">{{ $t('miniGero.priceImpact') }}</span>
            <span class="detail-value" :style="{ color: Math.abs(calculateWeightedPriceImpact) > 5 ? '#F97066' : '#47CD89' }">
              {{ calculateWeightedPriceImpact.toFixed(2) }}%
            </span>
          </div>
          <div v-if="swapType === 'swap' && estimation.batcher_fee" class="review-row">
            <span class="detail-label">{{ $t('miniGero.networkFee') }}</span>
            <span class="detail-value">{{ (estimation.batcher_fee / 1_000_000).toFixed(2) }} ADA</span>
          </div>
          <div v-if="swapType === 'swap' && estimation.minReceive" class="review-row">
            <span class="detail-label">{{ $t('miniGero.minReceived') }}</span>
            <span class="detail-value">{{ estimation.minReceive }} {{ selectedTokenB.ticker }}</span>
          </div>
          <div class="review-row">
            <span class="detail-label">{{ $t('miniGero.slippageTolerance') }}</span>
            <span class="detail-value">{{ slippageDisplay }}</span>
          </div>
          <div v-if="swapType === 'limit'" class="review-row">
            <span class="detail-label">{{ $t('miniGero.targetPrice') }}</span>
            <span class="detail-value">{{ Number(limit).toFixed(7) }}</span>
          </div>
          <div v-if="swapType === 'limit' && limitType === 'split'" class="review-row">
            <span class="detail-label">{{ $t('miniGero.splitOrder') }}</span>
            <span class="detail-value">{{ limitSplit }} {{ $t('miniGero.splits') }}</span>
          </div>
          <div v-if="swapType === 'swap' && splits && splits.length > 0" class="review-row">
            <span class="detail-label">{{ $t('miniGero.route') }}</span>
            <span class="detail-value">
              <span v-for="(s, i) in splits" :key="i">
                {{ s.dex }}<span v-if="i < splits.length - 1">, </span>
              </span>
            </span>
          </div>
        </div>

        <!-- Authentication -->
        <template v-if="isNormalWallet && !isPrfWallet">
          <div class="text-caption grey--text mb-2">{{ $t('miniGero.spendingPassword') }}</div>
          <v-text-field
            v-model="spendingPassword"
            :type="showPassword ? 'text' : 'password'"
            outlined dense dark hide-details="auto"
            :error-messages="passwordError"
            class="mini-input"
            :placeholder="$t('miniGero.enterPassword')"
            :append-icon="showPassword ? 'mdi-eye' : 'mdi-eye-off'"
            @click:append="showPassword = !showPassword"
            @keydown.enter="executeSwap"
          />
          <v-btn
            block :color="primaryColor" class="black--text font-weight-bold mt-4"
            :disabled="!spendingPassword || submitting"
            :loading="submitting"
            @click="executeSwap"
          >
            {{ $t('miniGero.confirmSwap') }}
          </v-btn>
        </template>

        <template v-else-if="isNormalWallet && isPrfWallet">
          <div class="hw-notice">
            <v-icon size="40" :color="primaryColor" class="mb-2">mdi-fingerprint</v-icon>
            <div class="text-body-2 white--text text-center mb-3">{{ $t('miniGero.prfAuthPrompt') }}</div>
          </div>
          <PassKeyAuthButton
            :disabled="submitting"
            @success="onPassKeySuccess"
            @error="onPassKeyError"
            class="mb-2"
            style="width: 100%"
          />
        </template>

        <template v-else-if="walletType === WalletType.Ledger">
          <div class="hw-notice">
            <v-icon size="40" :color="primaryColor" class="mb-2">mdi-usb</v-icon>
            <div class="text-body-2 white--text text-center mb-2">{{ $t('miniGero.connectLedger') }}</div>
            <div v-if="loggedWallet?.btSupported" class="d-flex align-center justify-center mb-2" style="gap: 8px;">
              <v-btn x-small :outlined="isBT" :color="!isBT ? primaryColor : '#555'" class="black--text" @click="isBT = false">
                <v-icon x-small class="mr-1">mdi-usb</v-icon> USB
              </v-btn>
              <v-btn x-small :outlined="!isBT" :color="isBT ? primaryColor : '#555'" class="black--text" @click="isBT = true">
                <v-icon x-small class="mr-1">mdi-bluetooth</v-icon> BT
              </v-btn>
            </div>
          </div>
          <v-btn
            block :color="primaryColor" class="black--text font-weight-bold"
            :disabled="submitting" :loading="submitting"
            @click="signLedger"
          >
            <v-icon left small>mdi-draw</v-icon>
            {{ $t('wallet.sign') }}
          </v-btn>
        </template>

        <template v-else-if="walletType === WalletType.Trezor">
          <div class="hw-notice">
            <v-icon size="40" :color="primaryColor" class="mb-2">mdi-shield-check-outline</v-icon>
            <div class="text-body-2 white--text text-center mb-2">{{ $t('miniGero.connectTrezor') }}</div>
          </div>
          <v-btn
            block :color="primaryColor" class="black--text font-weight-bold"
            :disabled="submitting" :loading="submitting"
            @click="signTrezor"
          >
            <v-icon left small>mdi-draw</v-icon>
            {{ $t('wallet.sign') }}
          </v-btn>
        </template>

        <template v-else-if="walletType === WalletType.Keystone">
          <div class="hw-notice">
            <v-icon size="40" :color="primaryColor" class="mb-2">mdi-qrcode</v-icon>
            <div class="text-body-2 white--text text-center mb-2">{{ $t('miniGero.keystoneSign') }}</div>
          </div>
          <v-btn
            block :color="primaryColor" class="black--text font-weight-bold"
            :disabled="submitting" :loading="submitting"
            @click="signKeystone"
          >
            <v-icon left small>mdi-qrcode-scan</v-icon>
            {{ $t('wallet.sign') }}
          </v-btn>
        </template>

        <div v-if="passwordError" class="text-caption mt-2" style="color: #F97066">{{ passwordError }}</div>

        <v-btn text small color="#888" class="mt-3" block @click="step = 'swap'">
          {{ $t('miniGero.back') }}
        </v-btn>
      </div>

      <!-- ═══════ MAIN SWAP / LIMIT FORM ═══════ -->
      <template v-else>
        <!-- Swap type toggle -->
        <div class="d-flex align-center mb-3" style="gap: 8px">
          <v-btn-toggle v-model="swapType" mandatory dense class="swap-type-toggle">
            <v-btn value="swap" small :class="swapType === 'swap' ? 'active-toggle' : 'inactive-toggle'">
              {{ $t('miniGero.instant') }}
            </v-btn>
            <v-btn value="limit" small :class="swapType === 'limit' ? 'active-toggle' : 'inactive-toggle'">
              {{ $t('miniGero.limit') }}
            </v-btn>
          </v-btn-toggle>
          <v-spacer />
          <v-btn icon x-small @click="refreshEstimate">
            <v-icon x-small color="#888">mdi-reload</v-icon>
          </v-btn>
          <v-btn x-small text class="slippage-btn" @click="openSettings">
            <v-icon v-if="slippageRef === 'unlimited'" color="red" x-small>mdi-infinity</v-icon>
            <span v-else style="font-size: 11px">{{ slippageDisplay }}</span>
            <v-icon x-small class="ml-1">mdi-cog</v-icon>
          </v-btn>
        </div>

        <!-- You Pay card -->
        <div class="glass-card pa-3 mb-2">
          <div class="d-flex align-center justify-space-between mb-2">
            <span class="text-caption" style="color: #FDA29B">{{ $t('miniGero.youPay') }}</span>
            <span class="text-caption grey--text">
              {{ $t('miniGero.available') }}: {{ formatTokenBalance(selectedTokenA) }}
            </span>
          </div>
          <div class="d-flex align-center" style="gap: 8px">
            <div class="token-select-btn" @click="openTokenSelect('A')">
              <v-avatar size="28" class="mr-2">
                <img :src="selectedTokenA.img" :alt="selectedTokenA.ticker" @error="onTokenImgError($event, selectedTokenA)" />
              </v-avatar>
              <span class="white--text text-body-2 font-weight-bold">{{ selectedTokenA.ticker }}</span>
              <v-icon x-small color="#888" class="ml-1">mdi-chevron-down</v-icon>
            </div>
            <v-spacer />
            <input
              v-model="tokenAInput"
              type="text"
              inputmode="decimal"
              class="amount-input"
              placeholder="0"
              @input="onTokenAInput"
            />
          </div>
          <div class="d-flex align-center justify-space-between mt-1">
            <span class="text-caption grey--text">${{ getUsdValue(selectedTokenA) }}</span>
            <v-btn x-small text :color="primaryColor" @click="setMaxTokenA" class="px-1" style="min-width: 0">
              {{ $t('miniGero.max') }}
            </v-btn>
          </div>
        </div>

        <!-- Flip arrow -->
        <div class="text-center" style="margin: -4px 0; position: relative; z-index: 2">
          <v-btn icon small class="flip-btn" @click="switchPair">
            <v-icon :color="primaryColor">mdi-swap-vertical</v-icon>
          </v-btn>
        </div>

        <!-- You Receive card -->
        <div class="glass-card pa-3 mt-2">
          <div class="d-flex align-center justify-space-between mb-2">
            <span class="text-caption" style="color: #75E0A7">{{ $t('miniGero.youReceive') }}</span>
          </div>
          <div class="d-flex align-center" style="gap: 8px">
            <div class="token-select-btn" @click="openTokenSelect('B')">
              <v-avatar size="28" class="mr-2">
                <img :src="selectedTokenB.img" :alt="selectedTokenB.ticker" @error="onTokenImgError($event, selectedTokenB)" />
              </v-avatar>
              <span class="white--text text-body-2 font-weight-bold">{{ selectedTokenB.ticker }}</span>
              <v-icon x-small color="#888" class="ml-1">mdi-chevron-down</v-icon>
            </div>
            <v-spacer />
            <div class="amount-display">
              <span v-if="estimating" class="grey--text">...</span>
              <span v-else class="white--text">{{ selectedTokenB.quantity || '0' }}</span>
            </div>
          </div>
          <div class="d-flex align-center mt-1">
            <span class="text-caption grey--text">${{ getUsdValue(selectedTokenB) }}</span>
          </div>
        </div>

        <!-- Pair price (instant swap) -->
        <div v-if="swapType === 'swap' && !poolError" class="d-flex align-center justify-space-between mt-2 px-1">
          <v-btn text plain x-small class="px-0" :ripple="false" @click="pairPriceToggle = !pairPriceToggle" style="letter-spacing: normal">
            <v-avatar color="primary" size="8" class="mr-1 v-avatar--metronome" :style="{ animationDuration: '1.5s' }" />
            <span class="text-caption grey--text">{{ pairPrice }}</span>
          </v-btn>
        </div>
        <div v-if="poolError" class="text-caption mt-2 text-center" style="color: #F97066">
          {{ $t('swap.poolNotFound') }}
        </div>

        <!-- Limit order section -->
        <div v-if="swapType === 'limit'" class="glass-card pa-3 mt-3">
          <div class="d-flex align-center justify-space-between mb-2">
            <span class="text-caption white--text font-weight-bold">{{ $t('miniGero.targetPrice') }}</span>
            <span
              v-if="marketPriceDelta.toFixed(2) !== '0.00' && marketPriceDelta.toFixed(2) !== '-0.00'"
              class="text-caption"
              :style="{ color: marketPriceDelta > 0 ? '#75E0A7' : '#FDA29B' }"
            >
              {{ marketPriceDelta > 0 ? '+' : '' }}{{ marketPriceDelta.toFixed(2) }}%
            </span>
          </div>
          <input
            v-model="limit"
            type="text"
            inputmode="decimal"
            class="amount-input mb-2"
            placeholder="0.0000000"
            @input="onLimitInput"
          />
          <div class="d-flex mb-3" style="gap: 4px; flex-wrap: wrap">
            <template v-if="selectedTokenA.ticker === 'ADA'">
              <v-btn v-for="pct in [-5, -10, -25, -50]" :key="pct" x-small text style="color: #FDA29B" class="px-1" @click="setLimitByPercentage(pct)">
                {{ pct }}%
              </v-btn>
            </template>
            <template v-else>
              <v-btn v-for="pct in [5, 10, 25, 50]" :key="pct" x-small text style="color: #75E0A7" class="px-1" @click="setLimitByPercentage(pct)">
                +{{ pct }}%
              </v-btn>
            </template>
          </div>

          <div class="d-flex align-center mb-2" style="gap: 8px">
            <v-btn-toggle v-model="limitType" mandatory dense>
              <v-btn value="one" x-small>{{ $t('miniGero.oneOrder') }}</v-btn>
              <v-btn value="split" x-small>{{ $t('miniGero.splitOrder') }}</v-btn>
            </v-btn-toggle>
          </div>
          <div v-if="limitType === 'split'" class="d-flex align-center" style="gap: 8px">
            <v-slider
              v-model="limitSplit"
              dense min="1" max="40" hide-details
              style="height: 20px"
            />
            <span class="text-caption white--text" style="width: 45px; text-align: end">{{ limitSplit }}/40</span>
          </div>
        </div>

        <!-- Spacer to push button to bottom -->
        <div style="flex: 1 1 0px" />

        <!-- Swap / Review button -->
        <div style="flex: 0 0 auto; padding-bottom: 64px">
          <v-btn
            block :color="primaryColor" class="black--text font-weight-bold"
            :disabled="isSwapDisabled || loading || poolError"
            :loading="loading"
            @click="goToReview"
          >
            {{ swapButtonText }}
          </v-btn>
        </div>
      </template>
    </div>

    <!-- Keystone Sign Dialog -->
    <KeystoneSignDialog
      :isOpen="showKeystoneDialog"
      :keystoneType="keystoneType"
      :keystoneCbor="keystoneCbor"
      @scan="onKeystoneScan"
      @error="onKeystoneError"
      @close="showKeystoneDialog = false"
    />
  </BottomSheet>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRefs, watch } from 'vue';
import debounce from 'lodash/debounce';
import BottomSheet from '../BottomSheet.vue';
import PassKeyAuthButton from '@/shared/components/PassKeyAuthButton.vue';
import KeystoneSignDialog from '@/shared/dialogs/KeystoneSignDialog.vue';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Messaging, BackgroundResponse, VerifyPasswordResponse, SignTxResponse } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { applyTokenImageOverride } from '@/shared/utils/resolver';
import { WalletType } from '@/models/types';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { priceStore } from '@/stores/priceStore';
import DexHunterStore, { dexHunterStore } from '@/stores/dexHunterStore';
import featureFlagsStore from '@/stores/featureFlagsStore';
import { useTranslation } from '@/shared/composables/useTranslation';
import dexHunterApi from '@/api/dexhunter-api';
import ledgerUtils from '@/shared/utils/ledger';
import { createKeystoneSignRequest, KeystoneSignRequestResponse, parseSignature } from '@/shared/utils/keystone';
import { UR } from '@keystonehq/keystone-sdk';
import networks from '@/utils/networks';
import filters from '@/shared/utils/filters';
import snackbar from '@/plugins/snackbar';
import cardanoSvg from '@/assets/svg/cardano.svg';
import { debugLog } from '@/utils/debug';
import { useChainContext } from '../../composables/useChainContext';

const { themeColors } = useChainContext();
const primaryColor = computed(() => themeColors.value.primary);

type Step = 'swap' | 'limit' | 'token-select' | 'settings' | 'review' | 'status';

const props = defineProps<{ value: boolean }>();
const emit = defineEmits<{ (e: 'input', value: boolean): void }>();

const { t } = useTranslation();
const { loggedWallet, tokens: resolvedAssets, utxos, keys } = toRefs(walletStore);
const { price } = toRefs(networkStore);
const { dexHunterTokens } = toRefs(dexHunterStore);

// ── Steps ──
const step = ref<Step>('swap');
const previousStep = ref<Step>('swap');

// ── Swap state ──
const swapType = ref<'swap' | 'limit'>('swap');
const slippageRef = ref<string>('2');
const customSlippage = ref('');
const loading = ref(false);
const estimating = ref(false);
const submitting = ref(false);
const pairPriceToggle = ref(false);
const poolError = ref(false);
const txSuccess = ref(false);
const txId = ref('');
const statusError = ref('');

// ── Token selection ──
const tokenSearchQuery = ref('');
const selectingTokenSide = ref<'A' | 'B'>('A');

// ── Auth state ──
const spendingPassword = ref('');
const passwordError = ref('');
const showPassword = ref(false);
const isBT = ref(false);

// ── Keystone ──
const keystoneType = ref('');
const keystoneCbor = ref('');
const showKeystoneDialog = ref(false);

// ── Limit order ──
const limit = ref<string>('0.0000000');
const limitType = ref<'one' | 'split'>('one');
const limitSplit = ref<number>(1);
// ── Estimate data ──
const price_ab = ref(0);
const price_ba = ref(0);
const price_ab2 = ref(0);
const price_ba2 = ref(0);
const total_output_without_slippage = ref(0);
const estimation = ref<any>({
  net_price_reverse: 0,
  total_output: 0,
  deposits: 0,
  batcher_fee: 0,
  partner_fee: 0,
});
const splits = ref<any[]>([]);
const blacklistedDexes = ref<string[]>([]);
const isUpdating = ref(false);
const lastNonADATokenA = ref<any>(null);
const lastNonADATokenB = ref<any>(null);

// ── Swap TX data (held between build and sign) ──
const swapTxCbor = ref('');

// ── Interval for periodic estimate ──
let intervalId: any = null;

// ── Token A input (user-facing string) ──
const tokenAInput = ref('');

// ── Tokens ──
const selectedTokenA = ref<any>({
  name: 'Cardano',
  ticker: 'ADA',
  img: cardanoSvg,
  fallback_img: 'https://storage.googleapis.com/dexhunter-images/public/unverified.svg',
  balance: 0,
  quantity: '0',
  decimals: 6,
  unit: '',
  verified: true,
});

const selectedTokenB = ref<any>({
  name: 'GERO',
  ticker: 'GERO',
  img: 'https://storage.googleapis.com/dexhunter-images/tokens/10a49b996e2402269af553a8a96fb8eb90d79e9eca79e2b4223057b64745524f.webp',
  fallback_img: 'https://storage.googleapis.com/dexhunter-images/public/unverified.svg',
  balance: 0,
  quantity: '0',
  decimals: 6,
  unit: '10a49b996e2402269af553a8a96fb8eb90d79e9eca79e2b4223057b64745524f',
  verified: true,
});

// ── Constants ──
const dexList = [
  'SPLASH', 'MINSWAPV2', 'SUNDAESWAPV3', 'AXO', 'VYFI', 'WINGRIDER',
  'SPECTRUM', 'MINSWAP', 'SUNDAESWAP', 'CERRASWAP', 'SATURN', 'GENIUS', 'MUESLISWAP',
];

const slippagePresets = [
  { value: '0.5', label: '0.5%' },
  { value: '1', label: '1%' },
  { value: '2', label: '2%' },
  { value: 'unlimited', label: '' },
];

// ── Computed ──
const isSwapEnabled = computed(() => featureFlagsStore.isSwapEnabled());

const isNormalWallet = computed(() => loggedWallet.value?.type === WalletType.Normal);
const walletType = computed(() => loggedWallet.value?.type || WalletType.Normal);

const isPrfWallet = computed(() =>
  loggedWallet.value?.encryptionMethod === 'prf' ||
  (!!loggedWallet.value?.prfEncryptedPrivateKey && !!loggedWallet.value?.webAuthnCredentialId)
);

const sheetTitle = computed(() => {
  if (step.value === 'status') return '';
  if (step.value === 'token-select') return t('miniGero.selectToken');
  if (step.value === 'settings') return t('miniGero.swapSettings');
  if (step.value === 'review') {
    return swapType.value === 'limit' ? t('miniGero.reviewOrder') : t('miniGero.reviewSwap');
  }
  return t('miniGero.swapTitle');
});

const nativeTokenComputed = computed(() => {
  const currencyTicker = networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network);
  const assetsArray = resolvedAssets.value ? Object.values(resolvedAssets.value) : [];
  const token: any = assetsArray.find((t: any) => t.metadata?.ticker === currencyTicker);
  if (token) {
    return { ...token, decimals: token.metadata?.decimals ?? token.decimals ?? 6 };
  }
  return {
    name: 'Cardano', ticker: 'ADA', img: cardanoSvg,
    balance: 0, quantity: '0', decimals: 6, unit: '', verified: true,
  };
});

const availableTokens = computed(() => {
  if (!dexHunterTokens.value) return [];
  const nativeToken = {
    ticker: nativeTokenComputed.value.metadata?.ticker,
    balance: nativeTokenComputed.value.quantity,
    ...nativeTokenComputed.value,
  };
  const tokens = Object.values(dexHunterTokens.value)
    .map((token: any) => {
      const found: any = resolvedAssets.value?.[token.unit];
      const res = {
        ...token,
        balance: found ? found.quantity : 0,
        decimals: token.metadata?.decimals ?? token.decimals ?? 6,
      };
      return res;
    })
    .sort((a, b) => b.balance - a.balance)
    .filter((t: any) => t.name !== nativeToken.ticker);
  return [nativeToken, ...tokens];
});

const filteredTokenList = computed(() => {
  const q = (tokenSearchQuery.value || '').toLowerCase();
  if (!q) return availableTokens.value;
  return availableTokens.value.filter(t =>
    (t.ticker || '').toLowerCase().includes(q) ||
    (t.name || '').toLowerCase().includes(q) ||
    (t.unit || '').toLowerCase().includes(q)
  );
});

const isInsufficientBalance = computed(() => {
  if (!selectedTokenA.value) return false;
  const quantityA = (selectedTokenA.value.quantity || '0').toString().replaceAll(',', '');
  const decimals = selectedTokenA.value.decimals || 0;
  const balance = selectedTokenA.value.balance || 0;
  const balanceA = filters.convertFromSmallestUnit(balance, decimals);
  return Number(quantityA) > balanceA;
});

const isSwapDisabled = computed(() => {
  if (!selectedTokenA.value || !selectedTokenB.value) return true;
  if (swapType.value === 'swap') {
    const quantityA = (selectedTokenA.value.quantity || '0').toString().replaceAll(',', '');
    const quantityB = (selectedTokenB.value.quantity || '0').toString().replaceAll(',', '');
    return quantityA === '0' || quantityB === '0' || isNaN(Number(quantityA)) || isNaN(Number(quantityB)) || isInsufficientBalance.value;
  } else if (swapType.value === 'limit') {
    const quantity = (selectedTokenA.value.quantity || '0').toString().replaceAll(',', '');
    return isInsufficientBalance.value || Number(quantity) === 0 || Number(limit.value).toFixed(7) === price_ba2.value.toFixed(7);
  }
  return true;
});

const swapButtonText = computed(() => {
  if (isInsufficientBalance.value) return t('miniGero.insufficientBalance');
  if (poolError.value) return t('swap.poolNotFound');
  if (swapType.value === 'limit') {
    if (limitType.value === 'one' || (limitType.value === 'split' && limitSplit.value === 1)) {
      return t('miniGero.placeLimitOrder');
    }
    return t('miniGero.placeOrders').replace('{count}', String(limitSplit.value));
  }
  return t('miniGero.reviewSwap');
});

const slippageDisplay = computed(() => {
  return slippageRef.value === 'auto' ? 'AUTO' : `${slippageRef.value}%`;
});

const pairPrice = computed(() => {
  if (poolError.value) return '';
  const tokenA = selectedTokenA.value?.ticker;
  const tokenB = selectedTokenB.value?.ticker === 'ADA' ? tokenA : selectedTokenB.value?.ticker;
  if (!pairPriceToggle.value) {
    return `1 ${tokenB} = ${price_ba2.value?.toFixed(7)} ADA`;
  }
  return `1 ADA = ${price_ab2.value?.toFixed(7)} ${tokenB}`;
});

const calculateWeightedPriceImpact = computed(() => {
  if (swapType.value === 'limit' || !splits.value?.length) return 0;
  let totalAmount = 0;
  let totalWeightedImpact = 0;
  splits.value.forEach(({ price_impact, amount_in }: any) => {
    totalAmount += amount_in;
    totalWeightedImpact += price_impact * amount_in;
  });
  return totalAmount === 0 ? 0 : Number(totalWeightedImpact / totalAmount);
});

const marketPriceDelta = computed(() => {
  if (limit.value === '0' || !price_ba2.value) return 0;
  return ((Number(limit.value) - price_ba2.value) / price_ba2.value) * 100;
});

const allDexesEnabled = computed(() => blacklistedDexes.value.length === 0);

// ── Watchers ──
watch(() => selectedTokenA.value?.ticker, async (newVal) => {
  if (isUpdating.value) return;
  isUpdating.value = true;
  if (newVal === 'ADA') {
    if (lastNonADATokenB.value) {
      const found = availableTokens.value.find(t => t.ticker === lastNonADATokenB.value?.ticker);
      if (found) selectedTokenB.value = found;
    }
  } else {
    lastNonADATokenA.value = { ...selectedTokenA.value };
    const found = availableTokens.value.find(t => t.ticker === 'ADA');
    if (found) selectedTokenB.value = found;
  }
  await averagePrice(
    !selectedTokenA.value.unit ? selectedTokenA.value.ticker : selectedTokenA.value.unit,
    !selectedTokenB.value.unit ? selectedTokenB.value.ticker : selectedTokenB.value.unit
  );
  await doEstimate(selectedTokenA.value.unit, selectedTokenB.value.unit, 1, false);
  isUpdating.value = false;
});

watch(() => selectedTokenB.value?.ticker, async (newVal) => {
  if (isUpdating.value) return;
  isUpdating.value = true;
  if (newVal === 'ADA') {
    if (lastNonADATokenA.value) {
      const found = availableTokens.value.find(t => t.ticker === lastNonADATokenA.value?.ticker);
      if (found) selectedTokenA.value = found;
    }
  } else {
    lastNonADATokenB.value = { ...selectedTokenB.value };
    if (selectedTokenA.value.ticker !== 'ADA') {
      const found = availableTokens.value.find(t => t.ticker === 'ADA');
      if (found) selectedTokenA.value = found;
    }
  }
  await averagePrice(
    !selectedTokenA.value.unit ? selectedTokenA.value.ticker : selectedTokenA.value.unit,
    !selectedTokenB.value.unit ? selectedTokenB.value.ticker : selectedTokenB.value.unit
  );
  await doEstimate(selectedTokenA.value.unit, selectedTokenB.value.unit, 1, false);
  isUpdating.value = false;
});

watch(() => limit.value, (newVal) => {
  if (swapType.value === 'limit') {
    selectedTokenB.value.quantity = (Number(newVal) * Number(selectedTokenA.value.quantity)).toString();
  }
});

// Pause periodic estimate during review
watch(() => step.value, (newStep) => {
  if (newStep === 'review' || newStep === 'status') {
    clearPeriodicEstimate();
  } else if (newStep === 'swap' || newStep === 'limit') {
    startPeriodicEstimate();
  }
});

// Reset on close
watch(() => props.value, (val) => {
  if (!val) {
    resetAll();
  }
});

// Sync token balances from resolved assets (outside computed to avoid side-effects)
watch([resolvedAssets, dexHunterTokens], () => {
  if (selectedTokenA.value?.unit === '' && selectedTokenA.value?.ticker) {
    const nativeTicker = networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network);
    if (selectedTokenA.value.ticker === nativeTicker) {
      const assetsArray = resolvedAssets.value ? Object.values(resolvedAssets.value) : [];
      const nativeAsset: any = assetsArray.find((t: any) => t.metadata?.ticker === nativeTicker);
      if (nativeAsset) selectedTokenA.value.balance = nativeAsset.quantity;
    }
  }
  if (selectedTokenB.value?.unit) {
    const found: any = resolvedAssets.value?.[selectedTokenB.value.unit];
    if (found) selectedTokenB.value.balance = found.quantity;
  }
}, { deep: false });

// ── Estimate functions ──
function doEstimate(token_in: string, token_out: string, amount_in: number, update: boolean) {
  if (!loggedWallet.value || (!token_in && !token_out)) return;
  if (!amount_in || isNaN(amount_in)) {
    if (!amount_in) total_output_without_slippage.value = 0;
    return;
  }
  estimating.value = true;
  const slippage = slippageRef.value === 'unlimited' ? '-1' : Number(slippageRef.value).toString();
  return dexHunterApi
    .estimate(amount_in, token_in, token_out, Number(slippage), blacklistedDexes.value)
    .then(res => {
      poolError.value = false;
      const data = res.data;
      price_ab.value = data.net_price_reverse;
      price_ba.value = data.net_price;
      if (update) {
        total_output_without_slippage.value = data.total_output_without_slippage;
        splits.value = data.splits;
        estimation.value = data;
        if (swapType.value !== 'limit') {
          selectedTokenB.value.quantity = filters.toCurrency(
            total_output_without_slippage.value, false, selectedTokenB.value.decimals, '', '', false, 0
          );
        }
      }
    })
    .catch(() => { poolError.value = true; })
    .finally(() => { estimating.value = false; });
}

function averagePrice(token_in: string, token_out: string) {
  if (!loggedWallet.value || (!token_in && !token_out)) return Promise.resolve();
  return dexHunterApi.getAveragePrice(token_in, token_out)
    .then(res => {
      price_ab2.value = res.price_ab;
      price_ba2.value = res.price_ba;
      limit.value = structuredClone(price_ba2.value).toString();
    })
    .catch(() => {});
}

const debouncedEstimateTokenA = debounce((val: number) => {
  if (!val || val === 0 || swapType.value === 'limit') {
    selectedTokenB.value.quantity = '0';
  } else {
    doEstimate(selectedTokenA.value.unit, selectedTokenB.value.unit, val, true);
  }
}, 300);

function performPeriodicEstimate() {
  if (document.hidden) return;
  if (!selectedTokenA.value || !selectedTokenB.value) return;
  const quantity = selectedTokenA.value.quantity || '0';
  const amount = Number(quantity.toString().replaceAll(',', ''));
  if (amount === 0) {
    doEstimate(selectedTokenA.value.unit, selectedTokenB.value.unit, 1, false);
  } else {
    doEstimate(selectedTokenA.value.unit, selectedTokenB.value.unit, amount, true);
  }
}

function startPeriodicEstimate() {
  clearPeriodicEstimate();
  intervalId = setInterval(performPeriodicEstimate, 10000);
}

function clearPeriodicEstimate() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

// ── Token A input handler ──
function onTokenAInput() {
  const cleanVal = tokenAInput.value.replace(/[^0-9.]/g, '');
  selectedTokenA.value.quantity = cleanVal || '0';
  debouncedEstimateTokenA(Number(cleanVal));
}

// ── Limit input handler ──
function onLimitInput() {
  const marketDelta = ((Number(limit.value) - price_ba2.value) / price_ba2.value) * 100;
  if (marketDelta < -100000) setLimitByPercentage(-100000);
  else if (marketDelta > 100000) setLimitByPercentage(100000);
}

function setLimitByPercentage(pct: number) {
  limit.value = (price_ba2.value * (1 + pct / 100)).toString();
}

// ── Max button ──
function setMaxTokenA() {
  if (!selectedTokenA.value) return;
  const decimals = selectedTokenA.value.decimals || 0;
  const nativeTicker = networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network);
  const balanceInSmallestUnit = Number(filters.cleanNumericValue(selectedTokenA.value.balance || 0));

  if (selectedTokenA.value.ticker === nativeTicker) {
    const reservedAmount = 3_000_000;
    const maxBalanceLovelace = Math.max(0, balanceInSmallestUnit - reservedAmount);
    const maxBalance = filters.convertFromSmallestUnit(maxBalanceLovelace, decimals).toString();
    selectedTokenA.value.quantity = maxBalance;
    tokenAInput.value = maxBalance;
    debouncedEstimateTokenA(Number(maxBalance));
  } else {
    const maxBalance = filters.convertFromSmallestUnit(balanceInSmallestUnit, decimals).toString();
    selectedTokenA.value.quantity = maxBalance;
    tokenAInput.value = maxBalance;
    debouncedEstimateTokenA(Number(maxBalance));
  }
}

// ── Switch pair ──
function switchPair() {
  isUpdating.value = true;
  const tempA = { ...selectedTokenA.value };
  const tempB = { ...selectedTokenB.value };
  selectedTokenA.value = tempB;
  selectedTokenB.value = tempA;
  tokenAInput.value = '';
  selectedTokenA.value.quantity = '0';
  selectedTokenB.value.quantity = '0';
  if (tempB.ticker !== 'ADA') lastNonADATokenA.value = tempB;
  if (tempA.ticker !== 'ADA') lastNonADATokenB.value = tempA;
  setTimeout(() => { isUpdating.value = false; }, 100);
}

// ── Token select ──
function openTokenSelect(side: 'A' | 'B') {
  selectingTokenSide.value = side;
  tokenSearchQuery.value = '';
  previousStep.value = step.value as Step;
  step.value = 'token-select';
}

function onTokenSelected(token: any) {
  isUpdating.value = true;
  if (selectingTokenSide.value === 'A') {
    if (selectedTokenB.value && token.unit === selectedTokenB.value.unit) {
      const oldB = { ...selectedTokenB.value };
      selectedTokenB.value = { ...selectedTokenA.value };
      selectedTokenA.value = { ...oldB, quantity: '0' };
    } else {
      selectedTokenA.value = { ...token, quantity: '0' };
    }
    tokenAInput.value = '';
  } else {
    if (selectedTokenA.value && token.unit === selectedTokenA.value.unit) {
      const oldA = { ...selectedTokenA.value };
      selectedTokenA.value = { ...selectedTokenB.value, quantity: '0' };
      selectedTokenB.value = { ...oldA };
      tokenAInput.value = '';
    } else {
      selectedTokenB.value = { ...token, quantity: '0' };
    }
  }
  step.value = previousStep.value;
  setTimeout(() => { isUpdating.value = false; }, 100);
}

// ── Settings ──
function openSettings() {
  previousStep.value = step.value as Step;
  step.value = 'settings';
}

function onCustomSlippage() {
  const val = customSlippage.value.replace(/[^0-9.]/g, '');
  customSlippage.value = val;
  if (val && !isNaN(Number(val))) {
    slippageRef.value = val;
  }
}

function toggleDex(dex: string) {
  const idx = blacklistedDexes.value.indexOf(dex);
  if (idx >= 0) blacklistedDexes.value.splice(idx, 1);
  else blacklistedDexes.value.push(dex);
}

function toggleAllDexes() {
  if (allDexesEnabled.value) {
    blacklistedDexes.value = [...dexList];
  } else {
    blacklistedDexes.value = [];
  }
}

// ── Review & Execute ──
function goToReview() {
  step.value = 'review';
  passwordError.value = '';
  spendingPassword.value = '';
}

function refreshEstimate() {
  performPeriodicEstimate();
}

async function executeSwap() {
  submitting.value = true;
  passwordError.value = '';
  statusError.value = '';

  try {
    // 1. Verify password
    const pwResult = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.VERIFY_SPENDING_PASSWORD,
      data: { password: spendingPassword.value },
    }) as BackgroundResponse<VerifyPasswordResponse>;

    if (!pwResult.data.success) {
      passwordError.value = t('miniGero.wrongPassword');
      return;
    }

    // 2. Register address
    await DexHunterStore.registerAddress(loggedWallet.value?.baseAddress);

    // 3. Build swap tx
    const amount = Number(selectedTokenA.value.quantity.toString().replaceAll(',', ''));
    let swapRes: any;

    if (swapType.value === 'swap') {
      const slippage = slippageRef.value === 'unlimited' ? -1 : Number(slippageRef.value);
      swapRes = await dexHunterApi.swap(
        amount, loggedWallet.value?.baseAddress,
        selectedTokenA.value.unit, selectedTokenB.value.unit, slippage
      );
    } else {
      const toSplit = limitType.value === 'split';
      const multiples = toSplit ? limitSplit.value : 1;
      swapRes = await dexHunterApi.swapLimitBuild(
        amount, loggedWallet.value?.baseAddress,
        selectedTokenA.value.unit, selectedTokenB.value.unit,
        'GeroLabs', multiples, toSplit, Number(limit.value)
      );
    }

    swapTxCbor.value = swapRes.cbor;

    // 4. Sign (partial for DexHunter)
    const signResult = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_TX,
      data: {
        txCbor: swapTxCbor.value,
        partialSign: true,
        password: spendingPassword.value,
        accountIndex: 0,
        utxos: utxos.value,
        addresses: keys.value,
        mergeWitnesses: false,
      },
    }) as { data: { witnesses?: string; error?: string } };

    if (signResult.data.error) throw new Error(signResult.data.error);

    // 5. DexHunter co-sign
    const signRes = await dexHunterApi.swapSign(signResult.data.witnesses!, swapTxCbor.value);

    // 6. Submit
    await submitSwapTx(signRes.cbor);
  } catch (e: any) {
    console.error('[Swap] Error:', e);
    console.error('[Swap] API error:', e?.response?.status, e?.response?.data);
    passwordError.value = e?.message || t('miniGero.swapFailedGeneric');
  } finally {
    submitting.value = false;
    spendingPassword.value = '';
  }
}

// ── PRF (PassKey) swap signing ──
async function onPassKeySuccess(pkBytes: Uint8Array) {
  submitting.value = true;
  passwordError.value = '';

  try {
    await DexHunterStore.registerAddress(loggedWallet.value?.baseAddress);

    const amount = Number(selectedTokenA.value.quantity.toString().replaceAll(',', ''));
    let swapRes: any;

    if (swapType.value === 'swap') {
      const slippage = slippageRef.value === 'unlimited' ? -1 : Number(slippageRef.value);
      swapRes = await dexHunterApi.swap(
        amount, loggedWallet.value?.baseAddress,
        selectedTokenA.value.unit, selectedTokenB.value.unit, slippage
      );
    } else {
      const toSplit = limitType.value === 'split';
      const multiples = toSplit ? limitSplit.value : 1;
      swapRes = await dexHunterApi.swapLimitBuild(
        amount, loggedWallet.value?.baseAddress,
        selectedTokenA.value.unit, selectedTokenB.value.unit,
        'GeroLabs', multiples, toSplit, Number(limit.value)
      );
    }

    swapTxCbor.value = swapRes.cbor;

    const signResult = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_TX,
      data: {
        txCbor: swapTxCbor.value,
        partialSign: true,
        accountIndex: 0,
        utxos: utxos.value,
        addresses: keys.value,
        mergeWitnesses: false,
        privateKeyBytes: Array.from(pkBytes),
      },
    }) as { data: { witnesses?: string; error?: string } };

    if (signResult.data.error) throw new Error(signResult.data.error);

    const signRes = await dexHunterApi.swapSign(signResult.data.witnesses!, swapTxCbor.value);
    await submitSwapTx(signRes.cbor);
  } catch (e: any) {
    console.error('[Swap] PRF sign error:', e);
    passwordError.value = e?.message || t('miniGero.swapFailedGeneric');
  } finally {
    submitting.value = false;
  }
}

function onPassKeyError(error: Error) {
  console.error('[Swap] PassKey error:', error);
  passwordError.value = error.message || t('miniGero.passKeyAuthFailed');
}

// ── Ledger signing ──
async function signLedger() {
  submitting.value = true;
  passwordError.value = '';

  try {
    await DexHunterStore.registerAddress(loggedWallet.value?.baseAddress);

    const amount = Number(selectedTokenA.value.quantity.toString().replaceAll(',', ''));
    let swapRes: any;

    if (swapType.value === 'swap') {
      const slippage = slippageRef.value === 'unlimited' ? -1 : Number(slippageRef.value);
      swapRes = await dexHunterApi.swap(
        amount, loggedWallet.value?.baseAddress,
        selectedTokenA.value.unit, selectedTokenB.value.unit, slippage
      );
    } else {
      const toSplit = limitType.value === 'split';
      const multiples = toSplit ? limitSplit.value : 1;
      swapRes = await dexHunterApi.swapLimitBuild(
        amount, loggedWallet.value?.baseAddress,
        selectedTokenA.value.unit, selectedTokenB.value.unit,
        'GeroLabs', multiples, toSplit, Number(limit.value)
      );
    }

    swapTxCbor.value = swapRes.cbor;

    // Deserialize for Ledger
    const txSerialized = Serialization.Transaction.fromCbor(swapTxCbor.value as any);
    const txCore = txSerialized.toCore();

    const signatures: Cardano.Signatures = await ledgerUtils.txToLedger(
      txCore,
      keys.value,
      utxos.value,
      !isBT.value,
      networks.resolveNetwork(loggedWallet.value.chain, loggedWallet.value.network),
    );
    const transactionWitnessSet = Serialization.TransactionWitnessSet.fromCore({ signatures });
    const witnessHex = transactionWitnessSet.toCbor();

    // DexHunter co-sign with Ledger witnesses
    const signRes = await dexHunterApi.swapSign(witnessHex as string, swapTxCbor.value);
    await submitSwapTx(signRes.cbor);
  } catch (e: any) {
    ledgerUtils.ledgerErrorHandling(e);
    passwordError.value = e?.message || t('miniGero.ledgerSignFailed');
  } finally {
    submitting.value = false;
  }
}

// ── Trezor signing ──
async function signTrezor() {
  submitting.value = true;
  passwordError.value = '';

  try {
    await DexHunterStore.registerAddress(loggedWallet.value?.baseAddress);

    const amount = Number(selectedTokenA.value.quantity.toString().replaceAll(',', ''));
    let swapRes: any;

    if (swapType.value === 'swap') {
      const slippage = slippageRef.value === 'unlimited' ? -1 : Number(slippageRef.value);
      swapRes = await dexHunterApi.swap(
        amount, loggedWallet.value?.baseAddress,
        selectedTokenA.value.unit, selectedTokenB.value.unit, slippage
      );
    } else {
      const toSplit = limitType.value === 'split';
      const multiples = toSplit ? limitSplit.value : 1;
      swapRes = await dexHunterApi.swapLimitBuild(
        amount, loggedWallet.value?.baseAddress,
        selectedTokenA.value.unit, selectedTokenB.value.unit,
        'GeroLabs', multiples, toSplit, Number(limit.value)
      );
    }

    swapTxCbor.value = swapRes.cbor;

    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.TREZOR,
      data: { method: 'signTx', txCbor: swapTxCbor.value },
    }) as BackgroundResponse<SignTxResponse>;

    if (!response.data.success) throw new Error(response.data.error || t('miniGero.trezorSignFailed'));

    const signaturesArray = response.data.signatures as unknown as Array<[string, string]>;
    const signatures: Cardano.Signatures = new Map(signaturesArray);
    const transactionWitnessSet = Serialization.TransactionWitnessSet.fromCore({ signatures });
    const witnessHex = transactionWitnessSet.toCbor();

    const signRes = await dexHunterApi.swapSign(witnessHex as string, swapTxCbor.value);
    await submitSwapTx(signRes.cbor);
  } catch (e: any) {
    if (e?.message?.includes('Failure_ActionCancelled') || e?.message?.includes('cancelled')) {
      passwordError.value = t('miniGero.trezorCancelled');
    } else {
      passwordError.value = e?.message || t('miniGero.trezorSignFailed');
    }
  } finally {
    submitting.value = false;
  }
}

// ── Keystone signing ──
async function signKeystone() {
  submitting.value = true;
  passwordError.value = '';

  try {
    await DexHunterStore.registerAddress(loggedWallet.value?.baseAddress);

    const amount = Number(selectedTokenA.value.quantity.toString().replaceAll(',', ''));
    let swapRes: any;

    if (swapType.value === 'swap') {
      const slippage = slippageRef.value === 'unlimited' ? -1 : Number(slippageRef.value);
      swapRes = await dexHunterApi.swap(
        amount, loggedWallet.value?.baseAddress,
        selectedTokenA.value.unit, selectedTokenB.value.unit, slippage
      );
    } else {
      const toSplit = limitType.value === 'split';
      const multiples = toSplit ? limitSplit.value : 1;
      swapRes = await dexHunterApi.swapLimitBuild(
        amount, loggedWallet.value?.baseAddress,
        selectedTokenA.value.unit, selectedTokenB.value.unit,
        'GeroLabs', multiples, toSplit, Number(limit.value)
      );
    }

    swapTxCbor.value = swapRes.cbor;

    const txSerialized = Serialization.Transaction.fromCbor(swapTxCbor.value as any);
    const signRequestResponse: KeystoneSignRequestResponse = createKeystoneSignRequest(
      txSerialized, loggedWallet.value, utxos.value, keys.value
    );
    keystoneType.value = signRequestResponse.ur.type;
    keystoneCbor.value = signRequestResponse.ur.cbor.toString('hex');
    showKeystoneDialog.value = true;
  } catch (e: any) {
    console.error('[Swap] Keystone sign request error:', e);
    passwordError.value = e?.message || t('miniGero.keystoneRequestFailed');
    submitting.value = false;
  }
}

async function onKeystoneScan(ur: UR) {
  try {
    const signature = parseSignature(ur);
    if (!signature?.witnessSet || typeof signature.witnessSet !== 'string') {
      throw new Error(t('miniGero.keystoneInvalidSig'));
    }
    showKeystoneDialog.value = false;
    submitting.value = true;

    const signRes = await dexHunterApi.swapSign(signature.witnessSet, swapTxCbor.value);
    await submitSwapTx(signRes.cbor);
  } catch (e: any) {
    console.error('[Swap] Keystone QR error:', e);
    passwordError.value = e?.message || t('miniGero.keystoneScanError');
    showKeystoneDialog.value = false;
  } finally {
    submitting.value = false;
  }
}

function onKeystoneError(error: string) {
  console.error('[Swap] Keystone scanner error:', error);
  passwordError.value = error || t('miniGero.keystoneScannerError');
  showKeystoneDialog.value = false;
}

// ── Submit swap TX ──
async function submitSwapTx(cborHex: string) {
  const submitResult = (await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.SUBMIT_TX,
    data: {
      txCbor: cborHex,
      witnessHex: null,
      utxos: utxos.value,
    },
  })) as { data: { txId?: string; error?: string } };

  if (submitResult.data.error) throw new Error(submitResult.data.error);

  txId.value = submitResult.data.txId || '';
  txSuccess.value = true;
  step.value = 'status';
  snackbar.fireSuccess(t('miniGero.swapSubmitted'));
  debugLog('[Swap] Transaction submitted:', txId.value);
}

// ── Helpers ──
function getUsdValue(token: any): string {
  if (!token || !token.quantity) return '0.00';
  const multiplier = token.ticker === 'ADA' ? 1 : price_ba.value;
  const quantity = (token.quantity || '0').toString().replaceAll(',', '');
  const lastPrice = priceStore.adaUsd?.lastPrice || price.value?.lastPrice || 0;
  return (Number(quantity) * multiplier * lastPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatTokenBalance(token: any): string {
  if (!token) return '0';
  const bal = Number(token.balance || 0);
  const dec = token.decimals || 0;
  const amount = filters.convertFromSmallestUnit(bal, dec);
  if (amount === 0) return '0';
  return amount.toLocaleString('en-US', { maximumFractionDigits: Math.min(dec, 6) });
}

function truncateStr(s: string): string {
  if (!s) return '';
  if (s.length <= 20) return s;
  return s.slice(0, 12) + '...' + s.slice(-8);
}

function copyTxId() {
  if (txId.value) navigator.clipboard.writeText(txId.value).catch(() => {});
}

function getTokenImg(token: any): string {
  return applyTokenImageOverride(token.ticker || token.name, token.img || '');
}

function onTokenImgError(event: Event, token: any) {
  const img = event.target as HTMLImageElement;
  if (token.fallback_img) img.src = token.fallback_img;
}

function onDone() {
  if (txSuccess.value) {
    onSheetInput(false);
  } else {
    step.value = 'swap';
    statusError.value = '';
    swapTxCbor.value = '';
  }
}

function onSheetInput(val: boolean) {
  if (!val) resetAll();
  else startPeriodicEstimate();
  emit('input', val);
}

function resetAll() {
  step.value = 'swap';
  swapType.value = 'swap';
  tokenAInput.value = '';
  selectedTokenA.value = {
    name: 'Cardano', ticker: 'ADA', img: cardanoSvg,
    fallback_img: 'https://storage.googleapis.com/dexhunter-images/public/unverified.svg',
    balance: 0, quantity: '0', decimals: 6, unit: '', verified: true,
  };
  selectedTokenB.value = {
    name: 'GERO', ticker: 'GERO',
    img: 'https://storage.googleapis.com/dexhunter-images/tokens/10a49b996e2402269af553a8a96fb8eb90d79e9eca79e2b4223057b64745524f.webp',
    fallback_img: 'https://storage.googleapis.com/dexhunter-images/public/unverified.svg',
    balance: 0, quantity: '0', decimals: 6,
    unit: '10a49b996e2402269af553a8a96fb8eb90d79e9eca79e2b4223057b64745524f', verified: true,
  };
  spendingPassword.value = '';
  passwordError.value = '';
  showPassword.value = false;
  submitting.value = false;
  txSuccess.value = false;
  txId.value = '';
  statusError.value = '';
  loading.value = false;
  poolError.value = false;
  limit.value = '0.0000000';
  limitType.value = 'one';
  limitSplit.value = 1;
  blacklistedDexes.value = [];
  swapTxCbor.value = '';
  clearPeriodicEstimate();
}

// ── Lifecycle ──
onMounted(async () => {
  await averagePrice(
    !selectedTokenA.value.unit ? selectedTokenA.value.ticker : selectedTokenA.value.unit,
    !selectedTokenB.value.unit ? selectedTokenB.value.ticker : selectedTokenB.value.unit
  );
  startPeriodicEstimate();
});

onBeforeUnmount(() => {
  clearPeriodicEstimate();
  debouncedEstimateTokenA.cancel();
});
</script>

<style scoped>
.swap-sheet {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.glass-card {
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
}

.maintenance-overlay,
.success-overlay {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
  text-align: center;
}

.tx-id-box {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
}

/* Swap type toggle */
.swap-type-toggle {
  background: rgba(255, 255, 255, 0.04) !important;
  border-radius: 8px !important;
}

.active-toggle {
  background: var(--chain-primary) !important;
  color: black !important;
}

.inactive-toggle {
  background: transparent !important;
  color: #888 !important;
}

/* Token select button */
.token-select-btn {
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.06);
  transition: background 0.15s;
}

.token-select-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

/* Amount input */
.amount-input {
  background: transparent;
  border: none;
  outline: none;
  color: white;
  font-size: 20px;
  font-weight: 700;
  text-align: right;
  width: 100%;
  max-width: 160px;
  font-family: inherit;
}

.amount-input::placeholder {
  color: rgba(255, 255, 255, 0.2);
}

.amount-display {
  font-size: 20px;
  font-weight: 700;
  text-align: right;
}

/* Flip button */
.flip-btn {
  background: rgba(255, 255, 255, 0.06) !important;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

/* Slippage button */
.slippage-btn {
  background: rgba(255, 255, 255, 0.04) !important;
  border-radius: 6px !important;
}

/* Token list */
.token-select-overlay {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.token-list {
  flex: 1;
  overflow-y: auto;
  margin: 0 -4px;
}

.token-list-item {
  display: flex;
  align-items: center;
  padding: 10px 8px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s;
}

.token-list-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.token-item-info {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}

/* DEX grid */
.dex-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.dex-chip {
  padding: 4px 10px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  cursor: pointer;
  opacity: 0.4;
  transition: all 0.15s;
}

.dex-chip.active {
  opacity: 1;
  border-color: var(--chain-primary);
  background: color-mix(in srgb, var(--chain-primary) 8%, transparent);
}

/* Review */
.review-step {
  display: flex;
  flex-direction: column;
}

.review-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
}

.review-row + .review-row {
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}

.detail-label {
  color: #888;
  font-size: 13px;
}

.detail-value {
  color: #bbb;
  font-size: 13px;
  text-align: right;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Hardware wallet notice */
.hw-notice {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 0;
}

/* Settings */
.settings-overlay {
  display: flex;
  flex-direction: column;
}

/* Metronome animation (reuse from dashboard) */
.v-avatar--metronome {
  animation: metronome 1.5s ease-in-out infinite;
}

@keyframes metronome {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}

/* Mini input styling */
.mini-input >>> .v-input__slot {
  background: rgba(255, 255, 255, 0.04) !important;
  border-color: rgba(255, 255, 255, 0.08) !important;
}
</style>
