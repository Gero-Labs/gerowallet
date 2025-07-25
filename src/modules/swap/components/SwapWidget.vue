<template>
  <v-card flat outlined max-width="450" class="mx-auto liquid-glass-subtle">
    <v-card-text class="pa-0">
      <v-card flat class="transparent">
        <v-card-title>
          <v-btn-toggle mandatory active-class="geroButton" v-model="swapType">
            <v-btn value="swap" small rounded>
              SWAP
            </v-btn>
            <v-btn value="limit" small rounded>
              LIMIT
            </v-btn>
          </v-btn-toggle>
          <v-spacer></v-spacer>
          <v-btn icon small>
            <v-icon small>mdi-reload</v-icon>
          </v-btn>
          <v-btn-toggle v-model="settingsToggle">
            <v-btn small rounded :value="true">
              <v-icon color="red" small v-if="slippageRef === 'unlimited'">mdi-infinity</v-icon>
              <span v-else>{{ slippageDisplay }}</span>
              <v-icon small class="ml-1">mdi-cog</v-icon>
            </v-btn>
          </v-btn-toggle>
        </v-card-title>
        <v-card-text class="pb-0">
          <TokenSelector
            v-model="selectedTokenA"
            :available="availableTokens"
            :index="0"
            title="Selling"
            titleColor="#FDA29B"
            :price="getPrice(selectedTokenA)"
            @change="tokenAQuantityChange"
            :search="search"
          />
          <v-btn outlined icon color="#00DFF3" class="mt-2 z-index-5" @click="switchPair">
            <v-icon color="#00DFF3">mdi-chevron-double-down</v-icon>
          </v-btn>
          <TokenSelector
            v-model="selectedTokenB"
            :available="availableTokens"
            :index="0"
            title="Buying"
            titleColor="#75E0A7"
            background-color="transparent"
            :max-button-enabled="false"
            class="mt-n4"
            :price="getPrice(selectedTokenB)"
            :price-impact="calculateWeightedPriceImpact"
            @change="tokenBQuantityChange"
            :search="search"
          />
          <div class="text-left" v-if="swapType === 'swap'" style="display: flex;">
            <v-btn text plain class="px-0 no-opacity" :ripple="false" @click="pairPriceToggle = !pairPriceToggle" style="letter-spacing: normal">
              <v-avatar
                color="primary"
                :style="{ animationDuration: '1.5s' }"
                class="mr-1 v-avatar--metronome"
                size="12"
              />
              {{ pairPrice }}
            </v-btn>
            <v-spacer></v-spacer>
            <v-btn text plain color="primary" class="px-0 no-opacity" :ripple="false" @click="swapOverviewToggle = true" style="letter-spacing: normal">
              Details
              <v-icon small class="ml-1">mdi-chevron-down</v-icon>
            </v-btn>
          </div>
          <v-card style="border-radius: 10px;" flat class="transparent" v-else>
            <v-card-text class="px-2">
              <div class="text-left" style="font-size: 12px; display: flex; flex-flow: row; flex-wrap: wrap; place-content: space-between;">
                <div>
                  <span class="pr-1">Limit Price</span>
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
              <div class="text-left mt-1" style="font-size: 12px; display: flex; flex-flow: row; flex-wrap: wrap; place-content: space-between;">
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
                <div style="display: flex; width: 172px" v-else>
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
        <SwapOverviewOverlay ref="swap" @excludedChange="excludedChange" v-model="swapOverviewToggle" :token-a="selectedTokenA" :token-b="selectedTokenB" :slippage="slippageRef" :estimation="estimation" style="border-radius: 10px" class="ma-2 mb-0" />
      </v-card>
    </v-card-text>
    <v-card-actions class="mx-2 pt-0 mb-2">
      <v-btn large block rounded style="color: black!important;" class="geroButton rounded-10" :disabled="isSwapDisabled || loading" @click="prepareSwap" :loading="loading">
        {{ swapButtonText }}
      </v-btn>
    </v-card-actions>
    <SettingsOverlay ref="settings" v-model="settingsToggle" @setSlippage="setSlippage" />
  </v-card>
</template>
<script setup lang="ts">
import { computed, watch, ref, onMounted, onBeforeUnmount, toRefs } from 'vue';
import TokenSelector from '@/shared/components/TokenSelector.vue';
import SettingsOverlay from '@/modules/swap/components/SettingsOverlay.vue';
import SwapOverviewOverlay from '@/modules/swap/components/SwapOverviewOverlay.vue';
import { geroStore } from '@/stores/geroStore';
import { networkStore } from '@/stores/networkStore';
import filters from '@/shared/utils/filters';
import networks, { cardanoLogo } from '@/utils/networks';
import debounce from 'lodash/debounce';
import snackbar from '@/plugins/snackbar';
import { Messaging } from '@/chrome/messaging';
import { METHOD } from '@/chrome/config';
import { Transaction } from '@emurgo/cardano-serialization-lib-browser';
import { dexHunterStore } from '@/stores/dexHunterStore';
import { walletStore } from '@/stores/walletStore';
import dexHunterApi from '@/api/dexhunter-api';
import CurrencyTextField from '@/shared/components/CurrencyTextField.vue';

const emit = defineEmits(['onSwap'])

const { loggedWallet, resolvedAssets, pinnedTokens, baseAddress } = toRefs(walletStore);
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
  img: cardanoLogo,
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
const search = ref(dexHunterStore.searchTokens);
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
  if (swapType.value === 'swap') {
    const quantityA = selectedTokenA.value.quantity.replaceAll(',','')
    const quantityB = selectedTokenB.value.quantity.replaceAll(',', '')
    return quantityA === '0' || quantityB === '0' || isNaN(Number(quantityA)) || isNaN(Number(quantityB)) || isInsufficientBalance.value
  } else if (swapType.value === 'limit') {
    return isInsufficientBalance.value || Number(selectedTokenA.value['quantity'].replaceAll(',', '')) === 0 || Number(limit.value).toFixed(7) === price_ba2.value.toFixed(7)
  }
  return true;
})

const isInsufficientBalance = computed(() => {
  const quantityA = selectedTokenA.value.quantity.replaceAll(',','')
  const b = filters.toCurrency(selectedTokenA.value.balance, false, selectedTokenA.value.decimals, '', '', false, selectedTokenA.value.decimals).replaceAll(',', '')
  const balanceA = Number(b)
  return Number(quantityA) > balanceA
})

const tokens = computed(() => {
  return (
    resolvedAssets?.map(token => ({
      name: token.metadata.name,
      ticker: token.metadata.ticker,
      img: token.img,
      balance: token.quantity,
      decimals: token.metadata.decimals,
      unit: token.unit,
      quantity: '0',
    })) || []
  );
})

const marketPriceDeltaPercentage = computed(() => {
  if (limit.value === '0') {
    return 0
  }
  return ((Number(limit.value) - price_ba2.value)/price_ba2.value * 100);
})

const nativeTokenComputed = computed(() => {
  const currencyTicker = networks.resolveCurrencyTicker(appWallet?.chain, appWallet?.network);
  const token = resolvedAssets?.find(token => token.ticker === currencyTicker);
  return token
    ? {
      name: token.metadata.name,
      ticker: token.metadata.ticker,
      img: token.img,
      balance: token.quantity,
      decimals: token.metadata.decimals,
      unit: token.unit,
      quantity: '0',
      verified: true,
    }
    : {
      name: 'Cardano',
      ticker: 'ADA',
      img: cardanoLogo,
      balance: 0,
      quantity: '0',
      decimals: 6,
      unit: '',
      verified: true,
    };
})

const availableTokens = computed(() => {
  if (!dexHunterTokens) {
    return [];
  }

  const resolvedAssets = tokens.value;
  const native = resolvedAssets?.find(t => t.unit === nativeTokenComputed.value.unit);

  const nativeToken = { ...nativeTokenComputed.value }; // avoid modifying the original state

  if (native) {
    nativeToken.balance = native.balance;
  }

  const availableTokens = Object.values(dexHunterTokens)
    .map((token: any) => {
      const found = resolvedAssets?.find(t => t.unit === token['unit']);
      const res = {
        ...token,
        balance: found ? found.balance : 0,
      };
      if (found && selectedTokenB.value.unit === found.unit) {
        selectedTokenB.value.balance = res.balance
      }
      if (selectedTokenA.value.ticker === nativeToken.ticker) {
        selectedTokenA.value.balance = nativeToken.balance
      }
      return res
    })
    .sort((a, b) => {
      const isPinnedA = pinnedTokens.includes(a['unit']);
      const isPinnedB = pinnedTokens.includes(b['unit']);

      // Prioritize pinned tokens
      if (isPinnedA && !isPinnedB) return -1;
      if (!isPinnedA && isPinnedB) return 1;

      // If both are pinned, sort by name
      if (isPinnedA && isPinnedB) {
        return a['name'].localeCompare(b['name']);
      }

      // If none are pinned, sort by balance in descending order
      return b.balance - a.balance;
    });

  return [nativeToken, ...availableTokens];
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
    return 'No Pool Found'
  }
  const tokenA = selectedTokenA.value.ticker;
  const tokenB = selectedTokenB.value.ticker === 'ADA' ? tokenA : selectedTokenB.value.ticker;
  if (!pairPriceToggle.value) {
    return `1 ${tokenB} = ${price_ba2.value?.toFixed(7)} ADA`;
  } else {
    return `1 ADA = ${price_ab2.value?.toFixed(7)} ${tokenB}`;
  }
});

watch( () => selectedTokenA.value.ticker, async (newVal, oldVal) => {
  if (isUpdating.value) return; // Prevent recursive updates
  isUpdating.value = true; // Set flag to prevent mutual watcher trigger

  if (newVal === 'ADA') {
    // If selectedTokenA is changed to ADA, set selectedTokenB to last non-ADA tokenB if exists
    if (lastNonADATokenB.value) {
      selectedTokenB.value = availableTokens.value.find(token => token['ticker'] === lastNonADATokenB.value.ticker);
    } else {
      selectedTokenB.value = availableTokens.value.find(token => token['ticker'] === oldVal);
    }
  } else {
    // Store the last non-ADA token for selectedTokenA
    lastNonADATokenA.value = { ...selectedTokenA.value };
    // Set selectedTokenB to ADA
    selectedTokenB.value = availableTokens.value.find(token => token['ticker'] === 'ADA');
  }
  await averagePrice(!selectedTokenA.value.unit ? selectedTokenA.value.ticker : selectedTokenA.value.unit, !selectedTokenB.value.unit ? selectedTokenB.value.ticker : selectedTokenB.value.unit);
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
  if (!token) return '';
  const multiplier = token.ticker === 'ADA' ? 1 : price_ba.value;

  return (Number(token.quantity.replaceAll(',', '')) * multiplier * price.lastPrice).toLocaleString('en-US');
}

const setSlippage = (val) => {
  slippageRef.value = val;
}

const switchPair = () => {
  selectedTokenA.value = selectedTokenB.value
}

const estimate = (token_in, token_out, amount_in, update) => {
  if (!appWallet) {
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
  if (!appWallet) {
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
    price_ab.value = res.net_price_reverse;
    price_ba.value = res.net_price;
    if (update) {
      total_input_without_slippage.value = res.total_input_without_slippage
      splits.value = res.splits
      estimation.value = res
      selectedTokenA.value.quantity = filters.toCurrency(total_input_without_slippage.value, false, selectedTokenA.value.decimals, '', '', false, 0);
    }
  } catch (e) {
    poolError.value = true
  }
}

const averagePrice = (token_in, token_out) => {
  if (!appWallet) {
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
  if (lastFunctionCalled.value === 'estimate') {
    const amount = Number(selectedTokenA.value.quantity.replaceAll(',', ''))
    if (amount === 0) {
      await estimate(selectedTokenA.value.unit, selectedTokenB.value.unit, 1, false);
    } else {
      await estimate(selectedTokenA.value.unit, selectedTokenB.value.unit, amount, true);
    }
  } else if (lastFunctionCalled.value === 'reverseEstimate') {
    const amount = Number(selectedTokenB.value.quantity.replaceAll(',', ''))
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
      swapRes = await dexHunterApi.swap(amount, baseAddress, selectedTokenA.value['unit'], selectedTokenB.value['unit'], slippage)
    } else if (swapType.value === 'limit') {
      const toSplit = limitType.value === 'split'
      const multiples = toSplit ? limitSplit.value : 1
      swapRes = await dexHunterApi.swapLimitBuild(amount, baseAddress, selectedTokenA.value['unit'], selectedTokenB.value['unit'], 'GeroLabs', multiples, toSplit, Number(limit.value))
    }
    const txCbor = swapRes.cbor
    const partialSign = true
    console.log('txCbor', txCbor)
    const signaturesRes: any = await Messaging.sendToBackground({
      method: METHOD.signTx,
      data: { tx: txCbor, partialSign },
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

const submit = async (cborHex) => {
  const txId = await appWallet.submitTx(Transaction.from_hex(cborHex), utxos);
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

</style>
