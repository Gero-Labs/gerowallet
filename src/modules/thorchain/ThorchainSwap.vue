<template>
  <v-container fluid class="pa-3" style="max-width: 640px; margin: auto;">
    <!-- Page Header -->
    <div class="d-flex align-center mb-4" style="gap: 12px;">
      <div class="page-icon-wrapper">
        <v-icon color="var(--g-accent)" size="22">mdi-swap-horizontal-bold</v-icon>
      </div>
      <div>
        <div class="text-h6 font-weight-bold">{{ $t('thorchain.title') }}</div>
        <div class="text-caption text--secondary">{{ $t('thorchain.subtitle') }}</div>
      </div>
    </div>

    <!-- Swap Card -->
    <v-card outlined class="liquid-glass swap-card mb-3" style="border-radius: var(--g-r-sheet) !important;">
      <div class="pa-4">

        <!-- FROM section -->
        <div class="swap-section mb-1">
          <div class="d-flex justify-space-between align-center mb-2">
            <span class="t-label">{{ $t('thorchain.from') }}</span>
          </div>
          <div class="swap-input-row d-flex align-center" style="gap: 8px;">
            <v-select
              v-model="fromAsset"
              :items="assetOptions"
              item-text="label"
              item-value="value"
              outlined
              dense
              hide-details
              class="asset-select"
              attach
            >
              <template #selection="{ item }">
                <div class="d-flex align-center" style="gap: 6px;">
                  <div class="asset-icon" :style="{ background: item.color + '20', color: item.color }">
                    <v-icon x-small :color="item.color">{{ item.icon }}</v-icon>
                  </div>
                  <span class="font-weight-medium">{{ item.ticker }}</span>
                </div>
              </template>
              <template #item="{ item }">
                <div class="d-flex align-center pa-1" style="gap: 8px; width: 100%;">
                  <div class="asset-icon" :style="{ background: item.color + '20', color: item.color }">
                    <v-icon x-small :color="item.color">{{ item.icon }}</v-icon>
                  </div>
                  <div>
                    <div class="font-weight-medium" style="font-size: 13px;">{{ item.ticker }}</div>
                    <div class="text-caption text--secondary">{{ item.name }}</div>
                  </div>
                </div>
              </template>
            </v-select>
            <v-text-field
              v-model="fromAmount"
              outlined
              dense
              type="number"
              :min="0"
              :step="0.0001"
              placeholder="0.00"
              hide-details
              class="flex-grow-1 amount-input"
              @input="debouncedGetQuote"
            />
          </div>
        </div>

        <!-- Swap direction button -->
        <div class="swap-arrow-wrapper">
          <v-btn icon small class="swap-arrow-btn" @click="swapAssets">
            <v-icon color="var(--g-accent)" size="18">mdi-swap-vertical</v-icon>
          </v-btn>
        </div>

        <!-- TO section -->
        <div class="swap-section mb-4">
          <div class="d-flex justify-space-between align-center mb-2">
            <span class="t-label">{{ $t('thorchain.to') }}</span>
            <span v-if="quote && !quoteLoading" class="text-caption success--text font-weight-medium">
              ≈ {{ expectedOut }} {{ toAsset.split('.')[1] }}
            </span>
          </div>
          <div class="swap-input-row d-flex align-center" style="gap: 8px;">
            <v-select
              v-model="toAsset"
              :items="assetOptions"
              item-text="label"
              item-value="value"
              outlined
              dense
              hide-details
              class="asset-select"
              attach
            >
              <template #selection="{ item }">
                <div class="d-flex align-center" style="gap: 6px;">
                  <div class="asset-icon" :style="{ background: item.color + '20', color: item.color }">
                    <v-icon x-small :color="item.color">{{ item.icon }}</v-icon>
                  </div>
                  <span class="font-weight-medium">{{ item.ticker }}</span>
                </div>
              </template>
              <template #item="{ item }">
                <div class="d-flex align-center pa-1" style="gap: 8px; width: 100%;">
                  <div class="asset-icon" :style="{ background: item.color + '20', color: item.color }">
                    <v-icon x-small :color="item.color">{{ item.icon }}</v-icon>
                  </div>
                  <div>
                    <div class="font-weight-medium" style="font-size: 13px;">{{ item.ticker }}</div>
                    <div class="text-caption text--secondary">{{ item.name }}</div>
                  </div>
                </div>
              </template>
            </v-select>
            <v-text-field
              :value="expectedOut"
              readonly
              outlined
              dense
              placeholder="0.00"
              hide-details
              :loading="quoteLoading"
              class="flex-grow-1 amount-input output-field"
            />
          </div>
        </div>

        <!-- Destination address -->
        <div class="mb-4">
          <div class="t-label mb-2">{{ $t('thorchain.destinationAddress') }}</div>
          <v-text-field
            v-model="destinationAddress"
            outlined
            dense
            :placeholder="$t('thorchain.destinationPlaceholder')"
            hide-details="auto"
            :rules="[addressRule]"
          >
            <template #prepend-inner>
              <v-icon small color="grey" class="mr-1">mdi-wallet-outline</v-icon>
            </template>
          </v-text-field>
        </div>

        <!-- Quote details -->
        <transition name="fade">
          <div v-if="quote && !quoteLoading" class="quote-details pa-3 rounded-lg mb-4">
            <div class="quote-row d-flex justify-space-between align-center py-1">
              <span class="text-caption text--secondary">{{ $t('thorchain.slippage') }}</span>
              <v-chip
                x-small
                :color="quote.fees.slippage_bps > 100 ? 'warning' : 'success'"
                outlined
                style="height: 18px; font-size: 11px;"
              >
                {{ (quote.fees.slippage_bps / 100).toFixed(2) }}%
              </v-chip>
            </div>
            <div class="quote-row d-flex justify-space-between align-center py-1">
              <span class="text-caption text--secondary">{{ $t('thorchain.networkFees') }}</span>
              <span class="text-caption font-weight-medium">{{ formatFees(quote) }}</span>
            </div>
            <div class="quote-row d-flex justify-space-between align-center py-1">
              <span class="text-caption text--secondary">{{ $t('thorchain.estimatedTime') }}</span>
              <span class="text-caption font-weight-medium">
                <v-icon x-small color="grey" class="mr-1">mdi-clock-outline</v-icon>
                ~{{ Math.round(quote.total_swap_seconds / 60) }} min
              </span>
            </div>
            <v-divider class="my-2" style="opacity: 0.1;" />
            <div class="d-flex justify-space-between align-center">
              <span class="text-caption font-weight-bold">{{ $t('thorchain.youReceive') }}</span>
              <span class="font-weight-bold success--text" style="font-size: 14px;">
                {{ expectedOut }} {{ toAsset.split('.')[1] }}
              </span>
            </div>
          </div>
        </transition>

        <!-- Warnings & errors -->
        <v-alert v-if="quote?.warning" type="warning" outlined dense class="text-caption mb-3" style="border-radius: var(--g-r-control) !important;">
          {{ quote.warning }}
        </v-alert>
        <v-alert v-if="quoteError" type="error" outlined dense class="text-caption mb-3" style="border-radius: var(--g-r-control) !important;">
          {{ quoteError }}
        </v-alert>

        <!-- Action button -->
        <v-btn
          color="var(--g-accent)"
          dark
          block
          large
          :disabled="!isValid || !quote"
          @click="initiateSwap"
          style="border-radius: var(--g-r-control) !important;"
        >
          <v-icon left>mdi-swap-horizontal</v-icon>
          {{ $t('thorchain.initiateSwap') }}
        </v-btn>
      </div>
    </v-card>

    <!-- Info note -->
    <v-alert type="info" outlined dense class="text-caption mb-3" style="border-radius: var(--g-r-control) !important;">
      {{ $t('thorchain.infoNote') }}
    </v-alert>

    <!-- How it works -->
    <v-card outlined class="liquid-glass" style="border-radius: var(--g-r-card) !important;">
      <v-expansion-panels flat>
        <v-expansion-panel style="background: transparent !important;">
          <v-expansion-panel-header class="font-weight-medium" style="font-size: 13px;">
            <div class="d-flex align-center" style="gap: 8px;">
              <v-icon small color="var(--g-accent)">mdi-information-outline</v-icon>
              {{ $t('thorchain.howItWorks') }}
            </div>
          </v-expansion-panel-header>
          <v-expansion-panel-content>
            <v-timeline dense clipped>
              <v-timeline-item x-small color="var(--g-accent)" fill-dot>
                <span class="text-caption">{{ $t('thorchain.step1') }}</span>
              </v-timeline-item>
              <v-timeline-item x-small color="var(--g-accent)" fill-dot>
                <span class="text-caption">{{ $t('thorchain.step2') }}</span>
              </v-timeline-item>
              <v-timeline-item x-small color="var(--g-accent)" fill-dot>
                <span class="text-caption">{{ $t('thorchain.step3') }}</span>
              </v-timeline-item>
              <v-timeline-item x-small color="var(--g-accent)" fill-dot>
                <span class="text-caption">{{ $t('thorchain.step4') }}</span>
              </v-timeline-item>
            </v-timeline>
          </v-expansion-panel-content>
        </v-expansion-panel>
      </v-expansion-panels>
    </v-card>

    <!-- Confirm dialog -->
    <v-dialog v-model="confirmDialog" max-width="420">
      <v-card class="liquid-glass" v-if="quote" style="border-radius: var(--g-r-sheet) !important;">
        <div class="d-flex align-center pa-4 pb-2">
          <v-icon color="var(--g-accent)" class="mr-2">mdi-swap-horizontal-bold</v-icon>
          <span class="text-subtitle-1 font-weight-bold">{{ $t('thorchain.confirmSwap') }}</span>
        </div>
        <v-divider style="opacity: 0.12;" />
        <div class="pa-4">
          <v-alert type="warning" outlined dense class="text-caption mb-4" style="border-radius: var(--g-r-control) !important;">
            {{ $t('thorchain.sendExactAmount') }}
          </v-alert>

          <div class="confirm-row d-flex justify-space-between align-start py-2">
            <span class="text-caption text--secondary">{{ $t('thorchain.sendTo') }}</span>
            <span class="text-caption font-weight-medium text-right" style="font-family: var(--g-font-mono); max-width: 200px; word-break: break-all;">
              {{ quote.inbound_address }}
            </span>
          </div>
          <v-divider style="opacity: 0.08;" />
          <div class="confirm-row d-flex justify-space-between align-center py-2">
            <span class="text-caption text--secondary">{{ $t('thorchain.amount') }}</span>
            <span class="font-weight-bold">{{ fromAmount }} {{ fromAsset.split('.')[1] }}</span>
          </div>
          <v-divider style="opacity: 0.08;" />
          <div class="confirm-row d-flex justify-space-between align-start py-2">
            <span class="text-caption text--secondary">{{ $t('thorchain.memo') }}</span>
            <span class="text-caption text-right" style="font-family: var(--g-font-mono); max-width: 200px; word-break: break-all; opacity: 0.7;">
              {{ quote.memo }}
            </span>
          </div>
        </div>
        <v-card-actions class="pb-4 px-4">
          <v-btn outlined @click="confirmDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-spacer />
          <v-btn color="var(--g-accent)" dark @click="executeSwap">
            {{ $t('thorchain.confirmSwap') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, computed, toRefs } from 'vue';
import thorchainApi, { type ThorQuote } from '@/api/thorchain-api';
import { walletStore } from '@/stores/walletStore';

const { loggedWallet } = toRefs(walletStore);

const fromAsset = ref('BTC.BTC');
const toAsset = ref('ADA.ADA');
const fromAmount = ref('');
const destinationAddress = ref('');
const quote = ref<ThorQuote | null>(null);
const quoteLoading = ref(false);
const quoteError = ref<string | null>(null);
const confirmDialog = ref(false);

const assetOptions = [
  { value: 'BTC.BTC', label: 'Bitcoin (BTC)', ticker: 'BTC', name: 'Bitcoin', icon: 'mdi-bitcoin', color: '#F7931A' },
  { value: 'ADA.ADA', label: 'Cardano (ADA)', ticker: 'ADA', name: 'Cardano', icon: 'mdi-circle-outline', color: '#0033AD' },
  { value: 'ETH.ETH', label: 'Ethereum (ETH)', ticker: 'ETH', name: 'Ethereum', icon: 'mdi-ethereum', color: '#627EEA' },
];

const expectedOut = computed(() => {
  if (!quote.value) return '';
  const out = parseInt(quote.value.expected_amount_out);
  if (isNaN(out)) return '';
  return (out / 1e8).toFixed(8);
});

const isValid = computed(() => {
  const n = parseFloat(fromAmount.value);
  return !isNaN(n) && n > 0 && destinationAddress.value.length > 10 && fromAsset.value !== toAsset.value;
});

const addressRule = (v: string) => {
  if (!v) return true;
  if (v.length < 10) return 'Enter a valid destination address';
  return true;
};

function formatFees(q: ThorQuote): string {
  const total = parseInt(q.fees.total);
  return isNaN(total) ? '—' : `${(total / 1e8).toFixed(8)} ${q.fees.asset}`;
}

function swapAssets() {
  const temp = fromAsset.value;
  fromAsset.value = toAsset.value;
  toAsset.value = temp;
  quote.value = null;
  fromAmount.value = '';
}

let quoteTimeout: ReturnType<typeof setTimeout> | null = null;
function debouncedGetQuote() {
  quote.value = null;
  quoteError.value = null;
  if (quoteTimeout) clearTimeout(quoteTimeout);
  if (!isValid.value) return;
  quoteTimeout = setTimeout(fetchQuote, 600);
}

async function fetchQuote() {
  if (!isValid.value) return;
  quoteLoading.value = true;
  quoteError.value = null;
  try {
    const amountInSats = Math.round(parseFloat(fromAmount.value) * 1e8);
    quote.value = await thorchainApi.getSwapQuote(
      fromAsset.value,
      toAsset.value,
      amountInSats,
      destinationAddress.value,
    );
  } catch (e: any) {
    quoteError.value = e?.response?.data?.error || 'Failed to get quote';
  } finally {
    quoteLoading.value = false;
  }
}

function initiateSwap() {
  confirmDialog.value = true;
}

function executeSwap() {
  const txUrl = `https://track.ninerealms.com/`;
  window.open(txUrl, '_blank');
  confirmDialog.value = false;
}
</script>

<style scoped>
.page-icon-wrapper {
  width: 42px;
  height: 42px;
  border-radius: var(--g-r-card);
  background: color-mix(in srgb, var(--g-accent) 10%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.swap-card {
  border-color: color-mix(in srgb, var(--g-accent) 20%, transparent) !important;
}

.asset-select {
  max-width: 150px;
  min-width: 130px;
}

.asset-icon {
  width: 22px;
  height: 22px;
  border-radius: var(--g-r-chip);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.amount-input {
  font-size: 16px !important;
}

.output-field :deep(input) {
  color: var(--g-success);
  font-weight: 600;
}

.swap-arrow-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  height: 36px;
  margin: -4px 0;
}

.swap-arrow-btn {
  background: color-mix(in srgb, var(--g-accent) 10%, transparent) !important;
  border: 1px solid color-mix(in srgb, var(--g-accent) 30%, transparent) !important;
  transition: background 0.2s ease, transform 0.2s ease !important;
}

.swap-arrow-btn:hover {
  background: color-mix(in srgb, var(--g-accent) 20%, transparent) !important;
  transform: rotate(180deg);
}

.quote-details {
  background: color-mix(in srgb, var(--g-accent) 5%, transparent);
  border: 1px solid color-mix(in srgb, var(--g-accent) 15%, transparent);
}

.quote-row {
  border-bottom: 1px solid var(--g-hairline-1);
}

.quote-row:last-child {
  border-bottom: none;
}

.confirm-row {
  min-height: 38px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.fade-enter,
.fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>