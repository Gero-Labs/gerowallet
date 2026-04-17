<template>
  <div class="assets-to-send">
    <!-- Token selectors -->
    <div class="token-list">
      <TokenSelector
        v-for="(token, index) in tokenModel"
        :key="index"
        class="token-row"
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
      />

      <!-- Add Token button -->
      <div v-if="missingTokens?.length > 0" class="add-token-row">
        <v-btn text class="add-token-button" @click="addToken()">
          <v-icon class="plus-icon" color="#00c7f3" small>mdi-plus</v-icon>
          {{ $t('assets.addToken') }}
        </v-btn>
      </div>
    </div>

    <!-- Total line -->
    <div
      v-if="tokenModel.length > 0 && (totalAmounts.totalAda > 0 || totalAmounts.totalUsd > 0)"
      class="total-line"
    >
      <span class="total-label">{{ $t('common.total') }}</span>
      <div class="total-values">
        <span class="total-ada">{{ totalAmounts.formattedAda }}</span>
        <span class="total-fiat">{{ totalAmounts.formattedUsd }} &bull; {{ totalAmounts.formattedEur }}</span>
      </div>
    </div>

    <!-- Collectibles section -->
    <div v-if="collectiblesCount > 0" class="collectibles-section">
      <!-- Selected collectibles chips -->
      <div v-if="selectedCollectibles.length > 0" class="selected-collectibles">
        <div
          v-for="(item, idx) in selectedCollectibles"
          :key="`sel-${item.fingerprint || idx}`"
          class="collectible-chip"
        >
          <v-avatar size="24" class="mr-1" tile>
            <v-img :src="item.img" />
          </v-avatar>
          <span class="chip-name">{{ item.name }}</span>
          <span v-if="item.toSendQuantity > 1" class="chip-qty">x{{ item.toSendQuantity }}</span>
          <v-btn icon x-small class="chip-remove" @click="removeCollectible(idx)">
            <v-icon x-small color="rgba(255,255,255,0.5)">mdi-close</v-icon>
          </v-btn>
        </div>
      </div>

      <!-- Open collectibles dialog button -->
      <v-btn
        text
        class="add-collectibles-button"
        @click="$emit('openCollectiblesDialog')"
      >
        <v-icon small color="#00c7f3" class="mr-1">mdi-image-multiple-outline</v-icon>
        <span v-if="selectedCollectibles.length > 0" class="collectibles-btn-label">
          {{ $t('assets.chooseCollectibles') }}
        </span>
        <span v-else class="collectibles-btn-label">
          {{ $t('assets.addCollectibles', { count: collectiblesCount }) }}
        </span>
      </v-btn>
    </div>
  </div>
</template>
<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
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
  /** Fingerprints of NFTs fully allocated to other recipient cards — hidden from picker */
  excludedCollectibleFingerprints?: Set<string>;
  /** When true, uses compact height for inline use inside a recipient card */
  compact?: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits(['input', 'setMax', 'openCollectiblesDialog']);

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
  let count = 0;
  const cols: any[] = Object.values(resolvedCollections.value);
  cols.forEach(collection => {
    count += collection.items.length;
  });
  return count;
});

const collections = computed(() => {
  let cols: any[] = Object.values(resolvedCollections.value);
  if (search.value) {
    cols = cols
      .map(collection => {
        return {
          ...collection,
          items: collection.items.filter(item => item.name.toLowerCase().includes(search.value.toLowerCase())),
        };
      })
      .filter(collection => collection.items.length > 0);
  }
  // Filter out NFTs already committed to other recipient cards
  const excluded = props.excludedCollectibleFingerprints ?? new Set<string>();
  if (excluded.size > 0) {
    cols = cols.map(collection => ({
      ...collection,
      items: collection.items.filter((item: any) =>
        !excluded.has(item.fingerprint)
      ),
    })).filter(collection => collection.items.length > 0);
  }
  if (cols) {
    return cols.map(collection => {
      collection.items.map(item => {
        if (item['toSendQuantity'] === undefined) {
          item['toSendQuantity'] = 1;
        }
        return item;
      });
      return collection;
    });
  }
  return cols;
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

function getAvailableTokens(currentIndex: number) {
  const currentSelected = tokenModel.value[currentIndex];
  // Collect tickers that have been selected in other selectors
  const selectedTickers = tokenModel.value
    .filter((token: any, index: number) => index !== currentIndex && token)
    .map((token: any) => token.ticker);

  return props.tokens.filter(token => {
    // Always include the token already selected in the current selector.
    if (currentSelected && token.ticker === currentSelected.ticker) {
      return true;
    }
    // Otherwise, include tokens not selected elsewhere.
    return !selectedTickers.includes(token.ticker);
  });
}

function getPrice(token: any) {
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

function decreaseQuantityToSend(item: any) {
  if (item.toSendQuantity > 1) {
    item.toSendQuantity--;
  }
}

function increaseQuantityToSend(item: any) {
  if (item.toSendQuantity < item.quantity) {
    item.toSendQuantity++;
  }
}

function removeTokenSelector(index: number) {
  const updatedTokens = [...tokenModel.value];
  updatedTokens.splice(index, 1);
  tokenModel.value = updatedTokens;
}

function addToken() {
  const existingTickers = tokenModel.value.map((token: any) => token?.ticker);
  const missing = props.tokens.filter(token => !existingTickers.includes(token.ticker));
  if (missing.length > 0) {
    tokenModel.value = [...tokenModel.value, missing[0]];
  }
}

function setMax(index: number) {
  emit('setMax', index);
}

function removeCollectible(index: number) {
  const updated = [...selectedCollectibles.value];
  updated.splice(index, 1);
  selectedCollectibles.value = updated;
}

/** Called by the parent when the collectibles dialog emits updated selections */
function updateCollectibles(newCollectibles: any[]) {
  selectedCollectibles.value = newCollectibles;
}

watch(
  selectedCollectibles,
  (newVal) => {
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

// Expose for parent access
defineExpose({ collections, selectedCollectibles, updateCollectibles, decreaseQuantityToSend, increaseQuantityToSend });
</script>

<style scoped>
.assets-to-send {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.token-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.token-row {
  padding-bottom: 0;
}

.add-token-row {
  display: flex;
  justify-content: center;
  padding: 2px 0;
}

.add-token-button {
  text-transform: none !important;
  letter-spacing: 0 !important;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);

  .plus-icon {
    border: 2px solid #00c7f3;
    border-radius: 5px;
    margin-right: 8px;
  }
}

/* ─── Total line ─── */
.total-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  margin-top: 2px;
}

.total-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.total-values {
  text-align: right;
}

.total-ada {
  font-size: 13px;
  font-weight: 600;
  color: #00c7f3;
  display: block;
  line-height: 1.2;
}

.total-fiat {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
}

/* ─── Collectibles section ─── */
.collectibles-section {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  padding-top: 6px;
  margin-top: 2px;
}

.selected-collectibles {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 4px 6px;
}

.collectible-chip {
  display: inline-flex;
  align-items: center;
  background-color: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  padding: 3px 4px 3px 3px;
  max-width: 160px;
}

.chip-name {
  font-size: 11px;
  color: #CECFD2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 80px;
}

.chip-qty {
  font-size: 10px;
  color: #00c7f3;
  margin-left: 2px;
  flex-shrink: 0;
}

.chip-remove {
  margin-left: 2px;
  flex-shrink: 0;
}

.add-collectibles-button {
  text-transform: none !important;
  letter-spacing: 0 !important;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  padding: 0 8px !important;
  height: 28px !important;
}

.collectibles-btn-label {
  color: rgba(255, 255, 255, 0.6);
}
</style>
