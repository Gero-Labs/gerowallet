<template>
  <div class="quick-swap">
    <!-- Buy/Sell toggle + slippage -->
    <div class="d-flex align-center mb-3">
      <v-btn-toggle v-model="mode" mandatory dense class="mode-toggle">
        <v-btn value="buy" x-small class="mode-btn buy-btn" :class="{ active: mode === 'buy' }">
          {{ $t('market.buy') }}
        </v-btn>
        <v-btn value="sell" x-small class="mode-btn sell-btn" :class="{ active: mode === 'sell' }">
          {{ $t('market.sell') }}
        </v-btn>
      </v-btn-toggle>
      <v-spacer />
      <v-menu offset-y :close-on-content-click="true" nudge-bottom="4">
        <template v-slot:activator="{ on, attrs }">
          <v-btn x-small text v-bind="attrs" v-on="on" class="slippage-btn">
            <v-icon x-small class="mr-1">mdi-cog</v-icon>
            {{ slippage }}%
          </v-btn>
        </template>
        <v-list dense class="slippage-menu">
          <v-list-item v-for="s in slippageOptions" :key="s" @click="slippage = s" :class="{ 'v-list-item--active': slippage === s }">
            <v-list-item-title style="font-size: 12px">{{ s }}%</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>
    </div>

    <!-- Amount slider -->
    <div class="mb-1">
      <div class="d-flex align-center justify-space-between mb-1">
        <span class="text-caption text--secondary">{{ $t('market.amount') }}</span>
        <span class="text-caption text--secondary">
          {{ $t('market.balance') }}: {{ formattedBalance }} {{ mode === 'buy' ? currencyTicker : tokenTicker }}
        </span>
      </div>
      <v-slider
        v-model="sliderPercent"
        min="0"
        max="100"
        step="1"
        hide-details
        :color="mode === 'buy' ? '#47CD89' : '#F97066'"
        :track-color="'rgba(255,255,255,0.1)'"
        class="amount-slider"
        @input="onSliderChange"
      />
      <div class="d-flex align-center mt-1" style="gap: 4px">
        <input
          v-model="amountInput"
          type="text"
          inputmode="decimal"
          class="amount-input flex-grow-1"
          :placeholder="$t('market.enterAmount')"
          @input="onAmountInput"
        />
        <span class="text-caption" style="opacity: 0.5">{{ mode === 'buy' ? currencyTicker : tokenTicker }}</span>
        <div class="d-flex" style="gap: 2px">
          <v-btn x-small text class="percent-btn" @click="setPercent(25)">25%</v-btn>
          <v-btn x-small text class="percent-btn" @click="setPercent(50)">50%</v-btn>
          <v-btn x-small text class="percent-btn" @click="setPercent(100)">MAX</v-btn>
        </div>
      </div>
    </div>

    <!-- Quote -->
    <div class="quote-section my-2 pa-2">
      <div v-if="estimating" class="text-caption text--secondary">
        <v-progress-circular indeterminate size="12" width="1" class="mr-1" />
        {{ $t('market.estimating') }}
      </div>
      <div v-else-if="estimatedOutput > 0" class="text-caption">
        <span class="text--secondary">{{ $t('market.youReceive') }} ~</span>
        <span class="font-weight-medium">{{ formatOutput(estimatedOutput) }} {{ mode === 'buy' ? tokenTicker : currencyTicker }}</span>
      </div>
      <div v-else class="text-caption text--secondary" style="opacity: 0.4">
        {{ $t('market.enterAmount') }}
      </div>
    </div>

    <!-- Swap button -->
    <v-btn
      block
      :color="mode === 'buy' ? '#47CD89' : '#F97066'"
      :disabled="!canSwap"
      :loading="swapping"
      class="swap-btn"
      @click="executeSwap"
    >
      <span style="color: #000; font-size: 13px; font-weight: 600">
        {{ swapButtonText }}
      </span>
    </v-btn>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import { useNativeCurrency } from '@/modules/market/composables/useNativeCurrency';
import dexHunterApi from '@/api/dexhunter-api';
import DexHunterStore from '@/stores/dexHunterStore';
import { Messaging } from '@/chrome/messaging';
import { METHOD } from '@/chrome/config';
import { MessageTypes } from '@/models/MessageTypes';
import snackbar from '@/plugins/snackbar';
import debounce from 'lodash/debounce';

const props = defineProps<{
  tokenUnit: string;
  tokenTicker: string;
  tokenDecimals: number;
}>();

const emit = defineEmits<{
  (e: 'swapComplete'): void;
}>();

const { t } = useTranslation();
const { currencyTicker } = useNativeCurrency();

const mode = ref<'buy' | 'sell'>('buy');
const slippage = ref(3);
const slippageOptions = [1, 2, 3, 5];
const sliderPercent = ref(0);
const amountInput = ref('');
const estimatedOutput = ref(0);
const estimating = ref(false);
const swapping = ref(false);

// Balances
const adaBalance = computed(() => {
  const tokens = walletStore.tokens;
  if (!tokens) return 0;
  const ada = Object.values(tokens).find((t: any) => t.metadata?.ticker === 'ADA' || t.unit === '');
  return ada ? Number((ada as any).quantity || 0) : 0;
});

const adaBalanceMain = computed(() => adaBalance.value / 1e6);

const tokenBalance = computed(() => {
  const tokens = walletStore.tokens;
  if (!tokens) return 0;
  const tok = Object.values(tokens).find((t: any) => t.unit === props.tokenUnit);
  return tok ? Number((tok as any).quantity || 0) : 0;
});

const tokenBalanceMain = computed(() => tokenBalance.value / Math.pow(10, props.tokenDecimals));

const currentBalance = computed(() => mode.value === 'buy' ? adaBalanceMain.value : tokenBalanceMain.value);

const formattedBalance = computed(() => {
  const bal = currentBalance.value;
  if (bal >= 1000) return bal.toFixed(2);
  if (bal >= 1) return bal.toFixed(4);
  return bal.toFixed(6);
});

const amount = computed(() => {
  const val = parseFloat(amountInput.value.replace(/,/g, ''));
  return isNaN(val) ? 0 : val;
});

const canSwap = computed(() => {
  return amount.value > 0 && amount.value <= currentBalance.value && estimatedOutput.value > 0 && !estimating.value;
});

const swapButtonText = computed(() => {
  if (amount.value <= 0) return t('market.enterAmount');
  if (amount.value > currentBalance.value) return t('market.insufficientBalance');
  return `${mode.value === 'buy' ? t('market.buy') : t('market.sell')} ${props.tokenTicker}`;
});

function setPercent(pct: number) {
  sliderPercent.value = pct;
  const bal = currentBalance.value;
  // Reserve 2 ADA for fees when buying
  const effective = mode.value === 'buy' ? Math.max(0, bal - 2) : bal;
  const amt = effective * (pct / 100);
  amountInput.value = amt > 0 ? amt.toFixed(6).replace(/\.?0+$/, '') : '';
  debouncedEstimate();
}

function onSliderChange() {
  setPercent(sliderPercent.value);
}

function onAmountInput() {
  const bal = currentBalance.value;
  if (bal > 0 && amount.value > 0) {
    sliderPercent.value = Math.min(100, Math.round((amount.value / bal) * 100));
  } else {
    sliderPercent.value = 0;
  }
  debouncedEstimate();
}

async function fetchEstimate() {
  const amt = amount.value;
  if (amt <= 0) {
    estimatedOutput.value = 0;
    return;
  }

  estimating.value = true;
  try {
    // DexHunter estimate API expects main units (ADA, not lovelace) — matches SwapWidget
    const tokenIn = mode.value === 'buy' ? 'lovelace' : props.tokenUnit;
    const tokenOut = mode.value === 'buy' ? props.tokenUnit : 'lovelace';

    const res = await dexHunterApi.estimate(
      amt,
      tokenIn,
      tokenOut,
      slippage.value,
      [],
    );

    const data = res?.data;
    if (data && data.total_output_without_slippage != null) {
      // API returns output in main units — no conversion needed
      estimatedOutput.value = data.total_output_without_slippage;
    } else {
      estimatedOutput.value = 0;
    }
  } catch (err) {
    console.warn('QuickSwap: estimation failed', err);
    estimatedOutput.value = 0;
  } finally {
    estimating.value = false;
  }
}

const debouncedEstimate = debounce(fetchEstimate, 500);

async function executeSwap() {
  const amt = amount.value;
  if (amt <= 0 || swapping.value) return;

  swapping.value = true;
  try {
    // DEX Hunter API expects amounts in main units (ADA, not lovelace)
    const tokenIn = mode.value === 'buy' ? 'lovelace' : props.tokenUnit;
    const tokenOut = mode.value === 'buy' ? props.tokenUnit : 'lovelace';

    const loggedWallet = walletStore.loggedWallet;
    if (!loggedWallet?.baseAddress) throw new Error('No wallet connected');

    // Register address with DexHunter
    await DexHunterStore.registerAddress(loggedWallet.baseAddress);

    // Build swap transaction — amount in main units (same as SwapWidget)
    const swapRes = await dexHunterApi.swap(
      amt,
      loggedWallet.baseAddress,
      tokenIn,
      tokenOut,
      slippage.value,
    );

    if (!swapRes?.cbor) throw new Error('Failed to build swap transaction');

    // Sign transaction
    const signaturesRes: any = await Messaging.sendToBackgroundFromOptions({
      method: METHOD.signTx,
      data: {
        tx: swapRes.cbor,
        partialSign: true,
        origin: 'https://gerowallet.io/',
        mergeWitnesses: false,
      },
    });

    if (signaturesRes.error) {
      throw new Error(signaturesRes.error.info || 'Signing failed');
    }

    // Post signatures to DexHunter
    const signRes: any = await dexHunterApi.swapSign(signaturesRes.data, swapRes.cbor);

    // Submit transaction
    const submitResult = (await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SUBMIT_TX,
      data: {
        txCbor: signRes.cbor,
        witnessHex: null,
        utxos: walletStore.utxos,
      },
    })) as { data: { txId?: string; error?: string } };

    if (submitResult.data.error) {
      throw new Error(submitResult.data.error);
    }

    snackbar.fireSuccess(t('market.swapSuccess'));
    amountInput.value = '';
    sliderPercent.value = 0;
    estimatedOutput.value = 0;
    emit('swapComplete');
  } catch (err: any) {
    snackbar.setError(err?.message || t('market.swapFailed'));
  } finally {
    swapping.value = false;
  }
}

function formatOutput(value: number): string {
  if (value >= 1000) return value.toFixed(2);
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

// Reset when mode changes
watch(mode, () => {
  amountInput.value = '';
  sliderPercent.value = 0;
  estimatedOutput.value = 0;
});

// Reset when token changes
watch(() => props.tokenUnit, () => {
  amountInput.value = '';
  sliderPercent.value = 0;
  estimatedOutput.value = 0;
  mode.value = 'buy';
});
</script>

<style scoped>
.quick-swap {
  width: 100%;
}

.mode-toggle {
  border-radius: 8px !important;
  overflow: hidden;
}

.mode-btn {
  min-width: 60px !important;
  font-weight: 600 !important;
  letter-spacing: 0 !important;
  text-transform: none !important;
}

.buy-btn.active {
  background: rgba(71, 205, 137, 0.2) !important;
  color: #47CD89 !important;
}

.sell-btn.active {
  background: rgba(249, 112, 102, 0.2) !important;
  color: #F97066 !important;
}

.slippage-btn {
  font-size: 11px !important;
  letter-spacing: 0 !important;
  text-transform: none !important;
  opacity: 0.6;
}

.slippage-menu {
  background: #1a1e2e !important;
  min-width: 60px;
}

.amount-slider {
  margin: 0 !important;
  padding: 0 !important;
}

.amount-input {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 14px;
  color: white;
  outline: none;
  width: 100%;
}

.amount-input:focus {
  border-color: rgba(255, 255, 255, 0.25);
}

.amount-input::placeholder {
  color: rgba(255, 255, 255, 0.25);
}

.percent-btn {
  min-width: 32px !important;
  font-size: 10px !important;
  letter-spacing: 0 !important;
  padding: 0 4px !important;
  opacity: 0.5;
}

.percent-btn:hover {
  opacity: 1;
}

.quote-section {
  background: rgba(255, 255, 255, 0.03);
  border-radius: 6px;
  min-height: 32px;
  display: flex;
  align-items: center;
}

.swap-btn {
  border-radius: 8px !important;
  text-transform: none !important;
  letter-spacing: 0 !important;
}
</style>
