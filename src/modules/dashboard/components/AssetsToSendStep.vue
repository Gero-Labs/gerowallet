<template>
  <v-card flat class="transparent">
    <v-card-text class="pa-0">
      <v-row no-gutters>
        <v-col
          :cols="collectiblesCount > 0 ? 6 : 12"
          class="selectors-container px-2"
          :style="collectiblesCount > 0 ? {} : { alignItems: 'center' }"
        >
          <v-card
            flat
            outlined
            class="pa-2 fill-height transparent"
            style="height: 487px; overflow: auto; max-width: 350px"
          >
            <TokenSelector
              v-for="(token, index) in tokenModel"
              :key="index"
              class="pb-1"
              background-color="#161B26"
              v-model="tokenModel[index]"
              :available="getAvailableTokens(index)"
              :index="index"
              @remove="removeTokenSelector"
              :price="getPrice(token)"
              :minimum="index === 0 && value ? value.minAda : 0"
              :ada-shortage="index === 0 && value ? value.adaShortage : 0"
              @setMax="setMax"
              :token-lock="index === 0"
            ></TokenSelector>
            <v-card-text
              v-if="tokenModel.length > 0 && (totalAmounts.totalAda > 0 || totalAmounts.totalUsd > 0)"
              class="pa-2 text-center"
              style="border-top: 1px solid rgba(255, 255, 255, 0.1); margin-top: 8px"
            >
              <div class="text-caption" style="color: rgba(255, 255, 255, 0.7); margin-bottom: 4px">
                {{ $t('common.total') }}
              </div>
              <div class="text-body-2 font-weight-medium" style="color: #00c7f3">
                {{ totalAmounts.formattedAda }}
              </div>
              <div class="text-caption" style="color: rgba(255, 255, 255, 0.5); margin-top: 2px">
                {{ totalAmounts.formattedUsd }} • {{ totalAmounts.formattedEur }}
              </div>
            </v-card-text>
            <v-card-actions class="justify-center text-center" v-if="missingTokens?.length > 0">
              <v-btn text class="add-token-button" @click="addToken">
                <v-icon class="plus-icon" color="#00c7f3" small>mdi-plus</v-icon>
                {{ $t('assets.addToken') }}
              </v-btn>
            </v-card-actions>
          </v-card>
        </v-col>
        <v-col cols="6" class="collectibles px-2" v-if="collectiblesCount > 0">
          <v-card flat outlined>
            <v-card-title class="justify-center">{{ $t('assets.chooseCollectibles') }}</v-card-title>
            <v-card-subtitle class="pb-0">
              <v-text-field
                v-model="search"
                :placeholder="$t('assets.searchCollectibles')"
                outlined
                dense
                hide-details
                class="mb-4"
              ></v-text-field>
            </v-card-subtitle>
            <v-card-text style="overflow-y: auto; height: 382px; text-align: left">
              <v-item-group v-model="selectedCollectibles" multiple>
                <template v-for="(collection, index) in collections">
                  <div v-if="collection.items" :key="`collection_${index}`">
                    <span style="font-size: 10px">{{ `${collection.name} (${collection.items.length})` }}</span>
                    <v-row :key="index" no-gutters>
                      <v-col
                        v-for="(item, itemIndex) in collection.items"
                        :key="`${item.name}_${itemIndex}`"
                        cols="12"
                        sm="4"
                        xs="12"
                        class="pa-1"
                      >
                        <v-item v-slot="{ active, toggle }" :value="item">
                          <div>
                            <v-hover>
                              <template v-slot:default="{ hover }">
                                <v-card
                                  flat
                                  class="justify-center text-center px-1 shadow collectible-item"
                                  :style="
                                    active
                                      ? {
                                          backgroundImage: `linear-gradient(#ffffff00, #000000b3), url(${item.img})`,
                                          border: '2px solid #00c7f3',
                                        }
                                      : {
                                          backgroundImage: `linear-gradient(#ffffff00, #000000b3), url(${item.img})`,
                                          border: '2px solid #00c7f300',
                                        }
                                  "
                                  @click="toggle"
                                >
                                  <div style="top: 0; position: absolute; display: flex" v-if="item.isScam">
                                    <v-chip x-small color="#F97066" class="px-2">
                                      <v-icon color="white" x-small style="margin-right: 3px">
                                        mdi-alert-decagram </v-icon
                                      >{{ $t('assets.scamToken') }}
                                    </v-chip>
                                  </div>
                                  <div class="collectible-text-container">
                                    <span class="collectible-text">{{ item.name }}</span>
                                  </div>
                                  <v-scroll-y-transition>
                                    <v-avatar
                                      color="#00c7f3"
                                      v-if="active"
                                      size="14"
                                      style="position: absolute; right: 4px; top: 4px"
                                    >
                                      <v-icon color="black" x-small> mdi-check-bold </v-icon>
                                    </v-avatar>
                                  </v-scroll-y-transition>
                                  <v-overlay v-if="hover" absolute color="#ffffff"> </v-overlay>
                                </v-card>
                              </template>
                            </v-hover>
                            <div style="display: inline-flex; place-items: center" v-if="item.quantity > 1 && active">
                              <v-btn icon x-small @click="decreaseQuantityToSend(item)">
                                <v-icon color="#00DFF3" small>mdi-minus-box-outline</v-icon>
                              </v-btn>
                              <input
                                v-model="item.toSendQuantity"
                                type="number"
                                :min="1"
                                :max="item.quantity"
                                style="text-align: center; height: 16px; color: white; width: 54px; font-size: 10px"
                              />
                              <v-btn icon x-small @click="increaseQuantityToSend(item)">
                                <v-icon color="#00DFF3" small>mdi-plus-box-outline</v-icon>
                              </v-btn>
                            </div>
                          </div>
                        </v-item>
                      </v-col>
                    </v-row>
                    <v-divider></v-divider>
                  </div>
                </template>
              </v-item-group>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </v-card-text>
  </v-card>
</template>
<script setup lang="ts">
import { toRefs, computed, watch, onMounted, ref } from 'vue';
import TokenSelector from '@/shared/components/TokenSelector.vue';
import networks from '@/utils/networks';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { priceStore } from '@/stores/priceStore';
import { dexHunterStore } from '@/stores/dexHunterStore';
import filters from '@/shared/utils/filters';
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';

interface Props {
  value: any;
  tokens: any[];
}

const props = defineProps<Props>();
const emit = defineEmits(['input', 'setMax']);

const { loggedWallet, collections: resolvedCollections } = toRefs(walletStore);
const { price } = toRefs(networkStore);

const selectedCollectibles = ref<any[]>([]);
const search = ref<string>('');
const selectedTokens = ref<any[]>([]);

const { convertFiat } = useCurrencyConverter();

// Get token price from tokens list (same logic as TokensTab)
function getTokenPriceInUsd(token: any): number {
  if (!token) return 0;

  // Find full token info from props.tokens
  const fullToken = props.tokens.find(
    t => t.ticker === token.ticker || t.unit === token.unit || t.metadata?.ticker === token.ticker
  );

  const nativeTicker = networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network);

  // For native tokens (ADA)
  if (token.ticker === nativeTicker || fullToken?.policy_id === '') {
    return priceStore.adaUsd?.lastPrice || Number(price.value?.lastPrice) || 0;
  }

  // For other tokens: get price from DexHunter (in ADA), convert to USD
  const unit = token.unit || fullToken?.unit;
  if (unit && dexHunterStore.dexHunterTokens[unit]) {
    const priceInAda = dexHunterStore.dexHunterTokens[unit].price || 0;
    const adaPriceUsd = priceStore.adaUsd?.lastPrice || Number(price.value?.lastPrice) || 0;
    return priceInAda * adaPriceUsd;
  }

  // Fallback to last_price if available
  return token.last_price || fullToken?.last_price || 0;
}

const missingTokens = computed(() => {
  const existingTokens = selectedTokens.value.map(token => token?.ticker);
  return props.tokens.filter(token => !existingTokens.includes(token.ticker));
});

const tokenModel = computed({
  get() {
    return props.value?.selectedTokens || [];
  },
  set(newTokens) {
    emit('input', {
      ...props.value,
      selectedTokens: newTokens,
      selectedCollectibles: selectedCollectibles.value,
    });
  },
});

const collectiblesCount = computed(() => {
  let count: number = 0;
  let collections: any[] = Object.values(resolvedCollections.value);
  collections.forEach(collection => {
    count += collection.items.length;
  });
  return count;
});

const collections = computed(() => {
  let collections: any[] = Object.values(resolvedCollections.value);
  if (search.value) {
    collections = collections
      .map(collection => {
        return {
          ...collection,
          items: collection.items.filter(item => item.name.toLowerCase().includes(search.value.toLowerCase())),
        };
      })
      .filter(collection => collection.items.length > 0);
  }
  if (collections) {
    return collections.map(collection => {
      collection.items.map(item => {
        if (item['toSendQuantity'] === undefined) {
          item['toSendQuantity'] = 1;
        }
        return item;
      });
      return collection;
    });
  }
  return collections;
});

// Get token price in ADA (for direct conversion, not through USD)
function getTokenPriceInAda(token: any): number {
  if (!token) return 0;

  // Find full token info from props.tokens
  const fullToken = props.tokens.find(
    t => t.ticker === token.ticker || t.unit === token.unit || t.metadata?.ticker === token.ticker
  );

  const nativeTicker = networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network);

  // For native tokens (ADA), price is 1 ADA per ADA
  if (token.ticker === nativeTicker || fullToken?.policy_id === '') {
    return 1;
  }

  // For other tokens: get price from DexHunter (already in ADA)
  const unit = token.unit || fullToken?.unit;
  if (unit && dexHunterStore.dexHunterTokens[unit]) {
    return dexHunterStore.dexHunterTokens[unit].price || 0;
  }

  // Fallback: if we have USD price, convert to ADA
  const tokenPriceUsd = getTokenPriceInUsd(token);
  const adaPriceUsd = priceStore.adaUsd?.lastPrice || Number(price.value?.lastPrice) || 0;
  if (tokenPriceUsd > 0 && adaPriceUsd > 0) {
    return tokenPriceUsd / adaPriceUsd;
  }

  return 0;
}

// Calculate total amounts being sent
const totalAmounts = computed(() => {
  const nativeTicker = networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network);
  let totalAda = 0; // Native ADA amount
  let totalAdaEquivalent = 0; // ADA equivalent from other tokens
  let totalUsd = 0;

  // Process all selected tokens
  tokenModel.value.forEach(token => {
    if (!token) return;

    // Parse quantity (may be string with formatting like commas)
    const quantityStr = String(token.quantity || '0')
      .replace(/,/g, '')
      .replace(/\s/g, '');
    const tokenAmount = parseFloat(quantityStr);
    if (!tokenAmount || tokenAmount <= 0 || isNaN(tokenAmount)) return;

    // Find full token info to check policy_id
    const fullToken = props.tokens.find(
      t => t.ticker === token.ticker || t.unit === token.unit || t.metadata?.ticker === token.ticker
    );

    // Calculate ADA amount for native token (quantity already in ADA, not lovelace)
    // Check by ticker match or policy_id === '' (empty policy_id means native token)
    const isNativeToken =
      token.ticker === nativeTicker ||
      fullToken?.policy_id === '' ||
      token.policy_id === '' ||
      !token.unit ||
      token.unit === '';

    if (isNativeToken) {
      totalAda += tokenAmount;
    } else {
      // For non-native tokens: get price in ADA and calculate equivalent
      const tokenPriceInAda = getTokenPriceInAda(token);
      totalAdaEquivalent += tokenAmount * tokenPriceInAda;
    }

    // Get token price in USD for USD/EUR totals
    const tokenPriceUsd = getTokenPriceInUsd(token);
    totalUsd += tokenAmount * tokenPriceUsd;
  });

  // Convert to EUR
  const totalEur = convertFiat(totalUsd, true);

  // Total ADA = native ADA amount + equivalent ADA from other tokens
  const totalAdaAll = totalAda + totalAdaEquivalent;

  return {
    totalAda,
    totalAdaEquivalent,
    totalAdaAll,
    totalUsd,
    totalEur,
    formattedAda: totalAdaAll > 0 ? filters.toCurrency(totalAdaAll * 1e6, false, 6, '₳', '', false, 6) : '₳0',
    formattedUsd:
      totalUsd > 0
        ? `$${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : '$0.00',
    formattedEur:
      totalEur > 0
        ? `€${totalEur.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : '€0.00',
  };
});

// Remove this watch - it's causing unnecessary updates and conflicts with the tokenModel computed property
// The tokenModel computed property already handles the binding to props.value.selectedTokens

function getAvailableTokens(currentIndex) {
  const currentSelected = tokenModel.value[currentIndex];
  // Collect tickers that have been selected in other selectors
  const selectedTickers = tokenModel.value
    .filter((token, index) => index !== currentIndex && token)
    .map(token => token.ticker);

  return props.tokens.filter(token => {
    // Always include the token already selected in the current selector.
    if (currentSelected && token.ticker === currentSelected.ticker) {
      return true;
    }
    // Otherwise, include tokens not selected elsewhere.
    return !selectedTickers.includes(token.ticker);
  });
}

function getPrice(token) {
  if (!token) return '';

  // Get token price per unit (same logic as getTokenPriceInUsd)
  const nativeTicker = networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network);

  // For native tokens (ADA)
  if (token.ticker === nativeTicker || token.policy_id === '') {
    const priceUsd = priceStore.adaUsd?.lastPrice || Number(price.value?.lastPrice) || 0;
    return priceUsd > 0 ? priceUsd.toString() : '';
  }

  // For other tokens: get price from DexHunter (in ADA), convert to USD
  const unit = token.unit;
  if (unit && dexHunterStore.dexHunterTokens[unit]) {
    const priceInAda = dexHunterStore.dexHunterTokens[unit].price || 0;
    const adaPriceUsd = priceStore.adaUsd?.lastPrice || Number(price.value?.lastPrice) || 0;
    const priceUsd = priceInAda * adaPriceUsd;
    return priceUsd > 0 ? priceUsd.toString() : '';
  }

  // Fallback to last_price if available
  const lastPrice = token.last_price || 0;
  return lastPrice > 0 ? lastPrice.toString() : '';
}

function decreaseQuantityToSend(item) {
  if (item.toSendQuantity > 1) {
    item.toSendQuantity--;
  }
}

function increaseQuantityToSend(item) {
  if (item.toSendQuantity < item.quantity) {
    item.toSendQuantity++;
  }
}

function removeTokenSelector(index) {
  const updatedTokens = [...tokenModel.value];
  updatedTokens.splice(index, 1);
  tokenModel.value = updatedTokens;
}

function addToken() {
  const existingTickers = tokenModel.value.map(token => token?.ticker);
  const missing = props.tokens.filter(token => !existingTickers.includes(token.ticker));
  if (missing.length > 0) {
    tokenModel.value = [...tokenModel.value, missing[0]];
  }
}

function setMax(index) {
  emit('setMax', index);
}

// Removed watch on selectedTokens - tokenModel computed setter handles this
// Removed redundant watch - using direct v-item-group binding instead

watch(
  selectedCollectibles,
  (newVal, _oldVal) => {
    newVal.forEach(collectible => {
      if (collectible.toSendQuantity > collectible.quantity) {
        collectible.toSendQuantity = collectible.quantity;
      } else if (collectible.toSendQuantity < 1) {
        collectible.toSendQuantity = 1;
      }
    });
    emit('input', {
      ...props.value,
      selectedCollectibles: newVal,
    });
  },
  {
    deep: true,
  }
);

onMounted(() => {
  const currencyTicker = networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network);
  const foundAsset = props.tokens.find(token => token.ticker === currencyTicker);
  if (foundAsset) {
    foundAsset.verified = true;
    selectedTokens.value = [foundAsset];
  }
});
</script>

<style scoped>
.continue-button {
  background: linear-gradient(to right, #00c7f3, #00fad5);
  color: black;

  &:disabled {
    opacity: 0.5;
    color: black !important;
  }
}

.sections-container {
  display: flex;
  gap: 40px;
  height: 400px;
  margin-bottom: 50px;
}

.selectors-container {
  display: flex;
  flex-direction: column;

  .add-token-button {
    width: fit-content;
    align-self: center;

    .plus-icon {
      border: 2px solid #00c7f3;
      border-radius: 5px;
      margin-right: 10px;
    }
  }
}
.collectibles-collection {
  margin-top: 20px;

  .collectible-items {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: space-between;
  }
}
.collectible-item {
  height: 102px;
  background-position: center;
  align-content: end;
  background-size: cover;
}

.collectible-text-container {
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: normal;
}
.collectible-text {
  font-size: 11px;
  font-weight: 500;
  text-align: center;
  line-height: 1;
  letter-spacing: -0.7px;
  display: block;
}
/* Chrome, Safari, Edge, Opera */
input::-webkit-outer-spin-button,
input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

/* Firefox */
input[type='number'] {
  -moz-appearance: textfield;
}
</style>
