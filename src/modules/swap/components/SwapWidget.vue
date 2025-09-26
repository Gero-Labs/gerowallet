<template>
  <v-card flat outlined class="mx-auto liquid-glass compact-swap-widget d-flex flex-column px-2" style="height: 100%;">
    <v-card-text class="pa-0 flex-grow-1 d-flex flex-column" style="overflow: hidden;">
      <div class="swap-content-wrapper">
        <v-card-title class="pb-0 pt-3 px-0">
          <v-btn-toggle mandatory active-class="geroButton" v-model="swapType" dense>
            <v-btn value="swap" x-small rounded>
              SWAP
            </v-btn>
            <v-btn value="limit" x-small rounded>
              LIMIT
            </v-btn>
          </v-btn-toggle>
          <v-spacer></v-spacer>
          <v-btn icon x-small>
            <v-icon x-small>mdi-reload</v-icon>
          </v-btn>
          <v-btn-toggle v-model="settingsToggle" dense>
            <v-btn x-small rounded :value="true">
              <v-icon color="red" x-small v-if="slippageRef === 'unlimited'">mdi-infinity</v-icon>
              <span v-else style="font-size: 11px">{{ slippageDisplay }}</span>
              <v-icon x-small class="ml-1">mdi-cog</v-icon>
            </v-btn>
          </v-btn-toggle>
        </v-card-title>
        <v-card-text class="pb-0 px-0 pt-2">
          <div class="d-flex align-center justify-space-between mb-1 mt-1">
            <span style="color: #FDA29B; font-size: 12px; font-weight: 200;">Selling</span>
            <span class="caption grey--text">Balance: {{ getTokenBalance(selectedTokenA) }}</span>
          </div>
          <TokenSelector
            v-model="selectedTokenA"
            :available="availableTokens"
            :index="0"
            title=""
            titleColor="#FDA29B"
            :price="getPrice(selectedTokenA)"
            @change="tokenAQuantityChange"
            :search="search"
            class="mt-n3"
            background-color="#101828"
          />
          <v-btn icon class="my-1 z-index-5 geroButton" @click="switchPair" style="height: 32px; width: 32px; margin: 8px auto;">
            <v-icon color="#1a1a1a">mdi-swap-vertical</v-icon>
          </v-btn>
          <div class="d-flex align-center justify-space-between mb-1 mt-n2">
            <span style="color: #75E0A7; font-size: 12px; font-weight: 200;">Buying</span>
            <span class="caption grey--text">Balance: {{ getTokenBalance(selectedTokenB) }}</span>
          </div>
          <TokenSelector
            v-model="selectedTokenB"
            :available="availableTokens"
            :index="0"
            title=""
            titleColor="#75E0A7"
            background-color="#161B26"
            :max-button-enabled="false"
            class="mt-n3"
            :price="getPrice(selectedTokenB)"
            :price-impact="calculateWeightedPriceImpact"
            @change="tokenBQuantityChange"
            :search="search"
          />
          <div class="text-left mt-2" v-if="swapType === 'swap'" style="display: flex;">
            <v-btn text plain x-small class="px-0 no-opacity" :ripple="false" @click="pairPriceToggle = !pairPriceToggle" style="letter-spacing: normal">
              <v-avatar
                color="primary"
                :style="{ animationDuration: '1.5s' }"
                class="mr-1 v-avatar--metronome"
                size="10"
              />
              <span style="font-size: 11px">{{ pairPrice }}</span>
            </v-btn>
            <v-spacer></v-spacer>
            <v-btn text plain x-small color="primary" class="px-0 no-opacity" :ripple="false" @click="swapOverviewToggle = true" style="letter-spacing: normal">
              <span style="font-size: 11px">Details</span>
              <v-icon x-small class="ml-1">mdi-chevron-down</v-icon>
            </v-btn>
          </div>
          <v-card style="border-radius: 8px;" flat class="transparent no-custom-styling" v-else>
            <v-card-text class="pa-2">
              <div class="text-left" style="font-size: 11px; display: flex; flex-flow: row; flex-wrap: wrap; place-content: space-between;">
                <div>
                  <span class="pr-1" style="font-weight: 600;">Limit Price</span>
                  <span
                    v-if="marketPriceDeltaPercentage.toFixed(2) !== '-0.00' && marketPriceDeltaPercentage.toFixed(2) !== '0.00'"
                    :style="{
                      color: marketPriceDeltaPercentage > 0 ? '#75E0A7' : '#FDA29B'
                    }"
                  >{{ `${marketPriceDeltaPercentage > 0 ? '+' : ''}${marketPriceDeltaPercentage.toFixed(2)}% ${marketPriceDeltaPercentage > 0 ? 'above' : 'below'} market` }}</span>
                </div>
                <div v-if="selectedTokenA.name === loggedWallet.chain">
                  <v-btn x-small text plain color="#FDA29B" class="px-1" @click="setLimitByPercentage(-5)">
                    -5%
                  </v-btn>
                  <v-btn x-small text plain color="#FDA29B" class="px-1" @click="setLimitByPercentage(-10)">
                    -10%
                  </v-btn>
                  <v-btn x-small text plain color="#FDA29B" class="px-1" @click="setLimitByPercentage(-25)">
                    -25%
                  </v-btn>
                  <v-btn x-small text plain color="#FDA29B" class="px-1" @click="setLimitByPercentage(-50)">
                    -50%
                  </v-btn>
                </div>
                <div v-else>
                  <v-btn x-small text plain color="#75E0A7" class="px-1" @click="setLimitByPercentage(5)">
                    +5%
                  </v-btn>
                  <v-btn x-small text plain color="#75E0A7" class="px-1" @click="setLimitByPercentage(10)">
                    +10%
                  </v-btn>
                  <v-btn x-small text plain color="#75E0A7" class="px-1" @click="setLimitByPercentage(25)">
                    +25%
                  </v-btn>
                  <v-btn x-small text plain color="#75E0A7" class="px-1" @click="setLimitByPercentage(50)">
                    +50%
                  </v-btn>
                </div>
              </div>
              <div class="text-left" style="font-size: 12px; display: flex; flex-flow: row; flex-wrap: wrap; place-content: space-between;">
                <CurrencyTextField v-model="limit" :dense="true" style="max-width: 144px" :font-size="18" @change="limitChange" :decimals="7" />
                <div style="align-content: center; padding-top: 8px;">{{ `${price_ba2?.toFixed(7)} ${selectedTokenB.ticker === 'ADA' ? selectedTokenA.ticker : selectedTokenB.ticker}` }}</div>
              </div>
              <div class="text-left mt-1 pt-2" style="font-size: 12px; display: flex; flex-flow: row; flex-wrap: wrap; place-content: space-between;">
                <v-btn-toggle active-class="geroButton" v-model="limitType" mandatory>
                  <v-btn text value="one" x-small>
                    ONE
                  </v-btn>
                  <v-btn text value="split" x-small>
                    SPLIT
                  </v-btn>
                </v-btn-toggle>
                <div v-if="limitType === 'one'">
                  Single Order
                </div>
                <div class="pt-2 px-2" style="display: flex; width: 100%" v-else>
                  <v-slider
                    v-model="limitSplit"
                    dense
                    min="1"
                    max="40"
                    hide-details
                    style="height: 20px; align-items: center;"
                  ></v-slider>
                  <div style="display: flex; text-align: end;">
                    <span style="width: 45px">{{ `${limitSplit} / 40` }}</span>
                  </div>

                </div>
              </div>
            </v-card-text>
          </v-card>
          <div class="text-left" v-else>
            <v-progress-circular indeterminate size="20" class="ma-2"></v-progress-circular>
          </div>
        </v-card-text>
        <SwapOverviewOverlay ref="swap" @excludedChange="excludedChange" v-model="swapOverviewToggle" :token-a="selectedTokenA" :token-b="selectedTokenB" :slippage="slippageRef" :estimation="estimation" style="border-radius: 8px" class="mx-3 mt-1 mb-0" />
      </div>
    </v-card-text>
    <v-card-actions class="px-3 pt-2 pb-3" style="justify-content: center;">
      <v-btn
        max-width="420"
        style="color: black!important; width: 100%; border-radius: 10px;"
        class="geroButton"
        :disabled="isSwapDisabled || loading || poolError"
        @click="prepareSwap"
        :loading="loading"
      >
        <span style="font-size: 13px; font-weight: 600;">{{ poolError ? 'Pool Not Found' : swapButtonText }}</span>
      </v-btn>
    </v-card-actions>
    <SettingsOverlay ref="settings" v-model="settingsToggle" @setSlippage="setSlippage" />
  </v-card>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRefs, watch } from 'vue';
import TokenSelector from '@/shared/components/TokenSelector.vue';
import SettingsOverlay from '@/modules/swap/components/SettingsOverlay.vue';
import SwapOverviewOverlay from '@/modules/swap/components/SwapOverviewOverlay.vue';
import { networkStore } from '@/stores/networkStore';
import { priceStore } from '@/stores/priceStore';
import filters from '@/shared/utils/filters';
import networks from '@/utils/networks';
import debounce from 'lodash/debounce';
import snackbar from '@/plugins/snackbar';
import { Messaging } from '@/chrome/messaging';
import { METHOD } from '@/chrome/config';
import DexHunterStore, { dexHunterStore } from '@/stores/dexHunterStore';
import { walletStore } from '@/stores/walletStore';
import dexHunterApi from '@/api/dexhunter-api';
import CurrencyTextField from '@/shared/components/CurrencyTextField.vue';
import { MessageTypes } from '@/models/MessageTypes';
import cardanoSvg from '@/assets/svg/cardano.svg';

const emit = defineEmits(['onSwap'])

const { loggedWallet, tokens: resolvedAssets } = toRefs(walletStore);
const { price } = toRefs(networkStore);
const { dexHunterTokens } = toRefs(dexHunterStore);
const { utxos } = toRefs(walletStore);

const isUpdating = ref<boolean>(false);
const lastNonADATokenA = ref(null);
const lastNonADATokenB = ref(null);
const slippageRef = ref<string>('2');
const settingsToggle = ref<boolean>(false);
const swapType = ref<string>('swap');
let selectedTokenA = ref({
  name: 'Cardano',
  ticker: 'ADA',
  img: cardanoSvg,
  fallback_img: "https://storage.googleapis.com/dexhunter-images/public/unverified.svg",
  balance: 0,
  quantity: '0',
  decimals: 6,
  unit: '',
  verified: true
});

let selectedTokenB = ref({
  name: 'GERO',
  ticker: 'GERO',
  img: "https://storage.googleapis.com/dexhunter-images/tokens/10a49b996e2402269af553a8a96fb8eb90d79e9eca79e2b4223057b64745524f.webp",
  fallback_img: "https://storage.googleapis.com/dexhunter-images/public/unverified.svg",
  balance: 0,
  quantity: '0',
  decimals: 6,
  unit: '10a49b996e2402269af553a8a96fb8eb90d79e9eca79e2b4223057b64745524f',
  verified: true
})

const price_ab = ref<number>(0);
const price_ba = ref<number>(0);
const price_ab2 = ref<number>(0);
const price_ba2 = ref<number>(0);
const total_output_without_slippage = ref<number>(0);
const total_input_without_slippage = ref<number>(0);
const estimation = ref({
  net_price_reverse: 0,
  total_output: 0,
  deposits: 0,
  batcher_fee: 0,
  partner_fee: 0,
});
const splits = ref(undefined);
const lastFunctionCalled = ref<string>('estimate');
const intervalId = ref<any>(0);
const loading = ref<boolean>(false);
const swapOverviewToggle = ref<boolean>(false);
const pairPriceToggle = ref<boolean>(false);
const blacklisted_dexes = ref<any[]>([]);
const search = ref(DexHunterStore.searchTokens);
const poolError = ref<boolean>(false);
const limit = ref<string>('0.0000000');
const limitType = ref<string>('one');
const limitSplit = ref<number>(1);

const swapButtonText = computed(() => {
  if (isInsufficientBalance.value) {
    return 'INSUFFICIENT BALANCE';
  } else if (swapType.value === 'limit') {
    if (limitType.value === 'one' || limitType.value === 'split' && limitSplit.value === 1) {
      return 'PLACE ORDER';
    } else if (limitType.value === 'split') {
      return `PLACE ${limitSplit.value} ORDERS`;
    }
  }
  return 'SWAP'
})

const isSwapDisabled = computed(() => {
  if (!selectedTokenA.value || !selectedTokenB.value) return true;

  if (swapType.value === 'swap') {
    const quantityA = (selectedTokenA.value.quantity || '0').toString().replaceAll(',','')
    const quantityB = (selectedTokenB.value.quantity || '0').toString().replaceAll(',', '')
    return quantityA === '0' || quantityB === '0' || isNaN(Number(quantityA)) || isNaN(Number(quantityB)) || isInsufficientBalance.value
  } else if (swapType.value === 'limit') {
    const quantity = (selectedTokenA.value.quantity || '0').toString().replaceAll(',', '')
    return isInsufficientBalance.value || Number(quantity) === 0 || Number(limit.value).toFixed(7) === price_ba2.value.toFixed(7)
  }
  return true;
})

const isInsufficientBalance = computed(() => {
  if (!selectedTokenA.value) return false;

  const quantityA = (selectedTokenA.value.quantity || '0').toString().replaceAll(',','')
  const decimals = selectedTokenA.value.decimals || 0;
  const balance = selectedTokenA.value.balance || 0;
  const b = filters.toCurrency(balance, false, decimals, '', '', false, decimals).replaceAll(',', '')
  const balanceA = Number(b)
  return Number(quantityA) > balanceA
})

const marketPriceDeltaPercentage = computed(() => {
  if (limit.value === '0') {
    return 0
  }
  return ((Number(limit.value) - price_ba2.value)/price_ba2.value * 100);
})

const nativeTokenComputed = computed(() => {
  const currencyTicker = networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network);
  const assetsArray = resolvedAssets.value ? Object.values(resolvedAssets.value) : [];
  const token: any = assetsArray.find((token: any) => token.metadata?.ticker === currencyTicker);
  console.log('token', token)
  if (token) {
    return token
  } else {
    return {
      name: 'Cardano',
      ticker: 'ADA',
      img: cardanoSvg,
      balance: 0,
      quantity: '0',
      decimals: 6,
      unit: '',
      verified: true,
    }
  }
})

const availableTokens = computed(() => {
  if (!dexHunterTokens.value) {
    return [];
  }

  const nativeToken = {
    ticker: nativeTokenComputed.value.metadata?.ticker,
    balance: nativeTokenComputed.value.quantity,
    ...nativeTokenComputed.value
  }; // avoid modifying the original state
  const availableTokens = Object.values(dexHunterTokens.value)
    .map((token: any) => {
      const found: any = resolvedAssets.value[token['unit']];
      const res = {
        ...token,
        balance: found ? found.quantity : 0,
      };
      if (found && selectedTokenB.value.unit === found.unit) {
        selectedTokenB.value.balance = res.balance
      }
      if (selectedTokenA.value?.ticker === nativeToken?.ticker) {
        selectedTokenA.value.balance = nativeToken.balance
      }
      return res
    })
    .sort((a, b) => {
    //   const isPinnedA = pinnedTokens.includes(a['unit']);
    //   const isPinnedB = pinnedTokens.includes(b['unit']);
    //
    //   // Prioritize pinned tokens
    //   if (isPinnedA && !isPinnedB) return -1;
    //   if (!isPinnedA && isPinnedB) return 1;
    //
    //   // If both are pinned, sort by name
    //   if (isPinnedA && isPinnedB) {
    //     return a['name'].localeCompare(b['name']);
    //   }
    //
    //   // If none are pinned, sort by balance in descending order
      return b.balance - a.balance;
    });
  const gr = [nativeToken, ...availableTokens];
  return gr;
});

const calculateWeightedPriceImpact = computed(() => {
  if (swapType.value === 'limit') {
    return 0
  }
  let totalAmount = 0;
  let totalWeightedImpact = 0;
  if (!splits.value) {
    return 0
  }
  splits.value.forEach(({ price_impact, amount_in }) => {
    totalAmount += amount_in;
    totalWeightedImpact += price_impact * amount_in;
  });

  if (totalAmount === 0) {
    return 0;
  }

  return Number(totalWeightedImpact / totalAmount);
})

const slippageDisplay = computed(() => {
  return slippageRef.value === 'auto' ? 'AUTO' : `${slippageRef.value}%`;
})

const pairPrice = computed(() => {
  if (poolError.value) {
    return 'Pool Not Found'
  }
  const tokenA = selectedTokenA.value?.ticker;
  const tokenB = selectedTokenB.value?.ticker === 'ADA' ? tokenA : selectedTokenB.value?.ticker;
  if (!pairPriceToggle.value) {
    return `1 ${tokenB} = ${price_ba2.value?.toFixed(7)} ADA`;
  } else {
    return `1 ADA = ${price_ab2.value?.toFixed(7)} ${tokenB}`;
  }
});

watch( () => selectedTokenA.value?.ticker, async (newVal, oldVal) => {
  if (isUpdating.value) return; // Prevent recursive updates
  isUpdating.value = true; // Set flag to prevent mutual watcher trigger

  if (newVal === 'ADA') {
    // If selectedTokenA is changed to ADA, set selectedTokenB to last non-ADA tokenB if exists
    if (lastNonADATokenB.value) {
      selectedTokenB.value = availableTokens.value.find(token => token['ticker'] === lastNonADATokenB.value?.ticker);
    } else {
      selectedTokenB.value = availableTokens.value.find(token => token['ticker'] === oldVal);
    }
  } else {
    // Store the last non-ADA token for selectedTokenA
    lastNonADATokenA.value = { ...selectedTokenA.value };
    // Set selectedTokenB to ADA
    selectedTokenB.value = availableTokens.value.find(token => token['ticker'] === 'ADA');
  }
  await averagePrice(!selectedTokenA.value.unit ? selectedTokenA.value?.ticker : selectedTokenA.value.unit, !selectedTokenB.value.unit ? selectedTokenB.value.ticker : selectedTokenB.value.unit);
  // Estimate prices after updating tokens
  await estimate(selectedTokenA.value.unit, selectedTokenB.value.unit, 1, false);
  isUpdating.value = false; // Reset flag
})

watch(() => selectedTokenB.value.ticker, async (newVal, oldVal) => {
  if (isUpdating.value) return; // Prevent recursive updates
  isUpdating.value = true; // Set flag to prevent mutual watcher trigger
  if (newVal === 'ADA') {
    // If selectedTokenB is changed to ADA, set selectedTokenA to last non-ADA tokenA if exists
    if (lastNonADATokenA.value) {
      selectedTokenA.value = availableTokens.value.find(token => token.ticker === lastNonADATokenA.value.ticker);
    } else {
      selectedTokenA.value = availableTokens.value.find(token => token.ticker === oldVal);
    }
  } else {
    // Store the last non-ADA token for selectedTokenB
    lastNonADATokenB.value = { ...selectedTokenB.value };
    // If selectedTokenB is not ADA, keep selectedTokenA as ADA
    if (selectedTokenA.value.ticker !== 'ADA') {
      selectedTokenA.value = availableTokens.value.find(token => token['ticker'] === 'ADA');
    }
  }
  await averagePrice(!selectedTokenA.value.unit ? selectedTokenA.value.ticker : selectedTokenA.value.unit, !selectedTokenB.value.unit ? selectedTokenB.value.ticker : selectedTokenB.value.unit);
  // Estimate prices after updating tokens
  await estimate(selectedTokenA.value.unit, selectedTokenB.value.unit, 1, false);
  isUpdating.value = false; // Reset flag
})

watch(() => limit.value,  (newVal, oldVal) => {
  if (swapType.value === 'limit') {
    selectedTokenB.value.quantity = (Number(newVal) * Number(selectedTokenA.value.quantity)).toString()
  }
})

const limitChange = (change: string) => {
  const marketDelta = (Number(change) - price_ba2.value)/price_ba2.value * 100
  if (marketDelta < -100000) {
    setLimitByPercentage(-100000)
  } else if (marketDelta > 100000) {
    setLimitByPercentage(100000)
  } else {
    limit.value = change;
  }
}

const setLimitByPercentage = (percentage: number) => {
  console.log('setLimitByPercentage', percentage)
  limit.value = (price_ba2.value * (1 + percentage / 100)).toString();
  console.log('setLimitByPercentage', limit.value)
}

const tokenAQuantityChange = (val) => {
  debouncedEstimateTokenA(val);
}

const debouncedEstimateTokenA = debounce((val) => {
  if (!val || val === 0 || swapType.value === 'limit') {
    selectedTokenB.value.quantity = '0'
  } else {
    estimate(selectedTokenA.value.unit, selectedTokenB.value.unit, val, true);
  }
  lastFunctionCalled.value = 'estimate';
}, 300)


const tokenBQuantityChange = (val) => {
  debouncedEstimateTokenB(val);
}

const debouncedEstimateTokenB = debounce((val) => {
  if (!val || val === 0 || swapType.value === 'limit') {
    selectedTokenA.value.quantity = '0'
  } else {
    reverseEstimate(selectedTokenA.value.unit, selectedTokenB.value.unit, val, true)
  }
  lastFunctionCalled.value = 'reverseEstimate';
}, 300)


const getPrice = (token) => {
  if (!token || !token.quantity) return '';
  const multiplier = token.ticker === 'ADA' ? 1 : price_ba.value;
  const quantity = (token.quantity || '0').toString().replaceAll(',', '');
  // Use Kraken WebSocket price for ADA, fallback to network store price
  const lastPrice = priceStore.adaUsd?.lastPrice || price.value?.lastPrice || 0;

  return (Number(quantity) * multiplier * lastPrice).toLocaleString('en-US');
}

const getTokenBalance = (token) => {
  if (!token) return '0';
  const balance = token.balance || 0;
  const decimals = token.decimals || 0;
  return filters.toCurrency(balance, false, 2, '', '', true, decimals);
}

const setSlippage = (val) => {
  slippageRef.value = val;
}

const switchPair = () => {
  // Set the flag to prevent watchers from triggering
  isUpdating.value = true;

  // Store current values
  const tempTokenA = { ...selectedTokenA.value };
  const tempTokenB = { ...selectedTokenB.value };

  // Swap the tokens
  selectedTokenA.value = tempTokenB;
  selectedTokenB.value = tempTokenA;

  // Update last non-ADA tokens if needed
  if (tempTokenB.ticker !== 'ADA') {
    lastNonADATokenA.value = tempTokenB;
  }
  if (tempTokenA.ticker !== 'ADA') {
    lastNonADATokenB.value = tempTokenA;
  }

  // Reset the flag after a small delay to ensure watchers don't interfere
  setTimeout(() => {
    isUpdating.value = false;
  }, 100);
}

const estimate = (token_in: string, token_out: string, amount_in, update) => {
  if (!loggedWallet.value) {
    return
  }
  if (!token_in && !token_out) {
    return
  }
  if (!amount_in) {
    total_output_without_slippage.value = 0
    return;
  } else if (isNaN(amount_in)) {
    return;
  }
  const slippage = slippageRef.value === 'unlimited' ? '-1' : Number(slippageRef.value).toString();
  dexHunterApi.estimate(amount_in, token_in, token_out, Number(slippage), blacklisted_dexes.value).then(res => {
    poolError.value = false;
    const data = res.data;
    price_ab.value = data.net_price_reverse;
    price_ba.value = data.net_price;
    if (update) {
      total_output_without_slippage.value = data.total_output_without_slippage
      splits.value = data.splits
      estimation.value = data
      if (swapType.value !== 'limit') {
        selectedTokenB.value.quantity = filters.toCurrency(total_output_without_slippage.value, false, selectedTokenB.value.decimals, '', '', false, 0);
      }
    }
  }).catch((_e) => {
    poolError.value = true
  });
}

const reverseEstimate = async (token_in, token_out, amount_out, update) => {
  if (!loggedWallet.value) {
    return
  }
  if (!token_in && !token_out) {
    return
  }
  if (!amount_out) {
    total_input_without_slippage.value = 0
    return;
  } else if (isNaN(amount_out)) {
    return;
  }
  const slippage = slippageRef.value === 'unlimited' ? -1 : Number(slippageRef.value);
  try {
    const res = await dexHunterApi.reverseEstimate(amount_out, token_in, token_out, slippage, blacklisted_dexes.value);
    poolError.value = false
    price_ab.value = res.data.net_price_reverse;
    price_ba.value = res.data.net_price;
    if (update) {
      total_input_without_slippage.value = res.data.total_input_without_slippage
      splits.value = res.data.splits
      estimation.value = res.data
      selectedTokenA.value.quantity = filters.toCurrency(total_input_without_slippage.value, false, selectedTokenA.value.decimals, '', '', false, 0);
    }
  } catch (e) {
    poolError.value = true
  }
}

const averagePrice = (token_in, token_out) => {
  if (!loggedWallet.value) {
    return
  }
  if (!token_in && !token_out) {
    return
  }
  dexHunterApi.getAveragePrice(token_in, token_out).then(res => {
    price_ab2.value = res.price_ab;
    price_ba2.value = res.price_ba;
    limit.value = structuredClone(price_ba2.value).toString()
    console.log(limit.value)
  }).catch(() => {
    // console.log(e)
  });
}

const performPeriodicEstimate = async () => {
  // Add defensive checks for undefined tokens
  if (!selectedTokenA.value || !selectedTokenB.value) {
    console.warn('Tokens not properly initialized');
    return;
  }

  if (lastFunctionCalled.value === 'estimate') {
    const quantity = selectedTokenA.value.quantity || '0';
    const amount = Number(quantity.toString().replaceAll(',', ''))
    if (amount === 0) {
      await estimate(selectedTokenA.value.unit, selectedTokenB.value.unit, 1, false);
    } else {
      await estimate(selectedTokenA.value.unit, selectedTokenB.value.unit, amount, true);
    }
  } else if (lastFunctionCalled.value === 'reverseEstimate') {
    const quantity = selectedTokenB.value.quantity || '0';
    const amount = Number(quantity.toString().replaceAll(',', ''))
    if (amount === 0) {
      await reverseEstimate(selectedTokenA.value.unit, selectedTokenB.value.unit, 1, false);
    } else {
      await reverseEstimate(selectedTokenA.value.unit, selectedTokenB.value.unit, amount, true);
    }
  }
}

const prepareSwap = async () => {
  loading.value = true
  let swapRes
  const amount = Number(selectedTokenA.value['quantity'].replaceAll(',', ''))
  try {
    if (swapType.value === 'swap') {
      const slippage = slippageRef.value === 'unlimited' ? -1 : Number(slippageRef.value);
      swapRes = await dexHunterApi.swap(amount, loggedWallet.value?.baseAddress, selectedTokenA.value['unit'], selectedTokenB.value['unit'], slippage)
    } else if (swapType.value === 'limit') {
      const toSplit = limitType.value === 'split'
      const multiples = toSplit ? limitSplit.value : 1
      swapRes = await dexHunterApi.swapLimitBuild(amount, loggedWallet.value?.baseAddress, selectedTokenA.value['unit'], selectedTokenB.value['unit'], 'GeroLabs', multiples, toSplit, Number(limit.value))
    }
    const txCbor = swapRes.cbor
    const partialSign = true
    console.log('txCbor', txCbor)
    const signaturesRes: any = await Messaging.sendToBackground({
      method: METHOD.signTx,
      data: { tx: txCbor, partialSign, mergeWitnesses: false },
    });
    console.log('signaturesRes', signaturesRes)
    if (signaturesRes.error) {
      snackbar.setError(signaturesRes.error.info)
    } else {
      console.log(signaturesRes)
      const signRes: any = await dexHunterApi.swapSign(signaturesRes.data, txCbor)
      console.log('signRes', signRes)
      await submit(signRes.cbor)
    }
  } catch (error: any) {
    console.log(error)
    if (error['response']) {
      snackbar.setError(`Swap Failed. Error Code: ${error['response'].status} - ${JSON.stringify(error['response'].data)}`)
    } else {
      snackbar.setError(error)
    }
    console.error(error)
  } finally {
    loading.value = false
  }
}

const submit = async (cborHex: string) => {
  const submitResult = await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.SUBMIT_TX,
    data: {
      txCbor: cborHex,
      witnessHex: null,
      utxos: utxos.value
    }
  }) as { data: { txId?: string; error?: string } };

  if (submitResult.data.error) {
    throw new Error(submitResult.data.error);
  }
  const txId = submitResult.data.txId;
  snackbar.fireSuccess(`Swap Order Transaction Submitted Successfully! Tx Id: ${txId}`)
  emit('onSwap')
  console.log(txId)
}

const excludedChange = async (val) => {
  blacklisted_dexes.value = val
  await performPeriodicEstimate()
}

onMounted(async () => {
  await averagePrice(!selectedTokenA.value.unit ? selectedTokenA.value.ticker : selectedTokenA.value.unit, !selectedTokenB.value.unit ? selectedTokenB.value.ticker : selectedTokenB.value.unit);
  intervalId.value = setInterval(performPeriodicEstimate, 10000); // Set interval to call estimate every 5 seconds
})

onBeforeUnmount(() => {
  clearInterval(intervalId.value);
})
</script>
<style scoped>
/* Compact swap widget styles */
.compact-swap-widget {
  /* Reduce overall spacing */
  display: flex;
  flex-direction: column;
}

/* Content wrapper that allows scrolling when needed */
.swap-content-wrapper {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  max-width: 420px;
  width: 100%;
  align-self: center;
}

.compact-swap-widget .v-card__actions {
  padding: 8px 0 12px !important;
}

/* Make token selector more compact */
.compact-swap-widget >>> .card-container {
  padding: 4px 16px 4px 8px !important;
  box-shadow: none !important;
  min-height: auto !important;
  background: #101828 !important;
  border: 1px solid #1F242F !important;
}

.compact-swap-widget >>> .card-container.v-card {
  background: #101828 !important;
}

/* Hide the token name subtitle */
.compact-swap-widget >>> .v-list-item__subtitle {
  display: none !important;
}

/* Hide the balance subtitle inside the token selector */
.compact-swap-widget >>> .card-container .v-card__subtitle {
  display: none !important;
}

/* Reduce token icon size */
.compact-swap-widget >>> .card-container .v-avatar {
  height: 32px !important;
  width: 32px !important;
}

/* Keep metronome avatar small */
.compact-swap-widget .v-avatar--metronome {
  height: 10px !important;
  width: 10px !important;
}

/* Adjust verification badge for smaller icons */
.compact-swap-widget >>> .v-badge__badge {
  height: 24px !important;
  width: 8px !important;
  min-width: 16px !important;
}

.compact-swap-widget >>> .v-badge__badge .v-avatar {
  height: 16px !important;
  width: 16px !important;
}

.compact-swap-widget >>> .v-badge__badge .v-icon {
  font-size: 12px !important;
}

.compact-swap-widget >>> .v-list-item__content {
  padding: 2px 0 !important;
}

.compact-swap-widget >>> .v-list-item {
  min-height: auto !important;
  padding: 4px 0 !important;
}

.compact-swap-widget >>> .v-input__control {
  min-height: 32px !important;
}

.compact-swap-widget >>> .v-text-field__details {
  display: none !important;
}

/* Reduce button sizes */
.compact-swap-widget .v-btn--x-small {
  height: 24px !important;
  min-width: 32px !important;
  padding: 0 8px !important;
}

.compact-swap-widget .v-btn--small {
  height: 28px !important;
  padding: 0 12px !important;
}

/* Compact the limit order section */
.compact-swap-widget .v-btn.px-1 {
  min-width: 36px !important;
  padding: 0 4px !important;
}

/* Reduce icon sizes */
.compact-swap-widget .v-icon--x-small {
  font-size: 16px !important;
}

.compact-swap-widget .v-icon--small {
  font-size: 18px !important;
}

/* Compact expansion panels */
.compact-swap-widget >>> .v-expansion-panel-content__wrap {
  padding: 8px 12px !important;
}

/* Make number inputs more compact */
.compact-swap-widget >>> input[type="number"] {
  padding: 4px 8px !important;
}

/* Reduce margin between elements */
.compact-swap-widget .mt-2 {
  margin-top: 4px !important;
}

.compact-swap-widget .my-1 {
  margin-top: 4px !important;
  margin-bottom: 4px !important;
}

.compact-swap-widget .mt-n3 {
  margin-top: -12px !important;
}

/* Keep aspect ratio for swap button between tokens */
.compact-swap-widget .z-index-5 {
  z-index: 5;
  margin: 12px auto 0 auto !important;
  display: block !important;
}

</style>
