<template>
  <v-card flat outlined class="liquid-glass compact-swap-widget fill-height d-flex flex-column">
    <v-card-title class="pb-2">
      Swap
    </v-card-title>
    <v-card-text class="pa-0 flex-grow-1 d-flex flex-column">
      <div class="flex-grow-1 d-flex flex-column">
        <v-card-title class="pb-2 pt-0 px-3" style="font-size: 14px;">
          <v-btn-toggle mandatory active-class="geroButton" v-model="swapType" dense>
            <v-btn value="swap" x-small rounded>
              SWAP
            </v-btn>
            <v-btn value="limit" x-small rounded disabled>
              LIMIT
            </v-btn>
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
            <span style="color: #FDA29B; font-size: 12px; font-weight: 200;">Selling</span>
            <span class="caption grey--text">Balance: {{ getTokenBalance(selectedTokenA) }}</span>
          </div>
          <v-card class="token-box" outlined style="background-color: #101828 !important; border: 1px solid #1F242F;">
            <v-card-text class="py-2 px-3">
              <div class="d-flex align-center">
                <v-menu
                  v-model="tokenMenuA"
                  offset-y
                  :close-on-content-click="false"
                  max-height="400"
                  min-width="300"
                >
                  <template v-slot:activator="{ on, attrs }">
                    <v-btn text plain v-bind="attrs" v-on="on" class="pa-0" style="text-transform: none;">
                      <v-avatar size="26" class="mr-2">
                        <img v-if="selectedTokenA && selectedTokenA.img" :src="selectedTokenA.img" :alt="selectedTokenA.ticker" @error="(e) => e.target.src = assets.questionMarkDark" />
                        <v-icon v-else small>mdi-help-circle</v-icon>
                      </v-avatar>
                      <span style="font-size: 14px; font-weight: 500;">{{ selectedTokenA ? selectedTokenA.ticker : 'Select' }}</span>
                      <v-icon x-small class="ml-1">mdi-chevron-down</v-icon>
                    </v-btn>
                  </template>
                  
                  <v-card style="background-color: #1a1a1a !important;">
                    <v-card-text class="pa-2">
                      <v-text-field
                        v-model="tokenSearchA"
                        dense
                        outlined
                        hide-details
                        placeholder="Search tokens"
                        prepend-inner-icon="mdi-magnify"
                        class="mb-2"
                        clearable
                        autofocus
                      ></v-text-field>
                    </v-card-text>
                    
                    <v-divider></v-divider>
                    
                    <v-list dense max-height="300" class="overflow-y-auto py-0" style="background-color: #1a1a1a !important;">
                      <v-list-item
                        v-for="token in filteredTokenListA"
                        :key="token.unit"
                        @click="selectToken(token, 'A')"
                        class="token-list-item"
                      >
                        <v-list-item-avatar size="32">
                          <v-img 
                            :src="token.img" 
                            @error="(e) => e.target.src = assets.questionMarkDark"
                          ></v-img>
                        </v-list-item-avatar>
                        
                        <v-list-item-content>
                          <v-list-item-title>
                            {{ token.ticker }}
                            <v-chip v-if="token.owned" x-small color="primary" class="ml-1">Owned</v-chip>
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
                  style="max-width: 120px;"
                ></v-text-field>
              </div>
            </v-card-text>
          </v-card>

          <!-- Swap Button -->
          <v-btn icon small class="z-index-5 geroButton" @click="switchPair" style="height: 32px; width: 32px; margin: 8px auto; position: relative; top: 12px;">
            <v-icon small color="#1a1a1a">mdi-swap-vertical</v-icon>
          </v-btn>

          <!-- Buying Section -->
          <div class="d-flex align-center justify-space-between mb-2">
            <span style="color: #75E0A7; font-size: 12px; font-weight: 200;">Buying</span>
            <span class="caption grey--text">Balance: {{ getTokenBalance(selectedTokenB) }}</span>
          </div>
          <v-card class="token-box" outlined style="background-color: #101828 !important; border: 1px solid #1F242F;">
            <v-card-text class="py-2 px-3">
              <div class="d-flex align-center">
                <v-menu
                  v-model="tokenMenuB"
                  offset-y
                  :close-on-content-click="false"
                  max-height="400"
                  min-width="300"
                >
                  <template v-slot:activator="{ on, attrs }">
                    <v-btn text plain v-bind="attrs" v-on="on" class="pa-0" style="text-transform: none;">
                      <v-avatar size="26" class="mr-2">
                        <img v-if="selectedTokenB && selectedTokenB.img" :src="selectedTokenB.img" :alt="selectedTokenB.ticker" @error="(e) => e.target.src = assets.questionMarkDark" />
                        <v-icon v-else small>mdi-help-circle</v-icon>
                      </v-avatar>
                      <span style="font-size: 14px; font-weight: 500;">{{ selectedTokenB ? selectedTokenB.ticker : 'Select' }}</span>
                      <v-icon x-small class="ml-1">mdi-chevron-down</v-icon>
                    </v-btn>
                  </template>
                  
                  <v-card style="background-color: #1a1a1a !important;">
                    <v-card-text class="pa-2">
                      <v-text-field
                        v-model="tokenSearchB"
                        dense
                        outlined
                        hide-details
                        placeholder="Search tokens"
                        prepend-inner-icon="mdi-magnify"
                        class="mb-2"
                        clearable
                        autofocus
                      ></v-text-field>
                    </v-card-text>
                    
                    <v-divider></v-divider>
                    
                    <v-list dense max-height="300" class="overflow-y-auto py-0" style="background-color: #1a1a1a !important;">
                      <v-list-item
                        v-for="token in filteredTokenListB"
                        :key="token.unit"
                        @click="selectToken(token, 'B')"
                        class="token-list-item"
                      >
                        <v-list-item-avatar size="32">
                          <v-img 
                            :src="token.img" 
                            @error="(e) => e.target.src = assets.questionMarkDark"
                          ></v-img>
                        </v-list-item-avatar>
                        
                        <v-list-item-content>
                          <v-list-item-title>
                            {{ token.ticker }}
                            <v-chip v-if="token.owned" x-small color="primary" class="ml-1">Owned</v-chip>
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
                  style="max-width: 120px;"
                  readonly
                ></v-text-field>
              </div>
            </v-card-text>
          </v-card>

          <!-- Details Section -->
          <div class="text-left mt-2 mb-auto" style="display: flex;">
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
        style="text-transform: capitalize;"
      >
        {{ swapButtonText }}
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed, toRefs, getCurrentInstance, onMounted } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import assets from '@/utils/assets';

// Router (Vue 2 style)
const instance = getCurrentInstance();
const router = instance?.proxy.$router;

// Store refs
const { loggedWallet, tokens } = toRefs(walletStore);
const { assets: networkAssets } = toRefs(networkStore);

// Reactive data
const swapType = ref('swap');
const selectedTokenA = ref(null);
const selectedTokenB = ref(null);
const amountA = ref('');
const amountB = ref('');
const tokenMenuA = ref(false);
const tokenMenuB = ref(false);
const tokenSearchA = ref('');
const tokenSearchB = ref('');

// Computed properties
const canSwap = computed(() => {
  return selectedTokenA.value && selectedTokenB.value && 
         selectedTokenA.value.unit !== selectedTokenB.value.unit &&
         amountA.value && Number(amountA.value) > 0;
});

const swapButtonText = computed(() => {
  if (!selectedTokenA.value || !selectedTokenB.value) {
    return 'Select Tokens';
  }
  if (selectedTokenA.value.unit === selectedTokenB.value.unit) {
    return 'Select Different Tokens';
  }
  if (!amountA.value || Number(amountA.value) <= 0) {
    return 'Enter Amount';
  }
  return 'Swap';
});

// Methods
const getTokenBalance = (token) => {
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
  console.log('Refreshing prices...');
  // Add price refresh logic here
};

// Get all available tokens with ownership info
const getAllTokens = () => {
  const tokenList = [];
  
  // Add owned tokens first
  if (tokens.value) {
    // Add ADA if owned
    if (tokens.value['lovelace']) {
      tokenList.push({
        unit: 'lovelace',
        ticker: 'ADA',
        name: 'Cardano',
        img: assets.adaTokenImage,
        decimals: 6,
        owned: true,
        quantity: tokens.value['lovelace'].quantity || 0
      });
    }
    
    // Add other owned tokens
    Object.entries(tokens.value).forEach(([unit, token]) => {
      if (unit !== 'lovelace' && token.metadata?.ticker) {
        tokenList.push({
          unit,
          ticker: token.metadata.ticker,
          name: token.metadata.name || token.metadata.ticker,
          img: assets.resolveIcon(token.metadata.logo || token.metadata.image || token.metadata.icon) || assets.questionMarkDark,
          decimals: token.decimals || 6,
          owned: true,
          quantity: token.quantity || 0
        });
      }
    });
  }
  
  // Add popular tokens that are not owned (you can expand this list)
  const popularTokens = [
    { unit: 'min', ticker: 'MIN', name: 'Minswap', img: 'https://tokens.muesliswap.com/static/img/tokens/MIN.png' },
    { unit: 'snek', ticker: 'SNEK', name: 'Snek', img: 'https://tokens.muesliswap.com/static/img/tokens/SNEK.png' },
    { unit: 'wmt', ticker: 'WMT', name: 'World Mobile Token', img: 'https://tokens.muesliswap.com/static/img/tokens/WMT.png' }
  ];
  
  popularTokens.forEach(token => {
    if (!tokens.value || !tokens.value[token.unit]) {
      tokenList.push({
        ...token,
        decimals: 6,
        owned: false,
        quantity: 0
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
  return allTokens.filter(token => 
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
  return allTokens.filter(token => 
    token.ticker.toLowerCase().includes(search) ||
    token.name.toLowerCase().includes(search) ||
    token.unit.toLowerCase().includes(search)
  );
});

// Format balance for display
const formatBalance = (token) => {
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

// Get a list of common tokens to cycle through
const getCommonTokens = () => {
  if (!tokens.value) return [];
  
  const tokenList = [];
  
  // Add ADA first
  if (tokens.value['lovelace']) {
    tokenList.push({
      unit: 'lovelace',
      ticker: 'ADA',
      img: assets.adaTokenImage,
      decimals: 6
    });
  }
  
  // Add other tokens
  Object.entries(tokens.value).forEach(([unit, token]) => {
    if (unit !== 'lovelace' && token.metadata?.ticker) {
      tokenList.push({
        unit,
        ticker: token.metadata.ticker,
        img: assets.resolveIcon(token.metadata.logo || token.metadata.image || token.metadata.icon) || assets.questionMarkDark,
        decimals: token.decimals || 6
      });
    }
  });
  
  return tokenList.slice(0, 10); // Limit to first 10 tokens
};


// Initialize with default tokens
onMounted(() => {
  const tokenList = getCommonTokens();
  if (tokenList.length > 0) {
    selectedTokenA.value = tokenList[0]; // ADA
    if (tokenList.length > 1) {
      selectedTokenB.value = tokenList[1]; // First other token
    }
  }
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
  content: "";
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