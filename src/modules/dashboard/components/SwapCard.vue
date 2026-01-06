<template>
  <v-card flat outlined class="liquid-glass compact-swap-widget fill-height d-flex flex-column">
    <v-card-title class="pb-2"> {{ $t('swap.title') }} </v-card-title>
    <v-card-text class="pa-0 flex-grow-1 d-flex flex-column">
      <div class="flex-grow-1 d-flex flex-column">
        <v-card-title class="pb-2 pt-0 px-3" style="font-size: 14px">
          <v-btn-toggle mandatory active-class="geroButton" v-model="swapType" dense>
            <v-btn value="swap" x-small rounded> {{ $t('swap.swap').toUpperCase() }} </v-btn>
            <v-btn value="limit" x-small rounded disabled> {{ $t('swap.limit').toUpperCase() }} </v-btn>
          </v-btn-toggle>
          <v-spacer></v-spacer>
          <v-btn icon x-small @click="refreshPrices">
            <v-icon x-small>mdi-reload</v-icon>
          </v-btn>
          <v-btn icon x-small @click="openFullSwap">
            <v-icon x-small>mdi-open-in-new</v-icon>
          </v-btn>
        </v-card-title>
        <v-card-text class="pb-0 px-3 pt-3 flex-grow-1 d-flex flex-column">
          <!-- Selling Section -->
          <div class="d-flex align-center justify-space-between mb-2">
            <span style="color: #fda29b; font-size: 12px; font-weight: 200">{{ $t('swap.selling') }}</span>
            <span class="caption grey--text">{{ $t('swap.balance') }}: {{ getTokenBalance(selectedTokenA) }}</span>
          </div>
          <v-card class="token-box" outlined style="background-color: #101828 !important; border: 1px solid #1f242f">
            <v-card-text class="py-2 px-3">
              <div class="d-flex align-center">
                <v-menu v-model="tokenMenuA" offset-y :close-on-content-click="false" max-height="400" min-width="300">
                  <template v-slot:activator="{ on, attrs }">
                    <v-btn text plain v-bind="attrs" v-on="on" class="pa-0" style="text-transform: none">
                      <v-avatar size="26" class="mr-2">
                        <img
                          v-if="selectedTokenA && selectedTokenA.img"
                          :src="selectedTokenA.img"
                          :alt="selectedTokenA.ticker"
                          @error="e => (e.target.src = assets.questionMarkDark)"
                        />
                        <v-icon v-else small>mdi-help-circle</v-icon>
                      </v-avatar>
                      <span style="font-size: 14px; font-weight: 500">{{
                        selectedTokenA ? selectedTokenA.ticker : $t('swap.select')
                      }}</span>
                      <v-icon x-small class="ml-1">mdi-chevron-down</v-icon>
                    </v-btn>
                  </template>

                  <v-card style="background-color: #1a1a1a !important">
                    <v-card-text class="pa-2">
                      <v-text-field
                        v-model="tokenSearchA"
                        dense
                        outlined
                        hide-details
                        :placeholder="$t('swap.searchTokens')"
                        prepend-inner-icon="mdi-magnify"
                        class="mb-2"
                        clearable
                        autofocus
                      ></v-text-field>
                    </v-card-text>

                    <v-divider></v-divider>

                    <v-list
                      dense
                      max-height="300"
                      class="overflow-y-auto py-0"
                      style="background-color: #1a1a1a !important"
                    >
                      <v-list-item
                        v-for="token in availableTokens"
                        :key="token.unit"
                        @click="selectToken(token, 'A')"
                        class="token-list-item"
                      >
                        <v-list-item-avatar size="32">
                          <v-img :src="token.img" @error="e => (e.target.src = assets.questionMarkDark)"></v-img>
                        </v-list-item-avatar>

                        <v-list-item-content>
                          <v-list-item-title>
                            {{ token.ticker }}
                            <v-chip v-if="token.owned" outlined x-small color="primary" class="ml-1 px-1">{{ $t('common.owned') }}</v-chip>
                          </v-list-item-title>
                          <v-list-item-subtitle class="text-truncate">
                            {{ token.name || token.unit.slice(0, 16) + '...' }}
                          </v-list-item-subtitle>
                        </v-list-item-content>

                        <v-list-item-action v-if="token.owned" class="my-0">
                          <v-list-item-action-text>
                            {{ formatBalance(token) }}
                          </v-list-item-action-text>
                        </v-list-item-action>
                      </v-list-item>
                    </v-list>
                  </v-card>
                </v-menu>
                <v-spacer></v-spacer>
                <v-text-field
                  v-model="amountA"
                  type="number"
                  hide-details
                  dense
                  flat
                  solo
                  class="text-right amount-input"
                  placeholder="0.00"
                  style="max-width: 120px"
                ></v-text-field>
              </div>
            </v-card-text>
          </v-card>

          <!-- Swap Button -->
          <v-btn
            icon
            small
            class="z-index-5 geroButton"
            @click="switchPair"
            style="height: 32px; width: 32px; margin: 8px auto; position: relative; top: 12px"
          >
            <v-icon small color="#1a1a1a">mdi-swap-vertical</v-icon>
          </v-btn>

          <!-- Buying Section -->
          <div class="d-flex align-center justify-space-between mb-2">
            <span style="color: #75e0a7; font-size: 12px; font-weight: 200">{{ $t('swap.buying') }}</span>
            <span class="caption grey--text">{{ $t('swap.balance') }}: {{ getTokenBalance(selectedTokenB) }}</span>
          </div>
          <v-card class="token-box" outlined style="background-color: #101828 !important; border: 1px solid #1f242f">
            <v-card-text class="py-2 px-3">
              <div class="d-flex align-center">
                <v-menu v-model="tokenMenuB" offset-y :close-on-content-click="false" max-height="400" min-width="300">
                  <template v-slot:activator="{ on, attrs }">
                    <v-btn text plain v-bind="attrs" v-on="on" class="pa-0" style="text-transform: none">
                      <v-avatar size="26" class="mr-2">
                        <img
                          v-if="selectedTokenB && selectedTokenB.img"
                          :src="selectedTokenB.img"
                          :alt="selectedTokenB.ticker"
                          @error="e => (e.target.src = assets.questionMarkDark)"
                        />
                        <v-icon v-else small>mdi-help-circle</v-icon>
                      </v-avatar>
                      <span style="font-size: 14px; font-weight: 500">{{
                        selectedTokenB ? selectedTokenB.ticker : $t('dashboard.selectToken')
                      }}</span>
                      <v-icon x-small class="ml-1">mdi-chevron-down</v-icon>
                    </v-btn>
                  </template>

                  <v-card style="background-color: #1a1a1a !important">
                    <v-card-text class="pa-2">
                      <v-text-field
                        v-model="tokenSearchB"
                        dense
                        outlined
                        hide-details
                        :placeholder="$t('dashboard.searchTokens')"
                        prepend-inner-icon="mdi-magnify"
                        class="mb-2"
                        clearable
                        autofocus
                      ></v-text-field>
                    </v-card-text>

                    <v-divider></v-divider>

                    <v-list
                      dense
                      max-height="300"
                      class="overflow-y-auto py-0"
                      style="background-color: #1a1a1a !important"
                    >
                      <v-list-item
                        v-for="token in filteredTokenListB"
                        :key="token.unit"
                        @click="selectToken(token, 'B')"
                        class="token-list-item"
                      >
                        <v-list-item-avatar size="32">
                          <v-img :src="token.img" @error="e => (e.target.src = assets.questionMarkDark)"></v-img>
                        </v-list-item-avatar>

                        <v-list-item-content>
                          <v-list-item-title>
                            {{ token.ticker }}
                            <v-chip v-if="token.owned" x-small color="primary" outlined class="ml-1">{{ $t('common.owned') }}</v-chip>
                          </v-list-item-title>
                          <v-list-item-subtitle class="text-truncate">
                            {{ token.name || token.unit.slice(0, 16) + '...' }}
                          </v-list-item-subtitle>
                        </v-list-item-content>

                        <v-list-item-action v-if="token.owned" class="my-0">
                          <v-list-item-action-text>
                            {{ formatBalance(token) }}
                          </v-list-item-action-text>
                        </v-list-item-action>
                      </v-list-item>
                    </v-list>
                  </v-card>
                </v-menu>
                <v-spacer></v-spacer>
                <v-text-field
                  v-model="amountB"
                  type="number"
                  hide-details
                  dense
                  flat
                  solo
                  class="text-right amount-input"
                  placeholder="0.00"
                  style="max-width: 120px"
                  readonly
                ></v-text-field>
              </div>
            </v-card-text>
          </v-card>

          <!-- Details Section -->
          <div class="text-left mt-2 mb-auto" style="display: flex">
            <v-btn text plain x-small class="px-0 no-opacity" :ripple="false" style="letter-spacing: normal" disabled>
              <v-avatar
                color="primary"
                :style="{ animationDuration: '1.5s' }"
                class="mr-1 v-avatar--metronome"
                size="10"
              />
              <span style="font-size: 11px">1 ADA = 0.00 {{ selectedTokenB ? selectedTokenB.ticker : 'TOKEN' }}</span>
            </v-btn>
            <v-spacer></v-spacer>
          </div>
        </v-card-text>
      </div>
    </v-card-text>
    <!-- Swap Button at Bottom -->
    <v-card-actions class="pa-3 pt-0">
      <v-btn
        block
        height="36"
        class="geroButton"
        @click="handleSwap"
        :disabled="!canSwap"
        style="text-transform: capitalize"
      >
        {{ swapButtonText }}
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { computed, getCurrentInstance, onMounted, ref, toRefs } from 'vue';
import { useIntervalFn } from '@vueuse/core';
import { walletStore } from '@/stores/walletStore';
import assets from '@/utils/assets';
import DexHunterStore, { dexHunterStore } from '@/stores/dexHunterStore';
import dexHunterApi from '@/api/dexhunter-api';
import filters from '@/shared/utils/filters';
import cardanoSvg from '@/assets/svg/cardano.svg';

// Router (Vue 2 style)
const instance = getCurrentInstance();
const router = instance?.proxy.$router;
const { t } = useTranslation();

// Store refs
const { loggedWallet, tokens } = toRefs(walletStore);
const { dexHunterTokens } = toRefs(dexHunterStore);

// Reactive data
const amountA = ref('');
const amountB = ref('');
const tokenMenuA = ref(false);
const tokenMenuB = ref(false);
const tokenSearchA = ref('');
const tokenSearchB = ref('');
const slippageRef = ref<string>('2');
const swapType = ref<string>('swap');
let selectedTokenA = ref({
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

let selectedTokenB = ref({
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
const blacklisted_dexes = ref<any[]>([]);
const search = ref(DexHunterStore.searchTokens);
const poolError = ref<boolean>(false);
const limit = ref<string>('0.0000000');
const limitType = ref<string>('one');
const limitSplit = ref<number>(1);

// Computed properties
const canSwap = computed(() => {
  return (
    selectedTokenA.value &&
    selectedTokenB.value &&
    selectedTokenA.value.unit !== selectedTokenB.value.unit &&
    amountA.value &&
    Number(amountA.value) > 0
  );
});

const swapButtonText = computed(() => {
  if (!selectedTokenA.value || !selectedTokenB.value) {
    return t('dashboard.selectTokens');
  }
  if (selectedTokenA.value.unit === selectedTokenB.value.unit) {
    return t('dashboard.selectDifferentTokens');
  }
  if (!amountA.value || Number(amountA.value) <= 0) {
    return t('dashboard.enterAmount');
  }
  return t('dashboard.swap');
});

const availableTokens = computed(() => {
  if (!dexHunterTokens.value) {
    return [];
  }
  const availableTokens = Object.values(dexHunterTokens.value)
    .map((token: any) => {
      const found: any = Object.values(tokens.value)?.find((t: any) => t.unit === token['unit']);
      const res = {
        ...token,
        balance: found ? found.balance : 0,
      };
      if (found) {
        if (selectedTokenB.value.unit === found.unit) {
          selectedTokenB.value.balance = res.balance;
        } else if (selectedTokenA.value.unit === found.unit) {
          selectedTokenA.value.balance = res.balance;
        }
      }
      return res;
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
  return [nativeToken, ...availableTokens];
});

// Methods
const getTokenBalance = token => {
  if (!token || !tokens.value) return '0.00';
  const tokenData = tokens.value[token.unit];
  if (tokenData && tokenData.quantity) {
    const decimals = tokenData.decimals || 6;
    const balance = Number(tokenData.quantity) / Math.pow(10, decimals);
    return balance.toFixed(2);
  }
  return '0.00';
};

const switchPair = () => {
  const temp = selectedTokenA.value;
  selectedTokenA.value = selectedTokenB.value;
  selectedTokenB.value = temp;

  const tempAmount = amountA.value;
  amountA.value = amountB.value;
  amountB.value = tempAmount;
};

const handleSwap = () => {
  if (canSwap.value) {
    openFullSwap();
  }
};

const openFullSwap = () => {
  if (router) {
    router.push('/swap');
  }
};

const refreshPrices = () => {
  // Add price refresh logic here
};

// Get all available tokens with ownership info
const getAllTokens = () => {
  const tokenList = [];

  // Add owned tokens first
  if (tokens.value) {
    // Add other owned tokens
    Object.entries(tokens.value).forEach(([unit, token]) => {
      const tok: any = token;
      if (tok.metadata?.ticker) {
        tokenList.push({
          unit,
          ticker: tok.metadata.ticker,
          name: tok.metadata.name || tok.metadata.ticker,
          img:
            assets.resolveIcon(tok.metadata.logo || tok.metadata.image || tok.metadata.icon) || assets.questionMarkDark,
          decimals: tok.decimals || 6,
          owned: true,
          quantity: tok.quantity || 0,
        });
      }
    });
  }

  Object.values(dexHunterTokens.value).forEach((token: any) => {
    if (!tokens.value || !tokens.value[token.unit]) {
      tokenList.push({
        ...token,
        decimals: 6,
        owned: false,
        quantity: 0,
      });
    }
  });

  return tokenList;
};

// Computed properties for filtered token lists
const filteredTokenListA = computed(() => {
  const allTokens = getAllTokens();

  if (!tokenSearchA.value) {
    return allTokens;
  }

  const search = tokenSearchA.value.toLowerCase();
  return allTokens.filter(
    token =>
      token.ticker.toLowerCase().includes(search) ||
      token.name.toLowerCase().includes(search) ||
      token.unit.toLowerCase().includes(search)
  );
});

const filteredTokenListB = computed(() => {
  const allTokens = getAllTokens();

  if (!tokenSearchB.value) {
    return allTokens;
  }

  const search = tokenSearchB.value.toLowerCase();
  return allTokens.filter(
    token =>
      token.ticker.toLowerCase().includes(search) ||
      token.name.toLowerCase().includes(search) ||
      token.unit.toLowerCase().includes(search)
  );
});

// Format balance for display
const formatBalance = token => {
  if (!token.owned || !token.quantity) return '0';
  const balance = Number(token.quantity) / Math.pow(10, token.decimals);
  return balance > 0.01 ? balance.toFixed(2) : balance.toFixed(6);
};

// Select a token from the list
const selectToken = (token, type) => {
  if (type === 'A') {
    selectedTokenA.value = token;
    tokenMenuA.value = false;
    tokenSearchA.value = '';
  } else {
    selectedTokenB.value = token;
    tokenMenuB.value = false;
    tokenSearchB.value = '';
  }
};

const performPeriodicEstimate = async () => {
  // Add defensive checks for undefined tokens
  if (!selectedTokenA.value || !selectedTokenB.value) {
    console.warn('Tokens not properly initialized');
    return;
  }

  if (lastFunctionCalled.value === 'estimate') {
    const quantity = selectedTokenA.value.quantity || '0';
    const amount = Number(quantity.toString().replaceAll(',', ''));
    if (amount === 0) {
      await estimate(selectedTokenA.value.unit, selectedTokenB.value.unit, 1, false);
    } else {
      await estimate(selectedTokenA.value.unit, selectedTokenB.value.unit, amount, true);
    }
  } else if (lastFunctionCalled.value === 'reverseEstimate') {
    const quantity = selectedTokenB.value.quantity || '0';
    const amount = Number(quantity.toString().replaceAll(',', ''));
    if (amount === 0) {
      await reverseEstimate(selectedTokenA.value.unit, selectedTokenB.value.unit, 1, false);
    } else {
      await reverseEstimate(selectedTokenA.value.unit, selectedTokenB.value.unit, amount, true);
    }
  }
};

const estimate = (token_in, token_out, amount_in, update) => {
  if (!loggedWallet.value) {
    return;
  }
  if (!token_in && !token_out) {
    return;
  }
  if (!amount_in) {
    total_output_without_slippage.value = 0;
    return;
  } else if (isNaN(amount_in)) {
    return;
  }
  const slippage = slippageRef.value === 'unlimited' ? '-1' : Number(slippageRef.value).toString();
  dexHunterApi
    .estimate(amount_in, token_in, token_out, Number(slippage), blacklisted_dexes.value)
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
            total_output_without_slippage.value,
            false,
            selectedTokenB.value.decimals,
            '',
            '',
            false,
            0
          );
        }
      }
    })
    .catch(_e => {
      poolError.value = true;
    });
};

const reverseEstimate = async (token_in, token_out, amount_out, update) => {
  if (!loggedWallet.value) {
    return;
  }
  if (!token_in && !token_out) {
    return;
  }
  if (!amount_out) {
    total_input_without_slippage.value = 0;
    return;
  } else if (isNaN(amount_out)) {
    return;
  }
  const slippage = slippageRef.value === 'unlimited' ? -1 : Number(slippageRef.value);
  try {
    const res = await dexHunterApi.reverseEstimate(amount_out, token_in, token_out, slippage, blacklisted_dexes.value);
    poolError.value = false;
    price_ab.value = res.net_price_reverse;
    price_ba.value = res.net_price;
    if (update) {
      total_input_without_slippage.value = res.total_input_without_slippage;
      splits.value = res.splits;
      estimation.value = res;
      selectedTokenA.value.quantity = filters.toCurrency(
        total_input_without_slippage.value,
        false,
        selectedTokenA.value.decimals,
        '',
        '',
        false,
        0
      );
    }
  } catch (e) {
    poolError.value = true;
  }
};

const averagePrice = (token_in, token_out) => {
  if (!loggedWallet.value) {
    return;
  }
  if (!token_in && !token_out) {
    return;
  }
  dexHunterApi
    .getAveragePrice(token_in, token_out)
    .then(res => {
      price_ab2.value = res.price_ab;
      price_ba2.value = res.price_ba;
      limit.value = structuredClone(price_ba2.value).toString();
    })
    .catch(() => {
      // console.log(e)
    });
};

const { pause: pauseEstimate, resume: resumeEstimate } = useIntervalFn(
  performPeriodicEstimate,
  10000,
  { immediate: false }
);

// Initialize with default tokens
onMounted(async () => {
  await averagePrice(
    !selectedTokenA.value.unit ? selectedTokenA.value.ticker : selectedTokenA.value.unit,
    !selectedTokenB.value.unit ? selectedTokenB.value.ticker : selectedTokenB.value.unit
  );
  resumeEstimate();
});

});
</script>

<style scoped>
.compact-swap-widget {
  width: 100%;
  height: 100%;
}

.geroButton {
  background: linear-gradient(45deg, #00c7f3, #00ffd1) !important;
  color: black !important;
  text-transform: capitalize !important;
  font-weight: 600 !important;
}

.z-index-5 {
  z-index: 5;
}

.no-opacity:hover::before {
  opacity: 0 !important;
}

.v-avatar--metronome:before {
  animation: metronome-animation 1.5s ease-in-out infinite;
  background-color: currentColor;
  bottom: 0;
  content: '';
  left: 0;
  opacity: 0;
  position: absolute;
  right: 0;
  top: 0;
  transition: 0.3s cubic-bezier(0.25, 0.8, 0.5, 1);
}

@keyframes metronome-animation {
  0% {
    opacity: 0.1;
    transform: scale(1);
  }
  50% {
    opacity: 0.25;
    transform: scale(1.2);
  }
  100% {
    opacity: 0.1;
    transform: scale(1);
  }
}

.token-box {
  border-radius: 8px;
  transition: all 0.2s ease;
}

.token-box:hover {
  border-color: #2a3038 !important;
}

.amount-input >>> .v-input__control {
  min-height: 32px !important;
}

.amount-input >>> .v-input__slot {
  padding: 0 !important;
  background: transparent !important;
}

.amount-input >>> input {
  text-align: right;
  font-size: 18px;
  font-weight: 500;
}

.amount-input >>> .v-input__slot:before {
  border: none !important;
}

/* Removed negative margins as we're now using proper spacing */

.my-2 {
  margin-top: 8px !important;
  margin-bottom: 8px !important;
}

.z-index-5 {
  z-index: 5 !important;
  display: block !important;
  margin-left: auto !important;
  margin-right: auto !important;
}

.token-list-item {
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.token-list-item:hover {
  background-color: rgba(255, 255, 255, 0.05);
}
</style>
